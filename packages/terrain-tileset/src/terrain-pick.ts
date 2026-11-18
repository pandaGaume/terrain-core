import type { ITileAddress } from "@spacexr/3d-tiles-runtime";
import type { ICartesian3 } from "@spacexr/geodesy";
import type { IGridTopology } from "@spacexr/grid";

import type { ITerrainTiling, TerrainPickHeight } from "./terrain-tiling";

/** Ray in the body-fixed frame of a tiling, in metres. The direction need not be a unit vector. */
export interface ITerrainRay {
    readonly origin: ICartesian3;
    readonly direction: ICartesian3;
}

/** Nearest terrain surface crossed by a ray. */
export interface ITerrainPickHit {
    readonly address: ITileAddress;
    /** Ray parameter of the hit: a distance in metres when the direction is a unit vector. */
    readonly distance: number;
    /** Hit point in the body-fixed frame, in metres. */
    readonly point: ICartesian3;
}

/**
 * Coarse pick surface of one terrain tile, without any renderer object.
 *
 * It samples the heights once, when it is created. Geodetic and radial positions are affine in the height, so the
 * surface keeps the zero-height positions and the displacement of the measured heights, and follows a vertical scale
 * without sampling the heights again. Positions are relative to the tile centre, in metres, as the tiling's
 * `pickGeometry` returns them.
 */
export class TerrainPickPatch {
    public readonly address: ITileAddress;
    public readonly center: ICartesian3;
    public readonly indices: Uint32Array;
    /** Positions at the current vertical scale, three per vertex, relative to the centre. */
    public readonly positions: Float32Array;
    private readonly surface: Float32Array;
    private readonly relief: Float32Array;
    /** Axis-aligned bounds of the positions: minimum x, y, z, then maximum x, y, z, relative to the centre. */
    private readonly bounds = new Float64Array(6);
    private scale = Number.NaN;

    /**
     * @param height Height in metres at a pyramid position, before any vertical scale. A missing height (`NaN`) is the
     * reference surface.
     */
    public constructor(tiling: Pick<ITerrainTiling, "pickGeometry">, topology: IGridTopology, address: ITileAddress, height: TerrainPickHeight, verticalScale = 1) {
        const measured = tiling.pickGeometry(topology, address, (x, y, face) => {
            const value = height(x, y, face);
            return Number.isFinite(value) ? value : 0;
        });
        const reference = tiling.pickGeometry(topology, address, () => 0);
        this.address = address;
        this.center = measured.center;
        this.indices = topology.indices;
        this.surface = reference.positions;
        this.relief = new Float32Array(measured.positions.length);
        for (let index = 0; index < this.relief.length; index++) this.relief[index] = measured.positions[index]! - reference.positions[index]!;
        this.positions = new Float32Array(measured.positions.length);
        this.setVerticalScale(verticalScale);
    }

    /** Moves the positions to another vertical scale. */
    public setVerticalScale(scale: number): void {
        if (scale === this.scale) return;
        this.scale = scale;
        this.bounds.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
        for (let index = 0; index < this.positions.length; index++) {
            const value = this.surface[index]! + this.relief[index]! * scale;
            this.positions[index] = value;
            const axis = index % 3;
            if (value < this.bounds[axis]!) this.bounds[axis] = value;
            if (value > this.bounds[axis + 3]!) this.bounds[axis + 3] = value;
        }
    }

    /**
     * Ray parameter of the nearest triangle the ray crosses, from either side, or `undefined`.
     * @param maximum Hits beyond this parameter are ignored.
     */
    public intersect(ray: ITerrainRay, maximum = Infinity): number | undefined {
        const ox = ray.origin.x - this.center.x;
        const oy = ray.origin.y - this.center.y;
        const oz = ray.origin.z - this.center.z;
        const { x: dx, y: dy, z: dz } = ray.direction;
        if (!this.crossesBounds(ox, oy, oz, dx, dy, dz, maximum)) return undefined;
        const positions = this.positions;
        const indices = this.indices;
        let nearest = maximum;
        let found = false;
        for (let triangle = 0; triangle < indices.length; triangle += 3) {
            const a = indices[triangle]! * 3;
            const b = indices[triangle + 1]! * 3;
            const c = indices[triangle + 2]! * 3;
            const ax = positions[a]!;
            const ay = positions[a + 1]!;
            const az = positions[a + 2]!;
            const e1x = positions[b]! - ax;
            const e1y = positions[b + 1]! - ay;
            const e1z = positions[b + 2]! - az;
            const e2x = positions[c]! - ax;
            const e2y = positions[c + 1]! - ay;
            const e2z = positions[c + 2]! - az;
            // Moller-Trumbore, without culling: the camera may look at the terrain from below.
            const px = dy * e2z - dz * e2y;
            const py = dz * e2x - dx * e2z;
            const pz = dx * e2y - dy * e2x;
            const determinant = e1x * px + e1y * py + e1z * pz;
            if (determinant === 0) continue;
            const inverse = 1 / determinant;
            const tx = ox - ax;
            const ty = oy - ay;
            const tz = oz - az;
            const u = (tx * px + ty * py + tz * pz) * inverse;
            if (u < 0 || u > 1) continue;
            const qx = ty * e1z - tz * e1y;
            const qy = tz * e1x - tx * e1z;
            const qz = tx * e1y - ty * e1x;
            const v = (dx * qx + dy * qy + dz * qz) * inverse;
            if (v < 0 || u + v > 1) continue;
            const t = (e2x * qx + e2y * qy + e2z * qz) * inverse;
            if (t < 0 || t > nearest) continue;
            nearest = t;
            found = true;
        }
        return found ? nearest : undefined;
    }

    /** Slab test of the ray, relative to the centre, against the bounds. */
    private crossesBounds(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maximum: number): boolean {
        let near = 0;
        let far = maximum;
        const origin = [ox, oy, oz];
        const direction = [dx, dy, dz];
        for (let axis = 0; axis < 3; axis++) {
            const o = origin[axis]!;
            const d = direction[axis]!;
            const minimum = this.bounds[axis]!;
            const maximumBound = this.bounds[axis + 3]!;
            if (d === 0) {
                if (o < minimum || o > maximumBound) return false;
                continue;
            }
            let t0 = (minimum - o) / d;
            let t1 = (maximumBound - o) / d;
            if (t0 > t1) [t0, t1] = [t1, t0];
            if (t0 > near) near = t0;
            if (t1 < far) far = t1;
            if (near > far) return false;
        }
        return true;
    }
}

/** Nearest hit of a ray on a set of pick surfaces, for example those of the presented terrain cut. */
export function pickTerrain(patches: Iterable<TerrainPickPatch>, ray: ITerrainRay): ITerrainPickHit | undefined {
    let nearest: { patch: TerrainPickPatch; distance: number } | undefined;
    for (const patch of patches) {
        const distance = patch.intersect(ray, nearest?.distance ?? Infinity);
        if (distance !== undefined && (!nearest || distance < nearest.distance)) nearest = { patch, distance };
    }
    if (!nearest) return undefined;
    const { origin, direction } = ray;
    return {
        address: nearest.patch.address,
        distance: nearest.distance,
        point: {
            x: origin.x + direction.x * nearest.distance,
            y: origin.y + direction.y * nearest.distance,
            z: origin.z + direction.z * nearest.distance,
        },
    };
}
