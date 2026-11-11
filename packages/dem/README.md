# @spacexr/dem

Generic elevation data on `@spacexr/raster`: numeric codecs, worker decoding, statistics, normals, loading and continuous pyramid surfaces. There is no body catalogue, cube adapter or network provider preset.

`IDemTileSource` combines a configured `WebTileSource` with its `DemEncoding`. Supply it to `webDemTileLoader` or `loadDemTile`. Build `DemPyramid` with explicit source levels, raster registration, loader and cache options. Terrarium, Terrain-RGB and normal-image decoders describe data formats; their support does not select a body or service.

The application supplies the physical surface. `webMercatorSurfaceNormal` requires its radius explicitly. The data source resolution and the spatial refinement level remain distinct. Heights beyond the available data use their ancestor area according to the configured pyramid policy.

Mapzen URLs and source factories now belong to `spacexr-rendering/examples/babylon-implicit-grid-mapzen/src/providers`. Their tests run with the sample. Generic DEM tests use a local synthetic provider. The removed cube factories are not part of the public API.

See [elevation contracts](../../docs/dem.md) and [physical ownership](../../../spacexr-rendering/docs/architecture.md).
