import { ceilingNodeCount, ceilingNodeX, ceilingNodeY, type ICeilingLayout } from "./ceiling";

/** Address of a tile of a pyramid, as `ITileAddress` of `@spacexr/tiles`. */
export interface IReferenceTileAddress {
    face?: number;
    lod: number;
    x: number;
    y: number;
}

/**
 * Heights served by tiles. A `DemPyramid` of `@spacexr/dem` is one: this package only names the part it calls, so
 * that it depends on no DEM implementation.
 */
export interface ITiledHeights {
    /**
     * Loads the heights of a tile. The sampler takes normalized tile coordinates, `u` west to east and `v` north to
     * south, and gives metres, or `NaN` for a missing sample. Resolves to `undefined` when there is no tile there.
     */
    tileHeights(address: IReferenceTileAddress, signal?: AbortSignal): Promise<{ sampler: (u: number, v: number) => number } | undefined>;
}

/** A point of a pyramid: `x` eastward and `y` southward in `[0, 1]` over the root `face`. */
export interface IPyramidPoint {
    x: number;
    y: number;
    face?: number;
}

export interface ITiledReferenceOptions {
    heights: ITiledHeights;
    /**
     * Level of the tiles read. It is fixed for the whole ceiling and chosen for its cell size; the levels a view
     * displays have no part in it.
     */
    lod: number;
    /**
     * Places a position of the ceiling, `x` east and `y` north in metres, in the pyramid: the projection of the
     * tiling, which the application owns with the frame of the ceiling.
     */
    locate: (x: number, y: number) => IPyramidPoint;
    signal?: AbortSignal;
}

/**
 * Samples the reference surface at the nodes of a layout from the tiles of one level of a pyramid. Each tile under
 * the ceiling is loaded once. Nodes over an absent tile get `NaN`.
 *
 * The heights are those of the data: the heights a renderer displaces in its shaders are not read.
 */
export async function sampleTiledReference(layout: ICeilingLayout, options: ITiledReferenceOptions): Promise<Float32Array> {
    const { heights, lod, locate, signal } = options;
    if (!Number.isInteger(lod) || lod < 0) throw new RangeError("The level of the reference tiles must be a whole number, 0 or more.");
    const side = 2 ** lod;

    const nodes = ceilingNodeCount(layout);
    const reference = new Float32Array(nodes).fill(Number.NaN);
    const us = new Float64Array(nodes);
    const vs = new Float64Array(nodes);
    const tiles = new Map<string, { address: IReferenceTileAddress; nodes: number[] }>();
    let index = 0;
    for (let row = 0; row <= layout.rows; row++) {
        const y = ceilingNodeY(layout, row);
        for (let column = 0; column <= layout.columns; column++, index++) {
            const point = locate(ceilingNodeX(layout, column), y);
            const px = point.x * side;
            const py = point.y * side;
            // A point outside the pyramid has no tile. One on its east or south edge belongs to the last tile.
            if (!(px >= 0 && px <= side && py >= 0 && py <= side)) continue;
            const tileX = Math.min(side - 1, Math.floor(px));
            const tileY = Math.min(side - 1, Math.floor(py));
            us[index] = px - tileX;
            vs[index] = py - tileY;
            const key = `${point.face ?? 0}/${tileX}/${tileY}`;
            let tile = tiles.get(key);
            if (!tile) {
                const address = point.face === undefined ? { lod, x: tileX, y: tileY } : { face: point.face, lod, x: tileX, y: tileY };
                tiles.set(key, (tile = { address, nodes: [] }));
            }
            tile.nodes.push(index);
        }
    }

    await Promise.all(
        [...tiles.values()].map(async (tile) => {
            const loaded = await heights.tileHeights(tile.address, signal);
            if (!loaded) return;
            for (const node of tile.nodes) reference[node] = loaded.sampler(us[node]!, vs[node]!);
        })
    );
    return reference;
}
