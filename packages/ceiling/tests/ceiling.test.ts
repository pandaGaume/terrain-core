import { describe, expect, it } from "vitest";

import {
    MAX_CEILING_NODES,
    buildCeiling,
    ceilingNodeCount,
    ceilingNodeX,
    ceilingNodeY,
    createCeilingLayout,
    createContentEnvelope,
    sampleReference,
    type ICeilingSettings,
    type IPoint3,
} from "../src";

const SETTINGS: ICeilingSettings = { depth: 40, minDepth: 5, clearance: 10, margin: 50, cellSize: 20 };

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): IPoint3[] {
    const corners: IPoint3[] = [];
    for (const x of [minX, maxX]) for (const y of [minY, maxY]) for (const z of [minZ, maxZ]) corners.push({ x, y, z });
    return corners;
}

/** A relief: 300 m with a slope eastward and a wave northward. */
function relief(x: number, y: number): number {
    return 300 + 0.05 * x + 8 * Math.sin(y / 60);
}

describe("createCeilingLayout", () => {
    it("covers the content, its clearance and its margin with whole cells", () => {
        const layout = createCeilingLayout({ settings: SETTINGS, content: box(0, 0, 100, 310, 95, 200) });

        // 310 + 2 * (20 of clearance or cell + 50 of margin) = 450, then 23 cells of 20; 95 + 140 = 235, then 12.
        expect(layout.columns).toBe(23);
        expect(layout.rows).toBe(12);
        expect(layout.extent.minX).toBeCloseTo(-75, 9);
        expect(layout.extent.maxX).toBeCloseTo(385, 9);
        expect(layout.extent.minY).toBeCloseTo(-72.5, 9);
        expect(layout.extent.maxY).toBeCloseTo(167.5, 9);
        expect(ceilingNodeCount(layout)).toBe(24 * 13);
        expect(layout.envelope!.shape).toBe("hull");
    });

    it("runs its rows north to south and its columns west to east", () => {
        const layout = createCeilingLayout({ settings: SETTINGS, extent: { minX: 1000, minY: 2000, maxX: 1100, maxY: 2060 } });

        expect([layout.columns, layout.rows]).toEqual([5, 3]);
        expect(layout.envelope).toBeUndefined();
        expect(ceilingNodeX(layout, 0)).toBe(1000);
        expect(ceilingNodeX(layout, 5)).toBe(1100);
        expect(ceilingNodeY(layout, 0)).toBe(2060);
        expect(ceilingNodeY(layout, 3)).toBe(2000);

        const reference = sampleReference(layout, (x, y) => x + y / 10000);
        expect(reference[0]).toBeCloseTo(1000.206, 3);
        expect(reference[5]).toBeCloseTo(1100.206, 3);
        expect(reference[6 * 3]).toBeCloseTo(1000.2, 3);
    });

    it("takes the larger of the extent asked for and the content", () => {
        const layout = createCeilingLayout({ settings: SETTINGS, content: box(0, 0, 100, 100, 100, 200), extent: { minX: -500, minY: 20, maxX: 40, maxY: 60 } });

        // From -500 of the extent to 170 of the content: 670, then 34 cells of 20, 5 more on each side.
        expect(layout.extent.minX).toBeCloseTo(-505, 9);
        expect(layout.extent.maxX).toBeCloseTo(175, 9);
        expect(layout.extent.minY).toBeCloseTo(-70, 9);
        expect(layout.extent.maxY).toBeCloseTo(170, 9);
    });

    it("keeps the cell size as the lateral clearance of small clearances", () => {
        const layout = createCeilingLayout({ settings: { ...SETTINGS, clearance: 2, margin: 0 }, content: box(0, 0, 100, 100, 100, 200) });
        expect(layout.envelope!.bounds).toEqual({ minX: -20, minY: -20, minZ: 100, maxX: 120, maxY: 120, maxZ: 202 });
    });

    it("refuses settings that make no ceiling", () => {
        const extent = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        expect(() => createCeilingLayout({ settings: SETTINGS })).toThrow(RangeError);
        expect(() => createCeilingLayout({ settings: { ...SETTINGS, cellSize: 0 }, extent })).toThrow(RangeError);
        expect(() => createCeilingLayout({ settings: { ...SETTINGS, minDepth: 50 }, extent })).toThrow(RangeError);
        expect(() => createCeilingLayout({ settings: { ...SETTINGS, minDepth: -1 }, extent })).toThrow(RangeError);
        expect(() => createCeilingLayout({ settings: { ...SETTINGS, clearance: Number.NaN }, extent })).toThrow(RangeError);
        expect(() => createCeilingLayout({ settings: { ...SETTINGS, margin: -1 }, extent })).toThrow(RangeError);
        expect(() => createCeilingLayout({ settings: { ...SETTINGS, cellSize: 0.01 }, extent })).toThrow(RangeError);
        expect(MAX_CEILING_NODES).toBe(2049 * 2049);
    });

    it("copies its settings, which can be saved and read back", () => {
        const settings = { ...SETTINGS };
        const layout = createCeilingLayout({ settings, extent: { minX: 0, minY: 0, maxX: 100, maxY: 100 } });
        settings.depth = 999;
        expect(layout.settings).toEqual(SETTINGS);
        expect(JSON.parse(JSON.stringify(layout.settings))).toEqual(SETTINGS);
    });
});

describe("buildCeiling", () => {
    it("hangs at the depth under the reference surface over deep content", () => {
        const layout = createCeilingLayout({ settings: SETTINGS, content: box(0, 0, 0, 300, 200, 150) });
        const ceiling = buildCeiling(layout, sampleReference(layout, relief));

        for (let index = 0; index < ceiling.heights.length; index++) expect(ceiling.heights[index]).toBeCloseTo(ceiling.reference[index]! - 40, 3);
        expect(ceiling.report).toMatchObject({ nodes: ceilingNodeCount(layout), missing: 0, lifted: 0, limited: 0 });
        // The lowest ground over the content is 300 - 8 - 1: the ceiling is 40 under, the content at 150.
        expect(ceiling.report.minClearance).toBeGreaterThan(300 - 9 - 40 - 150);
    });

    it("rises over shallow content and keeps the clearance", () => {
        const content = box(0, 0, 0, 300, 200, 270);
        const layout = createCeilingLayout({ settings: SETTINGS, content });
        const ceiling = buildCeiling(layout, sampleReference(layout, relief));

        expect(ceiling.report.lifted).toBeGreaterThan(0);
        expect(ceiling.report.limited).toBe(0);
        expect(ceiling.report.minClearance).toBeCloseTo(10, 3);
        let index = 0;
        for (let row = 0; row <= layout.rows; row++) {
            for (let column = 0; column <= layout.columns; column++, index++) {
                const x = ceilingNodeX(layout, column);
                const y = ceilingNodeY(layout, row);
                const height = ceiling.heights[index]!;
                expect(height).toBeLessThanOrEqual(relief(x, y) - 5 + 1e-3);
                // Over the content and one cell around it, the ceiling is 10 over the top of the content at least.
                if (x >= -20 && x <= 320 && y >= -20 && y <= 220) expect(height).toBeGreaterThanOrEqual(280 - 1e-3);
                else expect(height).toBeCloseTo(relief(x, y) - 40, 3);
            }
        }
    });

    it("stays over the content between its nodes", () => {
        // A ridge of content, narrower than a cell, which no node of the grid needs to stand on.
        const content = [...box(0, 0, 0, 300, 200, 100), { x: 151, y: 3, z: 268 }, { x: 151, y: 197, z: 268 }];
        const layout = createCeilingLayout({ settings: SETTINGS, content });
        const ceiling = buildCeiling(layout, sampleReference(layout, relief));
        const bare = createContentEnvelope(content)!;
        const { cellSize } = layout.settings;

        const node = (column: number, row: number): number => ceiling.heights[row * (layout.columns + 1) + column]!;
        for (let row = 0; row < layout.rows; row++) {
            for (let column = 0; column < layout.columns; column++) {
                const lowest = Math.min(node(column, row), node(column + 1, row), node(column, row + 1), node(column + 1, row + 1));
                for (const [u, v] of [
                    [0.5, 0.5],
                    [0.1, 0.9],
                    [0.95, 0.3],
                ] as const) {
                    const top = bare.topAt(ceilingNodeX(layout, column) + u * cellSize, ceilingNodeY(layout, row) - v * cellSize);
                    if (top !== undefined) expect(lowest).toBeGreaterThanOrEqual(top + 10 - 1e-3);
                }
            }
        }
    });

    it("holds at the smallest depth under content that comes up to the surface, and says so", () => {
        const layout = createCeilingLayout({ settings: SETTINGS, content: box(0, 0, 0, 300, 200, 320) });
        const ceiling = buildCeiling(
            layout,
            sampleReference(layout, () => 300)
        );

        expect(ceiling.report.limited).toBeGreaterThan(0);
        expect(ceiling.report.limited).toBe(ceiling.report.lifted);
        // The ceiling is at 295 and the content reaches 320: it goes through by 25.
        expect(ceiling.report.minClearance).toBeCloseTo(-25, 3);
        expect(Math.max(...ceiling.heights)).toBeCloseTo(295, 3);
    });

    it("leaves the nodes without reference height missing", () => {
        const layout = createCeilingLayout({ settings: SETTINGS, content: box(0, 0, 0, 300, 200, 150) });
        const ceiling = buildCeiling(
            layout,
            sampleReference(layout, (x, y) => (x < 100 ? Number.NaN : relief(x, y)))
        );

        expect(ceiling.report.missing).toBeGreaterThan(0);
        expect(ceiling.report.missing).toBe(ceiling.heights.filter((height) => Number.isNaN(height)).length);
        expect(Number.isNaN(ceiling.heights[0]!)).toBe(true);
    });

    it("needs no content: an extent alone gives a ceiling at the depth", () => {
        const layout = createCeilingLayout({ settings: SETTINGS, extent: { minX: 0, minY: 0, maxX: 100, maxY: 100 } });
        const ceiling = buildCeiling(
            layout,
            sampleReference(layout, () => 120)
        );

        expect([...ceiling.heights]).toEqual(new Array(36).fill(80));
        expect(ceiling.report.minClearance).toBeNaN();
    });

    it("gives the same ceiling for the same input, and refuses a reference of another layout", () => {
        const content = box(0, 0, 0, 300, 200, 270);
        const first = createCeilingLayout({ settings: SETTINGS, content });
        const second = createCeilingLayout({ settings: SETTINGS, content: [...content].reverse() });

        expect(second.extent).toEqual(first.extent);
        expect(buildCeiling(second, sampleReference(second, relief)).heights).toEqual(buildCeiling(first, sampleReference(first, relief)).heights);
        expect(() => buildCeiling(first, new Float32Array(3))).toThrow(RangeError);
    });
});
