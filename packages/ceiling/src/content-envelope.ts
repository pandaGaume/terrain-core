import { convexHull, type IConvexHull, type IPoint3, type IQuickHullOptions } from "./quickhull";

/** Free space kept around the content, in metres. */
export interface IEnvelopeClearance {
    /** Kept on every side, along `x` and `y`. */
    lateral: number;
    /** Kept above. */
    vertical: number;
}

/** Bounds of an envelope: `x` east, `y` north and heights `z`, in metres. */
export interface IEnvelopeBounds {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

/**
 * The volume a ceiling must stay over: the convex hull of the content, grown by a clearance.
 *
 * It is convex, so it is larger than content that bends or branches: the space between two orebodies belongs to it.
 */
export interface IContentEnvelope {
    /** `hull` for a convex hull; `box` for the bounding box, which stands for content without volume. */
    readonly shape: "hull" | "box";
    /** Bounds of the envelope, clearance included. */
    readonly bounds: IEnvelopeBounds;
    /** Height of the top of the envelope on the vertical of a point, or `undefined` when the envelope is not under it. */
    topAt(x: number, y: number): number | undefined;
}

/** A face of the hull seen from above, with its bounds on the ground. */
interface ITopTriangle {
    a: IPoint3;
    b: IPoint3;
    c: IPoint3;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Share of the largest dimension of the envelope under which a point outside a face edge is taken to be on it. */
const EDGE_TOLERANCE = 1e-9;

function boundsOf(points: readonly IPoint3[]): IEnvelopeBounds {
    const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (const point of points) {
        if (point.x < bounds.minX) bounds.minX = point.x;
        if (point.y < bounds.minY) bounds.minY = point.y;
        if (point.z < bounds.minZ) bounds.minZ = point.z;
        if (point.x > bounds.maxX) bounds.maxX = point.x;
        if (point.y > bounds.maxY) bounds.maxY = point.y;
        if (point.z > bounds.maxZ) bounds.maxZ = point.z;
    }
    return bounds;
}

/** The points of a set moved by the corners of the clearance box: their hull is the hull of the set grown by that box. */
function grow(points: readonly IPoint3[], clearance: IEnvelopeClearance): IPoint3[] {
    const { lateral, vertical } = clearance;
    if (lateral === 0 && vertical === 0) return [...points];
    const sides = lateral === 0 ? [0] : [-lateral, lateral];
    const rises = vertical === 0 ? [0] : [0, vertical];
    const grown: IPoint3[] = [];
    for (const point of points) for (const dx of sides) for (const dy of sides) for (const dz of rises) grown.push({ x: point.x + dx, y: point.y + dy, z: point.z + dz });
    return grown;
}

class BoxEnvelope implements IContentEnvelope {
    public readonly shape = "box";

    public constructor(public readonly bounds: IEnvelopeBounds) {}

    public topAt(x: number, y: number): number | undefined {
        const { minX, minY, maxX, maxY, maxZ } = this.bounds;
        return x >= minX && x <= maxX && y >= minY && y <= maxY ? maxZ : undefined;
    }
}

class HullEnvelope implements IContentEnvelope {
    public readonly shape = "hull";
    public readonly bounds: IEnvelopeBounds;
    private readonly triangles: ITopTriangle[] = [];
    private readonly tolerance: number;

    public constructor(hull: IConvexHull) {
        this.bounds = boundsOf(hull.vertices);
        const { minX, minY, maxX, maxY } = this.bounds;
        this.tolerance = Math.max(maxX - minX, maxY - minY) * EDGE_TOLERANCE;
        for (let face = 0; face < hull.normals.length; face++) {
            // The top of the hull is made of the faces that look up; seen from above they are counter-clockwise.
            if (hull.normals[face]!.z <= 0) continue;
            const a = hull.vertices[hull.indices[face * 3]!]!;
            const b = hull.vertices[hull.indices[face * 3 + 1]!]!;
            const c = hull.vertices[hull.indices[face * 3 + 2]!]!;
            const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
            if (!(area > 0)) continue;
            this.triangles.push({
                a,
                b,
                c,
                minX: Math.min(a.x, b.x, c.x) - this.tolerance,
                minY: Math.min(a.y, b.y, c.y) - this.tolerance,
                maxX: Math.max(a.x, b.x, c.x) + this.tolerance,
                maxY: Math.max(a.y, b.y, c.y) + this.tolerance,
            });
        }
    }

    public topAt(x: number, y: number): number | undefined {
        let top: number | undefined;
        for (const triangle of this.triangles) {
            if (x < triangle.minX || x > triangle.maxX || y < triangle.minY || y > triangle.maxY) continue;
            const { a, b, c } = triangle;
            // Signed areas of the point with each edge: all positive inside. An edge accepts a point within the
            // tolerance outside of it, so that the faces leave no gap between them or on the rim of the hull.
            const wa = (b.x - x) * (c.y - y) - (b.y - y) * (c.x - x);
            const wb = (c.x - x) * (a.y - y) - (c.y - y) * (a.x - x);
            const wc = (a.x - x) * (b.y - y) - (a.y - y) * (b.x - x);
            if (wa < -this.tolerance * Math.hypot(c.x - b.x, c.y - b.y)) continue;
            if (wb < -this.tolerance * Math.hypot(a.x - c.x, a.y - c.y)) continue;
            if (wc < -this.tolerance * Math.hypot(b.x - a.x, b.y - a.y)) continue;
            // The three areas add up to the area of the triangle, which is positive: one of them at least is.
            const ua = Math.max(wa, 0);
            const ub = Math.max(wb, 0);
            const uc = Math.max(wc, 0);
            const z = (ua * a.z + ub * b.z + uc * c.z) / (ua + ub + uc);
            if (top === undefined || z > top) top = z;
        }
        return top;
    }
}

/**
 * Builds the envelope of content from points of it: vertices of its meshes, or the corners of its bounding boxes.
 *
 * Content without volume, such as one drill hole, one flat level of drifts or fewer than four points, has no hull:
 * its envelope is its bounding box, grown by the clearance.
 *
 * @param points - Points of the content, in metres: `x` east, `y` north, `z` the height in the vertical datum of the
 * reference surface the ceiling hangs under.
 * @returns The envelope, or `undefined` without points.
 */
export function createContentEnvelope(
    points: readonly IPoint3[],
    clearance: IEnvelopeClearance = { lateral: 0, vertical: 0 },
    options: IQuickHullOptions = {}
): IContentEnvelope | undefined {
    if (points.length === 0) return undefined;
    if (!(clearance.lateral >= 0) || !(clearance.vertical >= 0)) throw new RangeError("The clearance of an envelope cannot be negative.");

    // The hull is taken first: growing its corners only gives the same envelope as growing every point.
    const hull = convexHull(points, options);
    const grown = hull && convexHull(grow(hull.vertices, clearance), options);
    if (grown) return new HullEnvelope(grown);

    const bounds = boundsOf(points);
    return new BoxEnvelope({
        minX: bounds.minX - clearance.lateral,
        minY: bounds.minY - clearance.lateral,
        minZ: bounds.minZ,
        maxX: bounds.maxX + clearance.lateral,
        maxY: bounds.maxY + clearance.lateral,
        maxZ: bounds.maxZ + clearance.vertical,
    });
}
