import { describe, expect, it } from "vitest";

import { ceilingNodeX, ceilingNodeY, createCeilingLayout, sampleTiledReference, type ICeilingSettings, type IReferenceTileAddress, type ITiledHeights } from "../src";

const SETTINGS: ICeilingSettings = { depth: 40, minDepth: 5, clearance: 10, margin: 0, cellSize: 25 };

/** A pyramid over a square of 1600 m whose north-west corner is at (0, 1600): at level 2 its tiles are 400 m wide. */
const SIDE = 1600;
function locate(x: number, y: number): { x: number; y: number } {
    return { x: x / SIDE, y: (SIDE - y) / SIDE };
}

/** Tiles of a surface given over the whole pyramid, with the addresses asked for. */
function tiles(surface: (x: number, y: number) => number, absent: (address: IReferenceTileAddress) => boolean = () => false): ITiledHeights & { asked: IReferenceTileAddress[] } {
    const asked: IReferenceTileAddress[] = [];
    return {
        asked,
        tileHeights: async (address) => {
            asked.push(address);
            if (absent(address)) return undefined;
            const span = 1 / 2 ** address.lod;
            return { sampler: (u, v) => surface((address.x + u) * span, (address.y + v) * span) };
        },
    };
}

describe("sampleTiledReference", () => {
    it("reads each tile under the ceiling once, at the level asked for", async () => {
        const layout = createCeilingLayout({ settings: SETTINGS, extent: { minX: 300, minY: 900, maxX: 900, maxY: 1300 } });
        const heights = tiles((x, y) => 1000 * x + y);
        const reference = await sampleTiledReference(layout, { heights, lod: 2, locate });

        // x from 300 to 900 touches columns 0 to 2, y from 1300 down to 900 rows 0 and 1.
        expect(heights.asked.map((address) => `${address.lod}/${address.x}/${address.y}`).sort()).toEqual(["2/0/0", "2/0/1", "2/1/0", "2/1/1", "2/2/0", "2/2/1"]);
        expect(heights.asked.every((address) => !("face" in address))).toBe(true);

        let index = 0;
        for (let row = 0; row <= layout.rows; row++) {
            for (let column = 0; column <= layout.columns; column++, index++) {
                const point = locate(ceilingNodeX(layout, column), ceilingNodeY(layout, row));
                expect(reference[index]).toBeCloseTo(1000 * point.x + point.y, 3);
            }
        }
    });

    it("leaves the nodes over an absent tile or outside the pyramid missing", async () => {
        const layout = createCeilingLayout({ settings: SETTINGS, extent: { minX: -50, minY: 1300, maxX: 500, maxY: 1500 } });
        const heights = tiles(
            () => 7,
            (address) => address.x === 1
        );
        const reference = await sampleTiledReference(layout, { heights, lod: 2, locate });

        let index = 0;
        for (let row = 0; row <= layout.rows; row++) {
            for (let column = 0; column <= layout.columns; column++, index++) {
                const x = ceilingNodeX(layout, column);
                if (x < 0 || x >= 400) expect(reference[index]).toBeNaN();
                else expect(reference[index]).toBe(7);
            }
        }
    });

    it("gives the east and south edges of the pyramid to its last tiles, and keeps the face of a point", async () => {
        const layout = createCeilingLayout({ settings: { ...SETTINGS, cellSize: 100 }, extent: { minX: 1500, minY: 0, maxX: 1600, maxY: 100 } });
        const heights = tiles((x, y) => x + y);
        const reference = await sampleTiledReference(layout, { heights, lod: 2, locate: (x, y) => ({ ...locate(x, y), face: 4 }) });

        expect(heights.asked).toEqual([{ face: 4, lod: 2, x: 3, y: 3 }]);
        expect(reference[3]).toBeCloseTo(2, 6);
    });

    it("passes the signal on and refuses a level that is not one", async () => {
        const layout = createCeilingLayout({ settings: SETTINGS, extent: { minX: 0, minY: 0, maxX: 100, maxY: 100 } });
        const controller = new AbortController();
        const seen: (AbortSignal | undefined)[] = [];
        const heights: ITiledHeights = {
            tileHeights: async (_address, signal) => {
                seen.push(signal);
                return undefined;
            },
        };

        await sampleTiledReference(layout, { heights, lod: 0, locate, signal: controller.signal });
        expect(seen).toEqual([controller.signal]);
        await expect(sampleTiledReference(layout, { heights, lod: 1.5, locate })).rejects.toThrow(RangeError);
    });
});
