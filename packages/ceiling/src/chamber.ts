import { convexPolygon, polygonDistanceSquared, segmentDistanceSquared, triangleDistanceSquared, type IPoint2 } from "./distance";
import { GrownSurface, type IGrownSurfaceMesh, type IGrowthReport, type IVolume } from "./grown-surface";
import { convexHull, type IPoint3 } from "./quickhull";
import { createHullVolume } from "./volumes";

/**
 * How the points of an object stand for it:
 *
 * - `solid`: by their convex hull, for an orebody or a block model. Without volume, it is taken as `points`;
 * - `path`: by the line through them in order, for a drill hole, the centre line of a drift or the track of a camera;
 * - `points`: each on its own, for camera stations.
 */
export type ChamberObjectKind = "solid" | "path" | "points";

/**
 * How a chamber ends above an object: `ceiling` opens it over the object up to the ceiling; `content` keeps the top
 * as near the object as the walls are, and the ceiling is then only a limit.
 */
export type ChamberTop = "ceiling" | "content";

/** One thing the chamber shows. */
export interface IChamberObject {
    /** Points in metres: `x` east, `y` north, `z` the height in the vertical datum of the reference surface. */
    points: readonly IPoint3[];
    /** Defaults to `solid`. */
    kind?: ChamberObjectKind;
    /** Attraction of this object, in place of the one of the settings. */
    attraction?: number;
    /** Whether the chamber opens over this object up to the ceiling, in place of the choice of the settings. */
    top?: ChamberTop;
}

/** Settings of a chamber, in metres but for the attraction. Plain values, to be saved with the chamber. */
export interface IChamberSettings {
    /** Depth of the ceiling under the reference surface. */
    depth: number;
    /** Smallest depth under the reference surface: nothing of the chamber is nearer the ground. From 0 to `depth`. */
    minDepth: number;
    /** Free space kept around every object, whatever its attraction. */
    clearance: number;
    /**
     * How closely the walls and the floor follow an object, from 0 to 1. At 1 they keep the clearance only; at 0
     * they go `reach` further, which with the default reach is the convex hull of all the content.
     */
    attraction: number;
    /** Distance added to the clearance at attraction 0. Defaults to the largest dimension of the content. */
    reach?: number;
    /** How the chamber ends above its objects, unless an object says otherwise. Defaults to `ceiling`. */
    top?: ChamberTop;
    /** Length the edges of the surface aim at. */
    edgeLength: number;
}

export interface IChamberInput {
    settings: IChamberSettings;
    objects: readonly IChamberObject[];
    /**
     * Height of the reference surface at a position, in metres; `NaN` where it is unknown, and the chamber does not
     * go there. Read the heights of the data, before any exaggeration or displacement of a renderer.
     */
    reference: (x: number, y: number) => number;
}

export interface IGrowChamberOptions {
    /** Where the surface starts. Defaults to the largest object that has room for the starting sphere. */
    seed?: IPoint3;
    /** See {@link IGrownSurfaceOptions}. */
    step?: number;
    maxVertices?: number;
    maxSteps?: number;
}

/** What {@link growChamber} met, with the report of the growth. */
export interface IChamberReport extends IGrowthReport {
    seed: IPoint3;
    seedRadius: number;
    /** Indices of the objects the surface does not hold: beyond the limits, or not connected to the seed. */
    unreached: number[];
}

/** An object as the volume of a chamber asks it. */
interface IShape {
    margin: number;
    /** Whether the chamber opens over the object up to the ceiling. */
    open: boolean;
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    /** Level over which the chamber opens up to the ceiling above the object. */
    middle: number;
    /** A point of the object, or inside it. */
    centre: IPoint3;
    size: number;
    distanceSquared(x: number, y: number, z: number): number;
    /** Squared distance on the ground to the footprint of the object. */
    groundDistanceSquared(x: number, y: number): number;
}

function assertSettings(settings: IChamberSettings): void {
    const { depth, minDepth, clearance, attraction, reach, edgeLength } = settings;
    if (!(minDepth >= 0)) throw new RangeError("The smallest depth of a chamber cannot be negative.");
    if (!(depth >= minDepth) || !Number.isFinite(depth)) throw new RangeError("The depth of a chamber cannot be less than its smallest depth.");
    if (!(clearance >= 0) || !Number.isFinite(clearance)) throw new RangeError("The clearance of a chamber cannot be negative.");
    if (!(attraction >= 0 && attraction <= 1)) throw new RangeError("The attraction of a chamber is between 0 and 1.");
    if (reach !== undefined && !(reach >= 0)) throw new RangeError("The reach of a chamber cannot be negative.");
    if (!(edgeLength > 0) || !Number.isFinite(edgeLength)) throw new RangeError("The edge length of a chamber must be a positive length.");
}

function createShape(object: IChamberObject, margin: number, open: boolean): IShape | undefined {
    const { points } = object;
    if (points.length === 0) return undefined;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const mean = { x: 0, y: 0, z: 0 };
    for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        minZ = Math.min(minZ, point.z);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
        maxZ = Math.max(maxZ, point.z);
        mean.x += point.x / points.length;
        mean.y += point.y / points.length;
        mean.z += point.z / points.length;
    }
    const bounds = { margin, open, minX, minY, minZ, maxX, maxY, maxZ, middle: mean.z, size: Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) };

    const hull = (object.kind ?? "solid") === "solid" ? convexHull(points) : undefined;
    if (hull) {
        const { vertices, indices, normals } = hull;
        const footprint = convexPolygon(vertices);
        const centre = { x: 0, y: 0, z: 0 };
        for (const vertex of vertices) {
            centre.x += vertex.x / vertices.length;
            centre.y += vertex.y / vertices.length;
            centre.z += vertex.z / vertices.length;
        }
        return {
            ...bounds,
            centre,
            distanceSquared: (x, y, z) => {
                let outside = false;
                for (let face = 0; face < normals.length && !outside; face++) {
                    const normal = normals[face]!;
                    const origin = vertices[indices[face * 3]!]!;
                    outside = normal.x * (x - origin.x) + normal.y * (y - origin.y) + normal.z * (z - origin.z) > 0;
                }
                if (!outside) return 0;
                let nearest = Infinity;
                for (let face = 0; face < normals.length; face++) {
                    const distance = triangleDistanceSquared(x, y, z, vertices[indices[face * 3]!]!, vertices[indices[face * 3 + 1]!]!, vertices[indices[face * 3 + 2]!]!);
                    if (distance < nearest) nearest = distance;
                }
                return nearest;
            },
            groundDistanceSquared: (x, y) => polygonDistanceSquared(x, y, footprint),
        };
    }

    const flat: IPoint3[] = points.map((point) => ({ x: point.x, y: point.y, z: 0 }));
    if (object.kind === "path" && points.length > 1) {
        const along = (source: readonly IPoint3[], x: number, y: number, z: number): number => {
            let nearest = Infinity;
            for (let i = 1; i < source.length; i++) {
                const distance = segmentDistanceSquared(x, y, z, source[i - 1]!, source[i]!);
                if (distance < nearest) nearest = distance;
            }
            return nearest;
        };
        // The middle of the path, on the path.
        const half = Math.floor((points.length - 1) / 2);
        const a = points[half]!;
        const b = points[half + 1]!;
        return {
            ...bounds,
            centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 },
            distanceSquared: (x, y, z) => along(points, x, y, z),
            groundDistanceSquared: (x, y) => along(flat, x, y, 0),
        };
    }

    const among = (source: readonly IPoint3[], x: number, y: number, z: number): number => {
        let nearest = Infinity;
        for (const point of source) {
            const distance = (x - point.x) ** 2 + (y - point.y) ** 2 + (z - point.z) ** 2;
            if (distance < nearest) nearest = distance;
        }
        return nearest;
    };
    // The point nearest the middle of them all.
    let centre = points[0]!;
    for (const point of points) if (among([mean], point.x, point.y, point.z) < among([mean], centre.x, centre.y, centre.z)) centre = point;
    return {
        ...bounds,
        centre: { ...centre },
        distanceSquared: (x, y, z) => among(points, x, y, z),
        groundDistanceSquared: (x, y) => among(flat, x, y, 0),
    };
}

function createShapes(input: IChamberInput): { shapes: (IShape | undefined)[]; outer: IVolume | undefined; footprint: IPoint2[] } {
    const { settings, objects } = input;
    assertSettings(settings);
    const all: IPoint3[] = [];
    for (const object of objects) for (const point of object.points) all.push(point);
    const footprint: IPoint2[] = all;
    let reach = settings.reach;
    if (reach === undefined) {
        reach = 0;
        if (all.length > 0) {
            const xs = footprint.map((point) => point.x);
            const ys = footprint.map((point) => point.y);
            const zs = all.map((point) => point.z);
            const span = (values: number[]): number => values.reduce((a, b) => Math.max(a, b), -Infinity) - values.reduce((a, b) => Math.min(a, b), Infinity);
            reach = Math.max(span(xs), span(ys), span(zs));
        }
    }

    const shapes = objects.map((object) => {
        const attraction = object.attraction ?? settings.attraction;
        if (!(attraction >= 0 && attraction <= 1)) throw new RangeError("The attraction of an object is between 0 and 1.");
        return createShape(object, settings.clearance + (1 - attraction) * reach, (object.top ?? settings.top ?? "ceiling") === "ceiling");
    });
    // Whatever the margins, the chamber stays within the clearance of the hull of all the content.
    const hull = convexHull(all);
    return { shapes, outer: hull ? createHullVolume(hull, settings.clearance) : undefined, footprint: convexPolygon(footprint) };
}

function chamberVolume(input: IChamberInput, shapes: readonly (IShape | undefined)[], outer: IVolume | undefined, footprint: readonly IPoint2[]): IVolume {
    const { depth, minDepth, clearance } = input.settings;
    const { reference } = input;
    const tight = clearance * clearance;
    return {
        contains: (x, y, z) => {
            const ground = reference(x, y);
            // Nothing nearer the ground than the smallest depth, nor where the ground is unknown.
            if (!(z <= ground - minDepth)) return false;
            const below = z <= ground - depth;
            let within: boolean | undefined;
            let over: boolean | undefined;
            for (const shape of shapes) {
                if (!shape) continue;
                const { margin } = shape;
                if (x < shape.minX - margin || x > shape.maxX + margin || y < shape.minY - margin || y > shape.maxY + margin || z < shape.minZ - margin) continue;
                if (z <= shape.maxZ + margin) {
                    const distance = shape.distanceSquared(x, y, z);
                    // Within the clearance of an object: the only part of the chamber above the ceiling.
                    if (distance <= tight) return true;
                    if (below && distance <= margin * margin) {
                        within ??= outer ? outer.contains(x, y, z) : true;
                        if (within) return true;
                    }
                }
                // Over the object, up to the ceiling.
                if (shape.open && below && z >= shape.middle && shape.groundDistanceSquared(x, y) <= margin * margin) {
                    // Like the walls, the opening stays within the clearance of all the content, here on the ground.
                    over ??= polygonDistanceSquared(x, y, footprint) <= tight;
                    if (over) return true;
                }
            }
            return false;
        },
    };
}

/**
 * The volume of a chamber, to grow a surface in. With `margin = clearance + (1 - attraction) * reach` for each
 * object, a point is in the chamber when it is under `reference - minDepth` and either:
 *
 * - within `clearance` of an object: the chimney of a drill hole comes up to `minDepth` under the ground;
 * - under `reference - depth`, within the margin of an object and within `clearance` of the hull of all the content;
 * - with `top` at `ceiling`, under `reference - depth` and over an object: within its margin on the ground, above its
 *   middle height, and within `clearance` on the ground of the footprint of all the content.
 */
export function createChamberVolume(input: IChamberInput): IVolume {
    const { shapes, outer, footprint } = createShapes(input);
    return chamberVolume(input, shapes, outer, footprint);
}

/** Whether a closed mesh holds a point, by the number of faces a ray from the point crosses. */
function meshContains(mesh: IGrownSurfaceMesh, point: IPoint3): boolean {
    const { positions, indices } = mesh;
    // A direction along no axis, to stay off the edges of faces set along the axes.
    const dx = 0.8017837257372732;
    const dy = 0.5345224838248488;
    const dz = 0.2672612419124244;
    let crossings = 0;
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i]! * 3;
        const b = indices[i + 1]! * 3;
        const c = indices[i + 2]! * 3;
        const abx = positions[b]! - positions[a]!;
        const aby = positions[b + 1]! - positions[a + 1]!;
        const abz = positions[b + 2]! - positions[a + 2]!;
        const acx = positions[c]! - positions[a]!;
        const acy = positions[c + 1]! - positions[a + 1]!;
        const acz = positions[c + 2]! - positions[a + 2]!;
        const hx = dy * acz - dz * acy;
        const hy = dz * acx - dx * acz;
        const hz = dx * acy - dy * acx;
        const determinant = abx * hx + aby * hy + abz * hz;
        if (determinant === 0) continue;
        const sx = point.x - positions[a]!;
        const sy = point.y - positions[a + 1]!;
        const sz = point.z - positions[a + 2]!;
        const u = (sx * hx + sy * hy + sz * hz) / determinant;
        if (u < 0 || u > 1) continue;
        const qx = sy * abz - sz * aby;
        const qy = sz * abx - sx * abz;
        const qz = sx * aby - sy * abx;
        const v = (dx * qx + dy * qy + dz * qz) / determinant;
        if (v < 0 || u + v > 1) continue;
        if ((acx * qx + acy * qy + acz * qz) / determinant > 0) crossings++;
    }
    return crossings % 2 === 1;
}

/**
 * Grows the surface of a chamber: see {@link createChamberVolume} for its volume and {@link GrownSurface} for the
 * growth.
 *
 * The surface starts in the largest object that has room for its starting sphere, trying smaller spheres if none
 * has. It fills the part of the volume connected to that seed only: the report lists the objects left out.
 */
export function growChamber(input: IChamberInput, options: IGrowChamberOptions = {}): { volume: IVolume; mesh: IGrownSurfaceMesh; report: IChamberReport } {
    const { shapes, outer, footprint } = createShapes(input);
    const volume = chamberVolume(input, shapes, outer, footprint);
    const { edgeLength } = input.settings;

    const seeds = options.seed
        ? [options.seed]
        : shapes
              .filter((shape): shape is IShape => shape !== undefined)
              .sort((a, b) => b.size - a.size)
              .map((shape) => shape.centre);
    let surface: GrownSurface | undefined;
    let seed: IPoint3 | undefined;
    let seedRadius = 0;
    for (const radius of [edgeLength / 2, edgeLength / 4, edgeLength / 10]) {
        for (const candidate of seeds) {
            try {
                surface = new GrownSurface(volume, {
                    seed: candidate,
                    edgeLength,
                    seedRadius: radius,
                    step: options.step,
                    maxVertices: options.maxVertices,
                    maxSteps: options.maxSteps,
                });
            } catch (error) {
                if (!(error instanceof RangeError)) throw error;
                continue;
            }
            seed = candidate;
            seedRadius = radius;
            break;
        }
        if (surface) break;
    }
    if (!surface || !seed) throw new RangeError("No object of the chamber has room for the seed of its surface: check the depths, the clearance and the edge length.");

    const growth = surface.grow();
    const mesh = surface.mesh();
    const unreached: number[] = [];
    shapes.forEach((shape, index) => {
        if (!shape || !meshContains(mesh, shape.centre)) unreached.push(index);
    });
    return { volume, mesh, report: { ...growth, seed: { ...seed }, seedRadius, unreached } };
}
