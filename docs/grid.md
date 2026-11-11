# Grid geometry

The grid package produces reusable normalized topologies and junction variants for neighbouring levels of detail. It does not select tiles, load a body catalogue or create renderer objects.

`buildGridTileGeometry` receives a topology, tile address and explicit `ITileSurface`. Positions are relative to a double-precision tile centre; up vectors state the displacement direction. `buildGridTileShape` produces reusable local shapes from the same supplied surface.

The single runtime selects the geometry cut. Rendering engines use this topology and the configured DEM. Junction and boundary calculations use the declared neighbour topology. The current generic framework contains no cube implementation or body-specific grid factory.
