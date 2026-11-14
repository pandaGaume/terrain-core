# Terrain Core

Owns `@spacexr/raster`, `@spacexr/dem`, `@spacexr/grid`, `@spacexr/vector` and `@spacexr/terrain-tileset` in `packages/`. `@spacexr/terrain-tileset` presents tiling schemes and terrain grids as implicit 3D Tiles; it is the only package here that depends on the 3D Tiles runtime.
`@spacexr/tiles` (tile addressing, topologies and tiling schemes) lives in the sibling `spacexr-tiling` repository. 3D Tiles contracts and the single runtime remain in the sibling `3d-tiles-core` repository.
Keep terrain algorithms renderer-neutral. Do not introduce another selector or runtime.
Prefix TypeScript interfaces with `I`. Document units, reference frames and raster registration.
Run `npm run check` from this root. Build `../spacexr-tiling` then `../3d-tiles-core/node` first.
Keep existing package names, public exports and numerical behavior during this migration.
The current phase changes packaging, documentation and tooling only.
No npm publication without an explicit request. Trusted publishing must be configured for the new repository first.
Never use the em dash character.

## Body-neutral framework

Tiling schemes, the cube included, live in `spacexr-tiling`; this repository uses them, for example to present a scheme as a 3D Tiles tileset. Body-specific production tools and provider presets do not belong to the active generic packages. Physical surface and geodetic parameters are explicit inputs, supplied by an application or a body composition using spacexr-celestial. Body-specific constants are permitted in demonstration fixtures. Earth/Babylon/atmosphere composition belongs in the optional future babylon-earth package; do not create empty future packages.

## Authorized vector migration

The user authorized migration of SpaceXR vector LOD preparation and transparent raster tiles into packages/vector, plus a draped-vector sample in spacexr-rendering. This functional scope supersedes the packaging-only restriction for this work. Keep the core entry point free of DOM and renderer imports; Canvas belongs to the browser entry point. Reuse the existing TilePyramid and single TileRuntime. Do not add unrequested features, dependencies or rendering passes.
