# @spacexr/vector

SpaceXR vector preparation, migrated to the renderer-neutral terrain workspace. The package keeps geographic source features, globally prepared LOD variants and transparent raster tiles separate. It has no camera, traversal or second streaming runtime.

## Entry points

- `@spacexr/vector`: plain geometry contracts, `ShapeCollection`, `PolylineSimplifier`. No DOM or renderer imports.
- `@spacexr/vector/browser`: `TileVectorRenderer`, `VectorRasterSource`. Canvas rendering works in browsers or workers; callers may inject a canvas factory.

Coordinates supplied to a collection are latitude/longitude in degrees. Explicit `ITileMetrics` project them into global map pixels separately for each LOD. `collection.get(lod)` returns the same immutable prepared variant on repeat requests. Lines are simplified globally before clipping, using a tolerance in pixels of that LOD. Polygon rings retain their source topology and are clipped by Canvas during rasterization, avoiding the unqualified legacy polygon clipper.

`collection.tile(address)` localizes the variant to one XYZ tile, retaining a configurable buffer. IDs and properties survive preparation. `VectorRasterSource` caches non-premultiplied four-channel images using the existing `@spacexr/tiles` `TilePyramid`. Blank tiles are valid transparent RGBA images, not missing terrain.

## Integration

```ts
import { ShapeCollection } from "@spacexr/vector";
import { VectorRasterSource } from "@spacexr/vector/browser";

const collection = new ShapeCollection(metrics, geographicLayers, {
    tolerancePixels: 2,
});
const vectors = new VectorRasterSource({
    collection,
    style,
    styleLOD: 12,
    cacheEntries: 256,
});
await vectors.precompute(explicitAddresses);

// Feed the existing raster pages used by the terrain material.
const imagery = {
    load: vectors.load,
    tileSize: vectors.tileSize,
    maxLOD: vectors.maxLOD,
    registration: vectors.registration,
    wrapX: true,
};
```

`precompute()` accepts an explicit bounded tile list. It fills the same cache used by later runtime loads and does not select visible tiles. Geometry variants are cached independently from images. Repeated image requests share loading through `TilePyramid`; abort signals are forwarded. Source data and style are immutable snapshots: construct a replacement source for a changed dataset or style and replace/invalidate the consumer's raster pages as well.

Widths, radii, translations and dash lengths are map pixels **at `styleLOD`**, which defaults to the source maxLOD. At another tile LOD, they are multiplied by `2 ** (lod - styleLOD)`. Their geographic footprint therefore stays constant across parent/child substitutions and camera zoom. This is not a constant-screen-pixel mode. That would require a view-dependent style and raster cache policy.

Raster registration is `area`, matching Canvas pixel centres. The existing raster pyramid performs neighbour stitching and ancestor UV mapping. Calls beyond vector maxLOD must use that ancestor mapping, not treat a parent image as the complete child image. Geographic locations are independent of terrain tessellation.

## Supported scope

Constant ordered rules support lines, polygon fills and holes, multipoint circles, opacity, colour, width, radius, outlines, translations and dash arrays. Source layer names are distinct from paint rules. Widths are projected map units; physical metre width varies with projection scale. Dash phase restarts on a clipped path.

This migration targets a single-root XYZ map supplied by metrics. Input paths crossing the longitude discontinuity must be split upstream. It does not introduce MVT decoding dependencies, labels, picking, extrusions, Mapbox expressions, a spatial index or a GPU vector renderer. A demonstration lives in `spacexr-rendering/examples/babylon-vector-terrain`.

## Migration from SpaceXR

| Legacy code | Migrated responsibility |
| --- | --- |
| `tiles/geography/tiles.geography.collection.ts` | `ShapeCollection`: source snapshot, projected per-LOD variants |
| `geometry/geometry.simplify.ts` | Corrected pixel-tolerance simplifier with original attribution |
| `tiles/vector/tiles.vector.feature.builder.ts` | Tile extraction, coordinate localization, immutable copies and preserved rings |
| `tiles/vector/tiles.vector.renderer.ts` | Browser Canvas renderer, with clean alpha, polygon holes and complete multipoints |
| `VectorToImageTileCodec` | Transparent `IRgbaImage` production, independent of Mapbox |
| Legacy cache/fetcher | Existing shared `TilePyramid`, without migrating the old cache implementation |

The legacy source remains for existing applications. The active package imports none of it. Its classes and builders are not promised as drop-in API replacements; migrate to explicit geographic layers and constant paint rules. The existing 3D Tiles runtime remains unchanged.

## Checks

Run `npm run check` from `terrain-core`. The vector tests cover per-LOD simplification, immutable source snapshots, neighbour coordinates, rings and multipoints, cached precalculation, cancellation and stable paint footprint across tile levels. Browser integration additionally verifies transparent pixels and the live terrain sample.
