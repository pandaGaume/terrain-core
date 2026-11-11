import { describe, expect, it, vi } from "vitest";
import type { ITileMetrics } from "@spacexr/tiles";
import { ShapeCollection, VectorTileGeomType, type IVectorGeoLayer } from "../src/index";
import { TileVectorRenderer, VectorRasterSource } from "../src/browser";

const metrics = {
    minLOD: 0,
    maxLOD: 4,
    tileSize: 256,
    mapSize: (lod: number) => 256 * 2 ** lod,
    getLatLonToPointXY: (latitude: number, longitude: number, lod: number) => ({ x: longitude * 2 ** lod, y: latitude * 2 ** lod }),
    getTileXYToPointXY: (x: number, y: number) => ({ x: x * 256, y: y * 256 }),
} as ITileMetrics;
const line = (points: number[][]): IVectorGeoLayer[] => [
    {
        name: "roads",
        features: [{ id: "road", type: VectorTileGeomType.LINESTRING, properties: { kind: "demo" }, geometry: [points.map(([x, y]) => ({ longitude: x!, latitude: y! }))] }],
    },
];

describe("migrated LOD vector preparation", () => {
    it("prepares and reuses an immutable variant per LOD without touching the source", () => {
        const source = line([
            [10, 10],
            [15, 10.8],
            [20, 10],
        ]);
        const collection = new ShapeCollection(metrics, source, { tolerancePixels: 2, highestQuality: true });
        (source[0]!.features[0]!.geometry[0]![0]! as { longitude: number }).longitude = 99;
        const coarse = collection.get(0),
            fine = collection.get(3);
        expect(coarse).toBe(collection.get(0));
        expect(coarse[0]!.features[0]!.geometry[0]).toHaveLength(2);
        expect(fine[0]!.features[0]!.geometry[0]).toHaveLength(3);
        expect(coarse[0]!.features[0]!.geometry[0]![0]!.x).toBe(10);
        expect(Object.isFrozen(coarse[0]!.features[0]!.geometry[0]![0])).toBe(true);
        expect(collection.preparedLevels).toBe(2);
        expect(() => collection.get(1.5)).toThrow(RangeError);
    });
    it("clips crossings and uses local coordinates agreeing at neighbouring tile edges", () => {
        const collection = new ShapeCollection(
            metrics,
            line([
                [100, 40],
                [200, 40],
            ])
        );
        const left = collection.tile({ lod: 1, x: 0, y: 0 }, 0).layers.roads!.features[0]!;
        const right = collection.tile({ lod: 1, x: 1, y: 0 }, 0).layers.roads!.features[0]!;
        expect(left.geometry).toEqual([
            [
                { x: 200, y: 80 },
                { x: 256, y: 80 },
            ],
        ]);
        expect(right.geometry).toEqual([
            [
                { x: 0, y: 80 },
                { x: 144, y: 80 },
            ],
        ]);
        expect(left.id).toBe(right.id);
        expect(left.properties).toEqual({ kind: "demo" });
        const before = JSON.stringify(collection.get(1));
        collection.tile({ lod: 1, x: 1, y: 1 });
        expect(JSON.stringify(collection.get(1))).toBe(before);
    });
    it("retains polygon rings and multipoints, including buffered content", () => {
        const collection = new ShapeCollection(metrics, [
            {
                name: "areas",
                features: [
                    {
                        type: VectorTileGeomType.POLYGON,
                        geometry: [
                            [
                                { latitude: 10, longitude: 10 },
                                { latitude: 10, longitude: 40 },
                                { latitude: 40, longitude: 40 },
                            ],
                            [
                                { latitude: 15, longitude: 15 },
                                { latitude: 15, longitude: 20 },
                                { latitude: 20, longitude: 20 },
                            ],
                        ],
                    },
                ],
            },
            {
                name: "points",
                features: [
                    {
                        type: VectorTileGeomType.POINT,
                        geometry: [
                            [
                                { latitude: 20, longitude: 129 },
                                { latitude: 30, longitude: 60 },
                            ],
                        ],
                    },
                ],
            },
        ]);
        const tile = collection.tile({ lod: 1, x: 0, y: 0 }, 8);
        expect(tile.layers.areas!.features[0]!.geometry).toHaveLength(2);
        expect(tile.layers.points!.features[0]!.geometry[0]).toHaveLength(2);
        expect(tile.layers.points!.features[0]!.geometry[0]![0]!.x).toBe(258);
        expect(() => collection.tile({ lod: 1, x: 0, y: 0, face: 1 })).toThrow(RangeError);
    });
});

describe("transparent raster cache", () => {
    it("shares prerendered tiles with runtime loads and never redraws cache hits", async () => {
        const collection = new ShapeCollection(
            metrics,
            line([
                [5, 5],
                [25, 25],
            ])
        );
        const calls: string[] = [];
        const context = {
            save: () => {},
            restore: () => {},
            resetTransform: () => {},
            clearRect: () => calls.push("clear"),
            beginPath: () => {},
            rect: () => {},
            clip: () => {},
            setLineDash: () => {},
            moveTo: () => {},
            lineTo: () => {},
            stroke: () => calls.push("stroke"),
            getImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4) }),
        };
        const createCanvas = vi.fn(() => ({ width: 256, height: 256, getContext: () => context }) as unknown as OffscreenCanvas);
        const source = new VectorRasterSource({ collection, style: { layers: [{ sourceLayer: "roads", type: "line", color: "red", width: 3 }] }, createCanvas });
        const address = { lod: 1, x: 0, y: 0 };
        await source.precompute([address]);
        const a = await source.load(address),
            b = await source.load(address);
        expect(a).toBe(b);
        expect(a?.channels).toBe(4);
        expect(calls).toEqual(["clear", "stroke"]);
        expect(createCanvas).toHaveBeenCalledTimes(1);
        expect(collection.preparedLevels).toBe(1);
        await expect(source.load({ lod: 5, x: 0, y: 0 })).rejects.toThrow(RangeError);
        const aborted = new AbortController();
        aborted.abort(new Error("cancelled"));
        await expect(source.load({ lod: 1, x: 1, y: 1 }, aborted.signal)).rejects.toThrow("cancelled");
    });
});

describe("stable paint footprint across tile LODs", () => {
    it("scales point radius and stroke width with map resolution, not with the selected terrain level", () => {
        const radii: number[] = [],
            widths: number[] = [];
        const context = {
            save: () => {},
            restore: () => {},
            resetTransform: () => {},
            clearRect: () => {},
            beginPath: () => {},
            rect: () => {},
            clip: () => {},
            setLineDash: () => {},
            arc: (_x: number, _y: number, r: number) => radii.push(r),
            fill: () => {},
            stroke: () => widths.push(context.lineWidth),
            lineWidth: 0,
        };
        const tile = { layers: { points: { name: "points", extent: 256, features: [{ type: VectorTileGeomType.POINT, properties: {}, geometry: [[{ x: 128, y: 128 }]] }] } } };
        const style = { layers: [{ sourceLayer: "points", type: "circle" as const, color: "red", outlineColor: "white", radius: 5, width: 2 }] };
        const renderer = new TileVectorRenderer();
        for (const lod of [8, 10, 12, 14]) renderer.renderTile(tile, context as unknown as OffscreenCanvasRenderingContext2D, style, 256, 2 ** (lod - 12));
        expect(radii.map((radius, i) => radius / (256 * 2 ** [8, 10, 12, 14][i]!))).toEqual(Array(4).fill(5 / (256 * 2 ** 12)));
        expect(widths.map((width, i) => width / (256 * 2 ** [8, 10, 12, 14][i]!))).toEqual(Array(4).fill(2 / (256 * 2 ** 12)));
    });
});
