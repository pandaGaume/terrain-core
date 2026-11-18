import type { IPoint3 } from "./quickhull";

/** Squared distance from a point to a segment. */
export function segmentDistanceSquared(px: number, py: number, pz: number, a: IPoint3, b: IPoint3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const length = abx * abx + aby * aby + abz * abz;
    let t = length > 0 ? ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / length : 0;
    t = Math.min(1, Math.max(0, t));
    return (px - a.x - abx * t) ** 2 + (py - a.y - aby * t) ** 2 + (pz - a.z - abz * t) ** 2;
}

/** Squared distance from a point to a triangle, by the region of the triangle the point projects on. */
export function triangleDistanceSquared(px: number, py: number, pz: number, a: IPoint3, b: IPoint3, c: IPoint3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    const apx = px - a.x;
    const apy = py - a.y;
    const apz = pz - a.z;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

    const bpx = px - b.x;
    const bpy = py - b.y;
    const bpz = pz - b.z;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

    const cpx = px - c.x;
    const cpy = py - c.y;
    const cpz = pz - c.z;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return segmentDistanceSquared(px, py, pz, a, b);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return segmentDistanceSquared(px, py, pz, a, c);
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return segmentDistanceSquared(px, py, pz, b, c);

    // Over the face: the distance to its plane.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const distance = (apx * nx + apy * ny + apz * nz) / Math.hypot(nx, ny, nz);
    return distance * distance;
}

/** A point on the ground. */
export interface IPoint2 {
    x: number;
    y: number;
}

/**
 * Convex hull of points on the ground, counter-clockwise, by the monotone chain. Fewer than three corners for
 * points that are one point or on one line.
 */
export function convexPolygon(points: readonly IPoint2[]): IPoint2[] {
    const sorted = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
    const turn = (o: IPoint2, a: IPoint2, b: IPoint2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const chain = (source: readonly IPoint2[]): IPoint2[] => {
        const hull: IPoint2[] = [];
        for (const point of source) {
            while (hull.length >= 2 && turn(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0) hull.pop();
            hull.push(point);
        }
        hull.pop();
        return hull;
    };
    if (sorted.length < 3) return sorted;
    const polygon = [...chain(sorted), ...chain(sorted.reverse())];
    return polygon.length > 0 ? polygon : [sorted[0]!];
}

/** Squared distance on the ground from a point to a convex polygon given counter-clockwise; 0 inside. */
export function polygonDistanceSquared(px: number, py: number, polygon: readonly IPoint2[]): number {
    const count = polygon.length;
    if (count === 0) return Infinity;
    let inside = count >= 3;
    let nearest = Infinity;
    for (let i = 0; i < count; i++) {
        const a = polygon[i]!;
        const b = polygon[(i + 1) % count]!;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        if (abx * (py - a.y) - aby * (px - a.x) < 0) inside = false;
        const length = abx * abx + aby * aby;
        const t = length > 0 ? Math.min(1, Math.max(0, ((px - a.x) * abx + (py - a.y) * aby) / length)) : 0;
        const distance = (px - a.x - abx * t) ** 2 + (py - a.y - aby * t) ** 2;
        if (distance < nearest) nearest = distance;
    }
    return inside ? 0 : nearest;
}
