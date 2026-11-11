# Elevation contracts

A DEM is a numeric height grid with explicit units, registration and missing values. Its source supplies addressing, levels, encoding and availability. Physical surface characteristics come from the application, normally using the Celestial model.

`DemPyramid` samples its configured raster hierarchy and tracks source/ancestor regions. `ChildHeightRanges` records measured ranges. `webDemTileLoader` and `loadDemTile` use the generic `IDemTileSource`. Source URLs, provider limits and attribution are application configuration.

Heights, gradients, normal reconstruction and spatial bounds use the same declared surface and units. The source level does not imply that the runtime must stop spatial subdivision. This delivery retains the existing interpolation behavior; morphological refinements remain separate work.

Cube datasets, radial cube loaders and body-specific producers have been removed. The reusable surface mathematics remains parameterized. See [raster contracts](raster.md), [grid geometry](grid.md) and [framework layers](../../spacexr-rendering/docs/architecture.md).
