import { GeodeticSystem } from "@spacexr/geodesy";
import { createGridTopology } from "@spacexr/grid";
import { describe, expect, it } from "vitest";

import { TerrainPickPatch, pickTerrain, webMercatorTiling, type ITerrainRay } from "../src";

const system = GeodeticSystem.WGS84;
const tiling = webMercatorTiling(system);
const topology = createGridTopology(8);
const address = { lod: 10, x: 530, y: 365 };

/** Vertical ray falling on the centre of a tile from 10 km above its reference surface. */
function downward(patch: TerrainPickPatch): ITerrainRay {
    const { x, y, z } = patch.center;
    const length = Math.hypot(x, y, z);
    const up = { x: x / length, y: y / length, z: z / length };
    return { origin: { x: x + up.x * 10_000, y: y + up.y * 10_000, z: z + up.z * 10_000 }, direction: { x: -up.x, y: -up.y, z: -up.z } };
}

describe("TerrainPickPatch", () => {
    it("hits the reference surface where heights are missing", () => {
        const patch = new TerrainPickPatch(tiling, topology, address, () => Number.NaN);
        const distance = patch.intersect(downward(patch));
        // The ray is radial, not along the ellipsoid normal: a few metres of tolerance cover the difference.
        expect(distance).toBeGreaterThan(9_990);
        expect(distance).toBeLessThan(10_010);
    });

    it("hits measured heights and follows the vertical scale without sampling them again", () => {
        let samples = 0;
        const patch = new TerrainPickPatch(tiling, topology, address, () => {
            samples++;
            return 1_000;
        });
        const flat = new TerrainPickPatch(tiling, topology, address, () => 0);
        const ray = downward(patch);
        const reference = flat.intersect(ray)!;
        expect(reference - patch.intersect(ray)!).toBeCloseTo(1_000, 0);
        const sampled = samples;
        patch.setVerticalScale(3);
        expect(samples).toBe(sampled);
        expect(reference - patch.intersect(ray)!).toBeCloseTo(3_000, 0);
    });

    it("hits from below and misses a ray that leaves the terrain", () => {
        const patch = new TerrainPickPatch(tiling, topology, address, () => 0);
        const down = downward(patch);
        const below = { x: patch.center.x + down.direction.x * 100, y: patch.center.y + down.direction.y * 100, z: patch.center.z + down.direction.z * 100 };
        const up = { x: -down.direction.x, y: -down.direction.y, z: -down.direction.z };
        expect(patch.intersect({ origin: below, direction: up })).toBeCloseTo(100, 0);
        expect(patch.intersect({ origin: down.origin, direction: up })).toBeUndefined();
    });

    it("ignores hits beyond the given maximum", () => {
        const patch = new TerrainPickPatch(tiling, topology, address, () => 0);
        expect(patch.intersect(downward(patch), 5_000)).toBeUndefined();
    });
});

describe("pickTerrain", () => {
    it("returns the nearest tile, its distance and its point", () => {
        const low = new TerrainPickPatch(tiling, topology, address, () => 0);
        const high = new TerrainPickPatch(tiling, topology, address, () => 2_000);
        const neighbour = new TerrainPickPatch(tiling, topology, { lod: 10, x: 531, y: 365 }, () => 5_000);
        const ray = downward(low);
        const hit = pickTerrain([low, neighbour, high], ray)!;
        expect(hit.address).toBe(high.address);
        expect(hit.distance).toBeCloseTo(high.intersect(ray)!, 6);
        expect(hit.point.x).toBeCloseTo(ray.origin.x + ray.direction.x * hit.distance, 6);
        expect(pickTerrain([neighbour], ray)).toBeUndefined();
        expect(pickTerrain([], ray)).toBeUndefined();
    });
});
