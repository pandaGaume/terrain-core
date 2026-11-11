# Raster draping

Terrain and imagery can have different resolutions while sharing the same 3D Tiles runtime implementation. An application may configure separate instances for their selections. Raster residency and page mappings bind the available imagery to the terrain geometry cut.

CPU mesh and GPU instancing presentations reuse generic addresses, ancestor areas, topology and source registration. Their data and cache ownership remain explicit. A provider, body or projection is not inferred from an image or tile identifier.

The reference demonstration supplies an Earth fixture and Mapzen data explicitly. That configuration is outside the public raster and terrain packages. See [framework architecture](../../spacexr-rendering/docs/architecture.md).
