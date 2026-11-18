import { describe, expect, it } from "vitest";

import {
    buildCeiling,
    ceilingHeightAt,
    convexHull,
    createBoxVolume,
    createCeilingLayout,
    createHullVolume,
    createPathVolume,
    createSphereVolume,
    createUnderSurfaceVolume,
    intersectVolumes,
    sampleReference,
    uniteVolumes,
    type IPoint3,
} from "../src";

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): IPoint3[] {
    const corners: IPoint3[] = [];
    for (const x of [minX, maxX]) for (const y of [minY, maxY]) for (const z of [minZ, maxZ]) corners.push({ x, y, z });
    return corners;
}

describe("volumes", () => {
    it("intersects and unites", () => {
        const left = createSphereVolume({ x: 0, y: 0, z: 0 }, 10);
        const right = createSphereVolume({ x: 12, y: 0, z: 0 }, 10);
        const both = intersectVolumes([left, right]);
        const either = uniteVolumes([left, right]);

        expect(both.contains(6, 0, 0)).toBe(true);
        expect(both.contains(-5, 0, 0)).toBe(false);
        expect(either.contains(-5, 0, 0)).toBe(true);
        expect(either.contains(21, 0, 0)).toBe(true);
        expect(either.contains(6, 9, 0)).toBe(false);
        expect(intersectVolumes([]).contains(1e9, 0, 0)).toBe(true);
        expect(uniteVolumes([]).contains(0, 0, 0)).toBe(false);
    });

    it("holds a ball and a box with their boundaries", () => {
        const ball = createSphereVolume({ x: 1, y: 2, z: 3 }, 5);
        expect(ball.contains(6, 2, 3)).toBe(true);
        expect(ball.contains(6.001, 2, 3)).toBe(false);

        const walls = createBoxVolume({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 });
        expect(walls.contains(1, 2, 3)).toBe(true);
        expect(walls.contains(0.5, 1, 3.001)).toBe(false);
    });

    it("holds what is under a surface, and nothing where the surface is unknown", () => {
        const under = createUnderSurfaceVolume((x, y) => (x < 0 ? Number.NaN : 100 + y));
        expect(under.contains(5, 10, 110)).toBe(true);
        expect(under.contains(5, 10, 110.001)).toBe(false);
        expect(under.contains(5, 10, -1e6)).toBe(true);
        expect(under.contains(-5, 10, 0)).toBe(false);
    });

    it("holds a hull, and with a margin what is within that distance of its faces, edges and corners", () => {
        const hull = convexHull(box(0, 0, 0, 10, 10, 10))!;
        const bare = createHullVolume(hull);
        const grown = createHullVolume(hull, 2);

        expect(bare.contains(5, 5, 5)).toBe(true);
        expect(bare.contains(10, 10, 10)).toBe(true);
        expect(bare.contains(10.001, 5, 5)).toBe(false);

        expect(grown.contains(5, 5, 5)).toBe(true);
        // Beside a face, an edge and a corner: the margin is a distance, so edges and corners are rounded.
        expect(grown.contains(11.99, 5, 5)).toBe(true);
        expect(grown.contains(12.01, 5, 5)).toBe(false);
        expect(grown.contains(11.4, 11.4, 5)).toBe(true);
        expect(grown.contains(11.5, 11.5, 5)).toBe(false);
        expect(grown.contains(11.15, 11.15, 11.15)).toBe(true);
        expect(grown.contains(11.2, 11.2, 11.2)).toBe(false);
        expect(() => createHullVolume(hull, -1)).toThrow(RangeError);
    });

    it("holds what is within a radius of a path, or of a single point", () => {
        const path = createPathVolume(
            [
                { x: 0, y: 0, z: 0 },
                { x: 100, y: 0, z: 0 },
                { x: 100, y: 0, z: -50 },
            ],
            5
        );
        expect(path.contains(50, 4.9, 0)).toBe(true);
        expect(path.contains(50, 5.1, 0)).toBe(false);
        expect(path.contains(-4.9, 0, 0)).toBe(true);
        expect(path.contains(-3.6, 3.6, 0)).toBe(false);
        expect(path.contains(104, 0, -30)).toBe(true);
        expect(path.contains(100, 0, -55.1)).toBe(false);

        const point = createPathVolume([{ x: 1, y: 1, z: 1 }], 2);
        expect(point.contains(1, 1, 2.9)).toBe(true);
        expect(point.contains(1, 1, 3.1)).toBe(false);
        expect(createPathVolume([], 2).contains(0, 0, 0)).toBe(false);
        expect(() => createPathVolume([], -1)).toThrow(RangeError);
    });
});

describe("ceilingHeightAt", () => {
    it("interpolates the ceiling between its nodes, and is unknown outside the extent or beside a missing node", () => {
        const layout = createCeilingLayout({ settings: { depth: 40, minDepth: 5, clearance: 10, margin: 0, cellSize: 20 }, extent: { minX: 0, minY: 0, maxX: 100, maxY: 60 } });
        const ceiling = buildCeiling(
            layout,
            sampleReference(layout, (x, y) => (x > 90 && y < 10 ? Number.NaN : 300 + 0.5 * x - 0.25 * y))
        );

        // A plane is interpolated exactly, up to the 32-bit heights.
        expect(ceilingHeightAt(ceiling, 0, 60)).toBeCloseTo(245, 3);
        expect(ceilingHeightAt(ceiling, 37, 41)).toBeCloseTo(260 + 18.5 - 10.25, 3);
        expect(ceilingHeightAt(ceiling, 100, 60)).toBeCloseTo(295, 3);
        expect(ceilingHeightAt(ceiling, 50, 0)).toBeCloseTo(285, 3);
        expect(ceilingHeightAt(ceiling, -0.1, 30)).toBeNaN();
        expect(ceilingHeightAt(ceiling, 50, 60.1)).toBeNaN();
        expect(ceilingHeightAt(ceiling, 95, 5)).toBeNaN();
    });
});
