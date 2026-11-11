import type { ICartesian2, ITileAddress, ITileMetrics } from "@spacexr/tiles";
import { PolylineSimplifier } from "./simplify";
import { VectorTileGeomType, type IVectorGeoLayer, type IVectorTileContent, type IVectorTileFeature, type IVectorTileLayer } from "./types";

/** Preparation options, evaluated in the global pixel space of each LOD. */
export interface IShapeCollectionOptions {
    /** Pixel tolerance, default 2. Line variants are simplified globally before tile clipping. */
    tolerancePixels?: number;
    /** Skip radial preprocessing; retain Douglas-Peucker, default false. */
    highestQuality?: boolean;
}
/** Immutable source snapshot and lazily prepared LOD variants. Owns no camera, selector, renderer or DOM resource. */
export class ShapeCollection {
    private readonly variants = new Map<number, readonly IVectorTileLayer[]>();
    private readonly layers: readonly IVectorGeoLayer[];
    private readonly simplifier: PolylineSimplifier<ICartesian2>;
    /** Explicit source metrics define the projection, tile size and available LODs. */
    public constructor(
        public readonly metrics: ITileMetrics,
        layers: readonly IVectorGeoLayer[],
        options: IShapeCollectionOptions = {}
    ) {
        const tolerance = options.tolerancePixels ?? 2;
        if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError("Tolerance must be finite and non-negative.");
        if (new Set(layers.map((layer) => layer.name)).size !== layers.length) throw new TypeError("Vector layer names must be unique.");
        this.simplifier = new PolylineSimplifier(tolerance, options.highestQuality ?? false);
        this.layers = layers.map((layer) => ({
            name: layer.name,
            features: layer.features.map((feature) => ({
                ...feature,
                properties: Object.freeze({ ...feature.properties }),
                geometry: feature.geometry.map((path) =>
                    path.map((point) => {
                        if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) throw new RangeError("Geographic coordinates must be finite degrees.");
                        return { latitude: point.latitude, longitude: point.longitude };
                    })
                ),
            })),
        }));
    }
    /** Number of prepared LODs. Preparation is shared by all tiles at the same level. */
    public get preparedLevels(): number {
        return this.variants.size;
    }
    /** Returns the same immutable global-pixel variant on repeated requests. Polygon rings retain topology and are not simplified. */
    public get(lod: number): readonly IVectorTileLayer[] {
        if (!Number.isInteger(lod) || lod < this.metrics.minLOD || lod > this.metrics.maxLOD) throw new RangeError("LOD outside source metrics.");
        const cached = this.variants.get(lod);
        if (cached) return cached;
        const projected = this.layers.map((layer) =>
            Object.freeze({
                name: layer.name,
                extent: this.metrics.mapSize(lod),
                features: Object.freeze(
                    layer.features.map((feature) => {
                        const geometry = feature.geometry.map((path) => {
                            const points = path.map((point) => this.metrics.getLatLonToPointXY(point.latitude, point.longitude, lod));
                            const variant = feature.type === VectorTileGeomType.LINESTRING ? this.simplifier.simplify(points) : points;
                            return Object.freeze(variant.map((point) => Object.freeze({ ...point })));
                        });
                        return Object.freeze({ ...feature, properties: feature.properties ?? {}, geometry: Object.freeze(geometry) });
                    })
                ),
            })
        );
        const result = Object.freeze(projected);
        this.variants.set(lod, result);
        return result;
    }
    /** Extracts a tile from the globally simplified LOD, retaining a pixel buffer for strokes. Polygons are clipped by the rasterizer. */
    public tile(address: ITileAddress, bufferPixels = 8): IVectorTileContent {
        if (
            (address.face ?? 0) !== 0 ||
            !Number.isInteger(address.x) ||
            !Number.isInteger(address.y) ||
            address.x < 0 ||
            address.y < 0 ||
            address.x >= 2 ** address.lod ||
            address.y >= 2 ** address.lod
        )
            throw new RangeError("Vector metrics require a valid single-root XYZ address.");
        if (!Number.isFinite(bufferPixels) || bufferPixels < 0) throw new RangeError("Tile buffer must be finite and non-negative.");
        const size = this.metrics.tileSize,
            origin = this.metrics.getTileXYToPointXY(address.x, address.y);
        const minX = origin.x - bufferPixels,
            minY = origin.y - bufferPixels,
            maxX = origin.x + size + bufferPixels,
            maxY = origin.y + size + bufferPixels;
        const layers: Record<string, IVectorTileLayer> = Object.create(null) as Record<string, IVectorTileLayer>;
        for (const layer of this.get(address.lod)) {
            const features: IVectorTileFeature[] = [];
            for (const feature of layer.features) {
                const points = feature.geometry.flat();
                if (!points.length || !points.some((p) => p.x >= minX) || !points.some((p) => p.x <= maxX) || !points.some((p) => p.y >= minY) || !points.some((p) => p.y <= maxY))
                    continue;
                const geometry =
                    feature.type === VectorTileGeomType.LINESTRING
                        ? feature.geometry.flatMap((path) => clipLine(path, minX, minY, maxX, maxY))
                        : feature.type === VectorTileGeomType.POINT
                          ? feature.geometry.map((path) => path.filter((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)).filter((path) => path.length)
                          : feature.geometry;
                if (!geometry.length) continue;
                features.push(
                    Object.freeze({
                        ...feature,
                        geometry: Object.freeze(geometry.map((path) => Object.freeze(path.map((p) => Object.freeze({ x: p.x - origin.x, y: p.y - origin.y }))))),
                    })
                );
            }
            layers[layer.name] = Object.freeze({ name: layer.name, extent: size, features: Object.freeze(features) });
        }
        return Object.freeze({ layers: Object.freeze(layers) });
    }
}

/** Parametric XY clipping migrated from the corrected SpaceXR polyline implementation. */
function clipLine(path: readonly Readonly<ICartesian2>[], minX: number, minY: number, maxX: number, maxY: number): ICartesian2[][] {
    const parts: ICartesian2[][] = [];
    let points: ICartesian2[] = [];
    const flush = () => {
        if (points.length > 1) parts.push(points);
        points = [];
    };
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!,
            b = path[i]!;
        let start = 0,
            end = 1;
        for (const [origin, delta, min, max] of [
            [a.x, b.x - a.x, minX, maxX],
            [a.y, b.y - a.y, minY, maxY],
        ]) {
            if (delta === 0) {
                if (origin! < min! || origin! > max!) end = -1;
            } else {
                const t0 = (min! - origin!) / delta!,
                    t1 = (max! - origin!) / delta!;
                start = Math.max(start, Math.min(t0, t1));
                end = Math.min(end, Math.max(t0, t1));
            }
        }
        if (end <= start) {
            flush();
            continue;
        }
        const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        if (start > 0) flush();
        if (!points.length) points.push(at(start));
        points.push(at(end));
        if (end < 1) flush();
    }
    flush();
    return parts;
}
