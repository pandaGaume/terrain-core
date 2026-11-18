import { segmentDistanceSquared, triangleDistanceSquared } from "./distance";
import type { IVolume } from "./grown-surface";
import type { IConvexHull, IPoint3 } from "./quickhull";

/** The points every volume holds. Without volumes, all of space. */
export function intersectVolumes(volumes: readonly IVolume[]): IVolume {
    return {
        contains: (x, y, z) => {
            for (const volume of volumes) if (!volume.contains(x, y, z)) return false;
            return true;
        },
    };
}

/** The points one volume at least holds. Without volumes, nothing. */
export function uniteVolumes(volumes: readonly IVolume[]): IVolume {
    return {
        contains: (x, y, z) => {
            for (const volume of volumes) if (volume.contains(x, y, z)) return true;
            return false;
        },
    };
}

/** A ball. */
export function createSphereVolume(center: IPoint3, radius: number): IVolume {
    const squared = radius * radius;
    return { contains: (x, y, z) => (x - center.x) ** 2 + (y - center.y) ** 2 + (z - center.z) ** 2 <= squared };
}

/** A box along the axes. */
export function createBoxVolume(min: IPoint3, max: IPoint3): IVolume {
    return { contains: (x, y, z) => x >= min.x && x <= max.x && y >= min.y && y <= max.y && z >= min.z && z <= max.z };
}

/**
 * Everything under a surface given by its height: the constraint of a ceiling.
 *
 * @param heightAt - Height of the surface at a position, `x` east and `y` north. Where it is `NaN` the volume holds
 * nothing, so that a surface does not grow where the ceiling is unknown.
 */
export function createUnderSurfaceVolume(heightAt: (x: number, y: number) => number): IVolume {
    return { contains: (x, y, z) => z <= heightAt(x, y) };
}

/**
 * A convex hull, and with a margin every point within that distance of it: the hull with rounded edges and corners.
 *
 * @param margin - Distance kept around the hull, in the unit of its points. 0 for the hull alone.
 */
export function createHullVolume(hull: IConvexHull, margin = 0): IVolume {
    if (!(margin >= 0)) throw new RangeError("The margin of a hull volume cannot be negative.");
    const { vertices, indices, normals } = hull;
    const faces = normals.length;
    const squared = margin * margin;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const vertex of vertices) {
        minX = Math.min(minX, vertex.x - margin);
        minY = Math.min(minY, vertex.y - margin);
        minZ = Math.min(minZ, vertex.z - margin);
        maxX = Math.max(maxX, vertex.x + margin);
        maxY = Math.max(maxY, vertex.y + margin);
        maxZ = Math.max(maxZ, vertex.z + margin);
    }
    return {
        contains: (x, y, z) => {
            if (x < minX || x > maxX || y < minY || y > maxY || z < minZ || z > maxZ) return false;
            // A point farther than the margin outside the plane of a face is farther than that from the hull.
            let outside = false;
            for (let face = 0; face < faces; face++) {
                const normal = normals[face]!;
                const origin = vertices[indices[face * 3]!]!;
                const distance = normal.x * (x - origin.x) + normal.y * (y - origin.y) + normal.z * (z - origin.z);
                if (distance > margin) return false;
                if (distance > 0) outside = true;
            }
            if (!outside) return true;
            if (margin === 0) return false;
            for (let face = 0; face < faces; face++) {
                const a = vertices[indices[face * 3]!]!;
                const b = vertices[indices[face * 3 + 1]!]!;
                const c = vertices[indices[face * 3 + 2]!]!;
                if (triangleDistanceSquared(x, y, z, a, b, c) <= squared) return true;
            }
            return false;
        },
    };
}

/**
 * Every point within a distance of a path: a chain of capsules, or a ball around a single point. A drill hole, a
 * drift by its centre line or the track of a camera are paths.
 */
export function createPathVolume(points: readonly IPoint3[], radius: number): IVolume {
    if (!(radius >= 0)) throw new RangeError("The radius of a path volume cannot be negative.");
    const squared = radius * radius;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const point of points) {
        minX = Math.min(minX, point.x - radius);
        minY = Math.min(minY, point.y - radius);
        minZ = Math.min(minZ, point.z - radius);
        maxX = Math.max(maxX, point.x + radius);
        maxY = Math.max(maxY, point.y + radius);
        maxZ = Math.max(maxZ, point.z + radius);
    }
    return {
        contains: (x, y, z) => {
            if (x < minX || x > maxX || y < minY || y > maxY || z < minZ || z > maxZ) return false;
            if (points.length === 1) return segmentDistanceSquared(x, y, z, points[0]!, points[0]!) <= squared;
            for (let i = 1; i < points.length; i++) if (segmentDistanceSquared(x, y, z, points[i - 1]!, points[i]!) <= squared) return true;
            return false;
        },
    };
}
