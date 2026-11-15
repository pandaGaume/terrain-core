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

## Component architectural memory

Before modifying code, identify its components and read [SPX-DEM-001](packages/dem/COMPONENT.md) and the [federated component index](../atmosphere-core-r1-7-1/docs/architecture/COMPONENT_INDEX.md). Read the linked ADRs, optimization history, invariants and actual execution paths. Establish the required performance baseline when a change can affect GPU work, and record CHANGE_IMPACT before source edits. Preserve repository ownership; do not duplicate the renderer, DEM preparation or the single TileRuntime.

Documentation is a required deliverable of every code modification, including fixes, refactoring, interfaces, tooling and optimizations. Deliver the code, its component documentation and traceable history entry in the same change set and commit. Do not defer documentation to the end of a version, a later task or a follow-up pull request. Detail is proportional to impact; the obligation has no small-change exemption. Update affected ADRs, dependencies, execution paths, optimization records, tests and measured performance references. Preserve historical decisions and immutable raw benchmarks. Use RATIONALE_UNKNOWN and COST_NOT_ISOLATED when evidence is missing; do not invent rationale, measurements or qualification. A change is incomplete while current-behavior documentation is stale or its history, evidence and qualification limits are missing.

The shared policy and CI checks live in the audit hub. Their automatic structural checks do not replace architectural review or scientific qualification. Use the existing verification commands with already installed tools; any package or tool installation, update or npm ci requires explicit user approval.
