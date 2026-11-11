import type { ICartesian2, IGeographic2 } from "@spacexr/tiles";

/** Geometry kinds retained from SpaceXR's vector tiles. */
export enum VectorTileGeomType {
    UNKNOWN = 0,
    POINT = 1,
    LINESTRING = 2,
    POLYGON = 3,
}
/** Geographic source feature. Coordinates are degrees, rings and paths are separate arrays. */
export interface IVectorGeoFeature {
    readonly id?: string | number;
    readonly type: VectorTileGeomType;
    readonly geometry: readonly (readonly Readonly<IGeographic2>[])[];
    readonly properties?: Readonly<Record<string, string | number | boolean | null>>;
}
/** Immutable feature projected to global LOD pixels or local tile pixels. Polygon paths are rings, including holes. */
export interface IVectorTileFeature {
    readonly id?: string | number;
    readonly type: VectorTileGeomType;
    readonly properties: Readonly<Record<string, string | number | boolean | null>>;
    readonly geometry: readonly (readonly Readonly<ICartesian2>[])[];
}
/** Named data layer, distinct from a cartographic layer or a paint rule. */
export interface IVectorTileLayer {
    readonly name: string;
    readonly extent: number;
    readonly features: readonly IVectorTileFeature[];
}
/** Tile content with named layers. Values use local tile pixels, with optional buffered coordinates outside the extent. */
export interface IVectorTileContent {
    readonly layers: Readonly<Record<string, IVectorTileLayer>>;
}
/** Named immutable geographic data layer. */
export interface IVectorGeoLayer {
    readonly name: string;
    readonly features: readonly IVectorGeoFeature[];
}
/** Constant styles supported by the migrated rasterizer. Widths, translations and radii are map pixels at VectorRasterSource styleLOD. */
export interface IVectorLayerStyle {
    readonly sourceLayer: string;
    readonly type: "line" | "fill" | "circle";
    readonly color?: string;
    readonly outlineColor?: string;
    readonly width?: number;
    readonly radius?: number;
    readonly opacity?: number;
    readonly dashArray?: readonly number[];
    readonly translate?: readonly [number, number];
    readonly visible?: boolean;
}
/** Paint rules in explicit drawing order. No expression language or label layout is implied. */
export interface IVectorStyle {
    readonly layers: readonly IVectorLayerStyle[];
}
