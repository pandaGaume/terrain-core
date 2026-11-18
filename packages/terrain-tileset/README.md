# @spacexr/terrain-tileset

Terrain tilesets for the shared 3D Tiles runtime: the tiling schemes of `@spacexr/tiles` presented as implicit 3D Tiles, and the terrain grids built on them. Renderer-neutral; renderers such as `@spacexr/3d-tiles-babylon` consume it.

| Export                                                                                            | Role                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WebMapTileDataSource`, `createWebMapImplicitSource`                                              | XYZ or TMS Web Mercator pyramid as an implicit tileset                                                                                                    |
| `CubeTileDataSource`, `createCubeImplicitSource`, `cubeTileBoundingBox`                           | A whole body on the equi-angular cube: an explicit root and the implicit quadtrees of its faces, oriented boxes and geometric errors that follow the cube |
| `ITerrainTiling`, `webMercatorTiling`, `cubeTiling`                                               | What a terrain engine needs of a tiling: surface, topology, tile centres and shapes, picking geometry, normals, DEM areas                                 |
| `TerrainPickPatch`, `pickTerrain`, `ITerrainRay`, `ITerrainPickHit`                             | Coarse pick surface of a terrain tile, sampled once from its heights and following the vertical scale without sampling again; nearest hit of a body-frame ray on a set of them, without renderer objects |
| `createGeodesicGridSource`, `createCubeGridSource`, `metadataTileAddress`                         | Terrain grid tiles of a tiling, with height ranges prepared by a DEM pyramid                                                                              |
| `gridShape`, `tileCenterEcef`, `tileCenterLongitude`, `tileCenterLatitude`, `webMercatorLatitude` | Web Mercator tile geometry in double precision                                                                                                            |

Geodetic systems, reference surfaces, metrics and grid cells are explicit inputs. The 3D Tiles runtime holds no tiling scheme: this package is where a scheme becomes a tileset. See [the tiling decision](../../../spacexr-tiling/docs/architecture.md).
