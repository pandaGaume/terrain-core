import { TilePyramid, type ITileAddress } from "@spacexr/tiles";
import type { IRgbaImage } from "@spacexr/raster";
import type { ShapeCollection } from "./shape-collection";
import type { IVectorStyle } from "./types";
import { TileVectorRenderer } from "./canvas-renderer";

/** Transparent vector tile preparation. Canvas creation is injectable for browser or worker hosts. */
export interface IVectorRasterSourceOptions {
    /** Immutable source and its per-LOD geometry variants. */
    collection: ShapeCollection;
    /** LOD whose map pixels define paint widths and radii. Defaults to collection maxLOD; footprint stays fixed across tile LODs. */
    styleLOD?: number;
    /** Constant paint rules. A new source is required for a new style snapshot. */
    style: IVectorStyle;
    /** Number of cached RGBA tiles, default 256. Uses the existing generic TilePyramid. */
    cacheEntries?: number;
    /** Overrides browser OffscreenCanvas allocation. Each build owns its scratch canvas. */
    createCanvas?: (size: number) => HTMLCanvasElement | OffscreenCanvas;
}
/** Cached transparent RGBA source, suitable for BabylonRasterPages and other raster consumers. No view selection. */
export class VectorRasterSource {
    /** Native tile resolution in pixels. */
    public readonly tileSize: number;
    /** Deepest prepared LOD, before the consumer's normal overzoom. */
    public readonly maxLOD: number;
    /** Pixel-centred images; let the existing raster pyramid stitch the shared edges. */
    public readonly registration = "area" as const;
    /** Existing shared cache primitive, exposed for retention and explicit invalidation. */
    public readonly tiles: TilePyramid<IRgbaImage>;
    private readonly style: IVectorStyle;
    private readonly buffer: number;
    private readonly renderer = new TileVectorRenderer();
    /** Snapshots style and prepares tiles lazily, or eagerly through precompute(). */
    public constructor(options: IVectorRasterSourceOptions) {
        this.tileSize = options.collection.metrics.tileSize;
        this.maxLOD = options.collection.metrics.maxLOD;
        const styleLOD = options.styleLOD ?? this.maxLOD;
        if (!Number.isInteger(styleLOD) || styleLOD < options.collection.metrics.minLOD || styleLOD > this.maxLOD) throw new RangeError("styleLOD must lie within source metrics.");
        this.style = {
            layers: options.style.layers.map((rule) => ({
                ...rule,
                ...(rule.dashArray ? { dashArray: [...rule.dashArray] } : {}),
                ...(rule.translate ? { translate: [rule.translate[0], rule.translate[1]] as const } : {}),
            })),
        };
        this.buffer = Math.max(2, ...this.style.layers.map((rule) => (rule.width ?? 1) / 2 + (rule.radius ?? 0) + Math.hypot(...(rule.translate ?? [0, 0])) + 2));
        this.tiles = new TilePyramid<IRgbaImage>({
            maxLOD: this.maxLOD,
            cacheEntries: options.cacheEntries ?? 256,
            load: async (address, signal) => {
                signal?.throwIfAborted();
                const canvas = options.createCanvas?.(this.tileSize) ?? new OffscreenCanvas(this.tileSize, this.tileSize);
                canvas.width = canvas.height = this.tileSize;
                const context = canvas.getContext("2d", { willReadFrequently: true });
                if (!context || !("getImageData" in context)) throw new Error("Vector tiles require a 2D canvas context.");
                const paintScale = 2 ** (address.lod - styleLOD);
                this.renderer.renderTile(options.collection.tile(address, this.buffer * paintScale + 2), context, this.style, this.tileSize, paintScale);
                const image = context.getImageData(0, 0, this.tileSize, this.tileSize);
                signal?.throwIfAborted();
                return { width: this.tileSize, height: this.tileSize, channels: 4, data: image.data };
            },
        });
    }
    /** Same-level loader for raster draping. Deeper requests must use the consumer's ancestor UV mapping. */
    public readonly load = async (address: ITileAddress, signal?: AbortSignal): Promise<IRgbaImage | undefined> => {
        if (address.lod > this.maxLOD) throw new RangeError("Use raster ancestor mapping beyond the vector maxLOD.");
        return (await this.tiles.load(address, signal))?.content;
    };
    /** Prerenders an explicit, bounded tile list using the same cache as later runtime requests. Does not select tiles. */
    public async precompute(addresses: readonly ITileAddress[], signal?: AbortSignal): Promise<void> {
        for (const address of addresses) {
            signal?.throwIfAborted();
            await this.load(address, signal);
        }
    }
}
