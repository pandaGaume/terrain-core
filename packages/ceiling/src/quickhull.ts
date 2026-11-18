/*
 * Convex hull of a point set by quickhull.
 *
 * Ported from SpaceXR core (geometry.convex.quickhull.ts), itself a TypeScript port of the quickhull implementation of
 * Oskar Sigvardsson. The algorithm is unchanged. The seed, the handling of flat sets, the tolerance and the vertex
 * table of the result differ: see docs/changes/2026-11-17-underground-ceiling.md.
 */

/** A point or a vector, in any consistent unit. */
export interface IPoint3 {
    x: number;
    y: number;
    z: number;
}

/** A convex hull as a closed triangle mesh. */
export interface IConvexHull {
    /** The points of the input that are corners of the hull, as the input gave them. */
    vertices: IPoint3[];
    /** Triangles, three indices into `vertices` each, counter-clockwise seen from outside. */
    indices: number[];
    /** Unit outward normal of each triangle. */
    normals: IPoint3[];
}

export interface IQuickHullOptions {
    /**
     * Distance under which a point is taken to lie on a face, in the unit of the points. Defaults to
     * {@link QUICKHULL_RELATIVE_EPSILON} times the largest dimension of the point set.
     */
    epsilon?: number;
}

/** Default tolerance of {@link QuickHull}, as a share of the largest dimension of the point set. */
export const QUICKHULL_RELATIVE_EPSILON = 1e-7;

/**
 * A face of the hull under construction. `v0`, `v1` and `v2` are indices of its corners in counter-clockwise order.
 * `o0`, `o1` and `o2` are the keys of the faces sharing an edge with it: `o0` is opposite `v0`, so it shares the
 * edge from `v2` to `v1`, and so on.
 */
interface IFace {
    v0: number;
    v1: number;
    v2: number;
    o0: number;
    o1: number;
    o2: number;
    normal: IPoint3;
}

/** A point of the open set with the face it stands outside of and its distance to that face. */
interface IPointFace {
    point: number;
    face: number;
    distance: number;
}

/** An edge of the horizon, counter-clockwise, with the face on its far side. */
interface IHorizonEdge {
    face: number;
    edge0: number;
    edge1: number;
}

/** A point not assigned to a face yet; only right after the seed hull is made. */
const UNASSIGNED = -2;
/** A point behind every face. */
const INSIDE = -1;

function subtract(a: IPoint3, b: IPoint3): IPoint3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: IPoint3, b: IPoint3): IPoint3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: IPoint3, b: IPoint3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function magnitude(a: IPoint3): number {
    return Math.sqrt(dot(a, a));
}

/** Unit normal of a triangle given counter-clockwise. */
function triangleNormal(a: IPoint3, b: IPoint3, c: IPoint3): IPoint3 {
    const normal = cross(subtract(b, a), subtract(c, a));
    const length = magnitude(normal);
    return { x: normal.x / length, y: normal.y / length, z: normal.z / length };
}

/** Largest dimension of the bounding box of a point set. */
function largestDimension(points: readonly IPoint3[]): number {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.z < minZ) minZ = point.z;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
        if (point.z > maxZ) maxZ = point.z;
    }
    return Math.max(maxX - minX, maxY - minY, maxZ - minZ);
}

/**
 * Quickhull in three dimensions.
 *
 * The hull starts as a tetrahedron of four points of the set and grows until it holds every point. Each point still
 * outside is assigned to a face it stands outside of. The point farthest from its face is added: the faces that see
 * it (the "lit" faces) are removed, which leaves a loop of edges, the horizon, and a cone of new faces joins the point
 * to that loop. The horizon is found by a depth-first search that walks the lit faces counter-clockwise, so that its
 * edges come out in counter-clockwise order.
 *
 * Coordinates are right-handed and faces counter-clockwise seen from outside. Points are expected to be finite.
 * The horizon search is recursive, as deep as the faces one point sees: feed it thousands of points, not millions.
 *
 * An instance keeps its work buffers between calls and is not re-entrant.
 */
export class QuickHull {
    private readonly faces = new Map<number, IFace>();
    private readonly litFaces = new Set<number>();
    private horizon: IHorizonEdge[] = [];
    /** Points outside the hull up to `openSetTail`, then the points known to be inside. */
    private openSet: IPointFace[] = [];
    private openSetTail = -1;
    private faceCount = 0;
    private epsilon = 0;

    /**
     * Builds the convex hull of a point set.
     *
     * @returns The hull, or `undefined` when the set has no volume: fewer than four points, or points that are
     * coincident, collinear or coplanar within the tolerance.
     */
    public generateHull(points: readonly IPoint3[], options: IQuickHullOptions = {}): IConvexHull | undefined {
        this.faces.clear();
        this.litFaces.clear();
        this.horizon = [];
        this.openSet = [];
        this.openSetTail = -1;
        this.faceCount = 0;

        if (points.length < 4) return undefined;
        this.epsilon = options.epsilon ?? largestDimension(points) * QUICKHULL_RELATIVE_EPSILON;

        const seed = this.findSeed(points);
        if (!seed) return undefined;
        this.generateInitialHull(points, seed);
        while (this.openSetTail >= 0) this.growHull(points);
        return this.exportHull(points);
    }

    /**
     * Four points with a volume for the seed hull: an extreme point, the point farthest from it, the point farthest
     * from their line and the point farthest from the plane of the three.
     */
    private findSeed(points: readonly IPoint3[]): [number, number, number, number] | undefined {
        let i0 = 0;
        for (let i = 1; i < points.length; i++) if (points[i]!.x < points[i0]!.x) i0 = i;
        const p0 = points[i0]!;

        let i1 = -1;
        let farthest = this.epsilon;
        for (let i = 0; i < points.length; i++) {
            const distance = magnitude(subtract(points[i]!, p0));
            if (distance > farthest) {
                farthest = distance;
                i1 = i;
            }
        }
        if (i1 < 0) return undefined;
        const axis = subtract(points[i1]!, p0);
        const axisLength = farthest;

        let i2 = -1;
        farthest = this.epsilon;
        for (let i = 0; i < points.length; i++) {
            const distance = magnitude(cross(axis, subtract(points[i]!, p0))) / axisLength;
            if (distance > farthest) {
                farthest = distance;
                i2 = i;
            }
        }
        if (i2 < 0) return undefined;
        const normal = triangleNormal(p0, points[i1]!, points[i2]!);

        let i3 = -1;
        farthest = this.epsilon;
        for (let i = 0; i < points.length; i++) {
            const distance = Math.abs(dot(normal, subtract(points[i]!, p0)));
            if (distance > farthest) {
                farthest = distance;
                i3 = i;
            }
        }
        if (i3 < 0) return undefined;
        return [i0, i1, i2, i3];
    }

    private addFace(points: readonly IPoint3[], v0: number, v1: number, v2: number, o0: number, o1: number, o2: number): number {
        const key = this.faceCount++;
        this.faces.set(key, { v0, v1, v2, o0, o1, o2, normal: triangleNormal(points[v0]!, points[v1]!, points[v2]!) });
        return key;
    }

    /** Makes the seed tetrahedron and assigns every other point to a face it stands outside of. */
    private generateInitialHull(points: readonly IPoint3[], seed: readonly [number, number, number, number]): void {
        const [b0, b1, b2, b3] = seed;
        const v0 = points[b0]!;
        const v1 = points[b1]!;
        const v2 = points[b2]!;
        const v3 = points[b3]!;

        // There are two seed tetrahedra, as the fourth point is above or below the triangle of the first three. With
        // b0 = (0,0,0), b1 = (1,0,0), b2 = (0,1,0) and b3 = (0,0,1) one sees the first case; b3 = (0,0,-1) is the
        // second. Each face names the faces opposite its corners.
        const above = dot(subtract(v3, v1), cross(subtract(v1, v0), subtract(v2, v0))) > 0;
        if (above) {
            this.addFace(points, b0, b2, b1, 3, 1, 2);
            this.addFace(points, b0, b1, b3, 3, 2, 0);
            this.addFace(points, b0, b3, b2, 3, 0, 1);
            this.addFace(points, b1, b2, b3, 2, 1, 0);
        } else {
            this.addFace(points, b0, b1, b2, 3, 2, 1);
            this.addFace(points, b0, b3, b1, 3, 0, 2);
            this.addFace(points, b0, b2, b3, 3, 1, 0);
            this.addFace(points, b1, b3, b2, 2, 0, 1);
        }

        for (let i = 0; i < points.length; i++) {
            if (i === b0 || i === b1 || i === b2 || i === b3) continue;
            this.openSet.push({ point: i, face: UNASSIGNED, distance: 0 });
        }
        // The corners of the seed are inside by definition: they go to the tail, behind the open set.
        for (const corner of seed) this.openSet.push({ point: corner, face: INSIDE, distance: Number.NaN });
        this.openSetTail = this.openSet.length - 5;

        for (let i = 0; i <= this.openSetTail; i++) {
            const entry = this.openSet[i]!;
            let assigned = false;
            for (let key = 0; key < 4; key++) {
                const face = this.faces.get(key)!;
                const distance = this.pointFaceDistance(points[entry.point]!, points[face.v0]!, face);
                if (distance > this.epsilon) {
                    entry.face = key;
                    entry.distance = distance;
                    assigned = true;
                    break;
                }
            }
            if (!assigned) {
                // Inside the seed: swap with the tail of the open set, which shrinks, and look at the swapped entry.
                entry.face = INSIDE;
                entry.distance = Number.NaN;
                this.openSet[i] = this.openSet[this.openSetTail]!;
                this.openSet[this.openSetTail] = entry;
                this.openSetTail--;
                i--;
            }
        }
    }

    /** Grows the hull to hold the point of the open set farthest from its face. */
    private growHull(points: readonly IPoint3[]): void {
        let farthest = 0;
        let distance = this.openSet[0]!.distance;
        for (let i = 1; i <= this.openSetTail; i++) {
            if (this.openSet[i]!.distance > distance) {
                farthest = i;
                distance = this.openSet[i]!.distance;
            }
        }
        const entry = this.openSet[farthest]!;

        this.findHorizon(points, points[entry.point]!, entry.face, this.faces.get(entry.face)!);
        this.constructCone(points, entry.point);
        this.reassignPoints(points);
    }

    /** Whether a face sees a point: the point stands outside of it by more than the tolerance. */
    private isLit(points: readonly IPoint3[], point: IPoint3, face: IFace): boolean {
        return this.pointFaceDistance(point, points[face.v0]!, face) > this.epsilon;
    }

    /**
     * Starts the search of the horizon from a face that sees the point. The first face has three neighbours to visit;
     * every face after it has two, since the search came in by the third.
     */
    private findHorizon(points: readonly IPoint3[], point: IPoint3, faceKey: number, face: IFace): void {
        this.litFaces.clear();
        this.horizon = [];
        this.litFaces.add(faceKey);

        const visit = (neighbourKey: number, edge0: number, edge1: number): void => {
            if (this.litFaces.has(neighbourKey)) return;
            const neighbour = this.faces.get(neighbourKey)!;
            if (this.isLit(points, point, neighbour)) this.searchHorizon(points, point, faceKey, neighbourKey, neighbour);
            else this.horizon.push({ face: neighbourKey, edge0, edge1 });
        };
        visit(face.o0, face.v1, face.v2);
        visit(face.o1, face.v2, face.v0);
        visit(face.o2, face.v0, face.v1);
    }

    /** Depth-first search of the lit faces, counter-clockwise from the face the search came by. */
    private searchHorizon(points: readonly IPoint3[], point: IPoint3, previousKey: number, faceKey: number, face: IFace): void {
        this.litFaces.add(faceKey);

        let next0: number;
        let next1: number;
        let edge0: number;
        let edge1: number;
        let edge2: number;
        if (previousKey === face.o0) {
            next0 = face.o1;
            next1 = face.o2;
            edge0 = face.v2;
            edge1 = face.v0;
            edge2 = face.v1;
        } else if (previousKey === face.o1) {
            next0 = face.o2;
            next1 = face.o0;
            edge0 = face.v0;
            edge1 = face.v1;
            edge2 = face.v2;
        } else {
            next0 = face.o0;
            next1 = face.o1;
            edge0 = face.v1;
            edge1 = face.v2;
            edge2 = face.v0;
        }

        if (!this.litFaces.has(next0)) {
            const neighbour = this.faces.get(next0)!;
            if (this.isLit(points, point, neighbour)) this.searchHorizon(points, point, faceKey, next0, neighbour);
            else this.horizon.push({ face: next0, edge0, edge1 });
        }
        if (!this.litFaces.has(next1)) {
            const neighbour = this.faces.get(next1)!;
            if (this.isLit(points, point, neighbour)) this.searchHorizon(points, point, faceKey, next1, neighbour);
            else this.horizon.push({ face: next1, edge0: edge1, edge1: edge2 });
        }
    }

    /**
     * Removes the lit faces and joins the point to the horizon by a cone of new faces. The neighbours of a new face
     * are the face beyond its horizon edge and the next and previous faces of the cone.
     */
    private constructCone(points: readonly IPoint3[], farthestPoint: number): void {
        for (const key of this.litFaces) this.faces.delete(key);

        const first = this.faceCount;
        const count = this.horizon.length;
        for (let i = 0; i < count; i++) {
            const edge = this.horizon[i]!;
            const v1 = edge.edge0;
            const o1 = i === count - 1 ? first : first + i + 1;
            const o2 = i === 0 ? first + count - 1 : first + i - 1;
            const key = this.addFace(points, farthestPoint, v1, edge.edge1, edge.face, o1, o2);

            // The face beyond the horizon now has the new face as neighbour, across the edge they share.
            const beyond = this.faces.get(edge.face)!;
            if (beyond.v0 === v1) beyond.o1 = key;
            else if (beyond.v1 === v1) beyond.o2 = key;
            else beyond.o0 = key;
        }
    }

    /** Gives the points of the removed faces a new face, or moves them inside when no face sees them. */
    private reassignPoints(points: readonly IPoint3[]): void {
        for (let i = 0; i <= this.openSetTail; i++) {
            const entry = this.openSet[i]!;
            if (!this.litFaces.has(entry.face)) continue;

            const point = points[entry.point]!;
            let assigned = false;
            for (const [key, face] of this.faces) {
                const distance = this.pointFaceDistance(point, points[face.v0]!, face);
                if (distance > this.epsilon) {
                    entry.face = key;
                    entry.distance = distance;
                    assigned = true;
                    break;
                }
            }
            if (!assigned) {
                entry.face = INSIDE;
                entry.distance = Number.NaN;
                this.openSet[i] = this.openSet[this.openSetTail]!;
                this.openSet[this.openSetTail] = entry;
                this.openSetTail--;
                i--;
            }
        }
    }

    private exportHull(points: readonly IPoint3[]): IConvexHull {
        const vertices: IPoint3[] = [];
        const indices: number[] = [];
        const normals: IPoint3[] = [];
        const table = new Map<number, number>();
        const vertex = (point: number): number => {
            let index = table.get(point);
            if (index === undefined) {
                index = vertices.length;
                table.set(point, index);
                vertices.push(points[point]!);
            }
            return index;
        };
        for (const face of this.faces.values()) {
            indices.push(vertex(face.v0), vertex(face.v1), vertex(face.v2));
            normals.push(face.normal);
        }
        return { vertices, indices, normals };
    }

    /** Signed distance from a face to a point, positive outside. */
    private pointFaceDistance(point: IPoint3, pointOnFace: IPoint3, face: IFace): number {
        return dot(face.normal, subtract(point, pointOnFace));
    }
}

/** Convex hull of a point set: see {@link QuickHull.generateHull}. */
export function convexHull(points: readonly IPoint3[], options: IQuickHullOptions = {}): IConvexHull | undefined {
    return new QuickHull().generateHull(points, options);
}
