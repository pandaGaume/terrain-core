# Terrain pick patches built once per tile

Date: 17 November 2026. Branch: `feat/core-pick-coarsening`, from `main` `475e301`. Same branch name in `3d-tiles-core` and `spacexr-rendering`. Not merged with `feat/excavation`.

## Change impact

**Request.** The user asked to move the CPU picking surface of the GPU terrain onto the tile: sampled once from the DEM when the tile is created, beside its bounding volume, and changed only by the vertical exaggeration. The goal is less CPU work per frame and per cut change. Measurement was explicitly deferred by the user.

**Components.** `@spacexr/terrain-tileset` (`ITerrainTiling.pickGeometry`, unchanged) gains a renderer-neutral `TerrainPickPatch` and `pickTerrain`. `SPX-DEM-001` is only read through `DemPyramid.heightAt`, by the renderer, when the tile is activated. No selection, runtime, DEM preparation or shader is changed. The federated component index (`../atmosphere-core-r1-7-1/docs/architecture/COMPONENT_INDEX.md`) is not present in this workspace and could not be read.

**Previous execution path (`spacexr-rendering` `main`).** `PickSurface` created one Babylon `Mesh` per presented terrain tile, sampling `pickCells` (8) squared DEM heights through `pickGeometry` each time a tile entered the cut, each time its DEM came back after eviction (`refresh`) and for every tile on a vertical scale change. Every mesh stayed in `scene.meshes`, which Babylon walks every frame in `_evaluateActiveMeshes` before the layer mask rejects it. The meshes had no material, so Babylon picked their bounding boxes, not their triangles, unless the scene had created a default material.

**New execution path.**

1. `GpuTerrainEngine.activate` builds a `TerrainPickPatch` with the tile, after its heights are loaded, beside the bounding volume. It samples the heights once, with a second call of `pickGeometry` at zero height.
2. Geodetic and radial positions are affine in the height, so the patch keeps the zero-height positions and the displacement of the measured heights. A vertical scale change recomputes `surface + relief * scale` without sampling the DEM. A height of `NaN` is the reference surface, as before.
3. `pickTerrain` intersects a body-frame ray with the patches: slab test of each patch's bounds, then Moller-Trumbore on its triangles, from either side. No renderer object is involved; applications can call `GpuTerrainEngine.pickTerrain`.
4. Babylon's own picking still needs a mesh: `GeospatialCamera` calls `scene.pick` when a drag starts and on every zoom frame toward the cursor. The renderer therefore gathers the presented patches into one mesh, with one sub-mesh per tile so that Babylon keeps its bounding test per tile, and a plain triangle material so that it picks triangles. This copy runs when the cut or the vertical scale changes, not per frame.

**Invariants.** Units are metres, in the body-fixed frame of the tiling (ECEF for Web Mercator). Patch positions are 32-bit floats relative to their tile centre, as `pickGeometry` returns them; the gathered mesh is relative to the centre of its finest tile. Pick geometry is coarse (`pickCells` per side): a hit is on that surface, not on the drawn 64-cell grid. A patch keeps the heights read at activation; if a finer DEM becomes available later for an already active tile, the patch is not resampled, like its bounding volume.

**Costs.** No measurement was made, by user decision: `COST_NOT_ISOLATED`. Expected effects, not measured: one scene mesh instead of one per presented tile in the per-frame mesh evaluation; no DEM sampling on cut changes, DEM returns or vertical scale changes. Added cost: two `pickGeometry` calls per activated tile, two `Float32Array` of `(pickCells + 1)^2 * 3` floats kept per tile handle, and the copy of all presented patches into one mesh on each cut change. Triangle picking instead of bounding-box picking costs more per pick.

**Rationale.** Gathering into one mesh instead of keeping one mesh per tile follows from the per-frame walk of `scene.meshes`; the use of Babylon sub-meshes for the per-tile bounding test follows from Babylon's picking code (`AbstractMesh.intersects`, `SubMesh.canIntersects`). The choice of the finest tile as origin of the gathered mesh is a precision heuristic, `RATIONALE_UNKNOWN` beyond that the finest tile is usually nearest the camera.

## Verification

`terrain-pick.test.ts` covers the reference surface for missing heights, measured heights, a vertical scale change without new samples, hits from below, misses, the maximum distance and the nearest of several patches. The rendering test `body-frame.test.ts` checks that two patches give one mesh with two sub-meshes, parented to the body frame with its metadata, never drawn, and none for an empty cut. The browser behaviour of `GeospatialCamera` drag and zoom on the gathered mesh is not verified.
