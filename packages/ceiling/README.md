<img src="https://raw.githubusercontent.com/pandaGaume/3d-tiles-core/main/assets/brand/spacexr-component.png" alt="SpaceXR Component" height="56">

# @spacexr/ceiling

Renderer-neutral ceiling of an underground observation chamber. The ceiling is a surface of its own, hung under a reference surface sampled from elevation data, and raised where needed to clear the underground content the chamber shows. It is not the back face of a terrain, and it is not a terrain tile.

The package has no dependency. It gives heights on a grid; a renderer turns them into a mesh. Contracts, units and frames are in [docs/ceiling.md](../../docs/ceiling.md).

## Use

```ts
import { buildCeiling, createCeilingLayout, sampleTiledReference } from "@spacexr/ceiling";

// 1. Where the ceiling stands: the envelope of the content, the extent of the chamber and its grid.
const layout = createCeilingLayout({
    settings: { depth: 40, minDepth: 5, clearance: 10, margin: 50, cellSize: 10 }, // metres
    content, // points of the underground content: x east, y north, z height
});

// 2. The reference surface at the nodes, from one level of a DEM pyramid, whatever a view displays.
const reference = await sampleTiledReference(layout, {
    heights: demPyramid, // a DemPyramid of @spacexr/dem
    lod: 14,
    locate: (x, y) => projectToPyramid(x, y), // x eastward, y southward in [0, 1]
});

// 3. The ceiling: reference - depth, raised over the content.
const ceiling = buildCeiling(layout, reference);
ceiling.heights; // Float32Array, (columns + 1) * (rows + 1), rows north to south
ceiling.report; // nodes missing, lifted or limited, and the smallest clearance met
```

`sampleReference(layout, (x, y) => height)` does step 2 from a function.

## Grown surface

`growSurface(volume, { seed, edgeLength })` shapes the chamber: a closed surface that starts as a small sphere and grows along its normals until the volume stops it, splitting its faces in three as they grow. The volume is a composition of constraints:

```ts
import { convexHull, createHullVolume, createPathVolume, createUnderSurfaceVolume, growSurface, intersectVolumes, uniteVolumes } from "@spacexr/ceiling";

const volume = intersectVolumes([
    createUnderSurfaceVolume((x, y) => ground(x, y) - 5), // never nearer the ground than 5 m
    uniteVolumes([
        intersectVolumes([createUnderSurfaceVolume((x, y) => ground(x, y) - 40), createHullVolume(convexHull(ore)!, 30)]),
        createPathVolume(drillHole, 12), // a chimney around a drill hole, up to its collar
    ]),
]);
const { mesh, report } = growSurface(volume, { seed, edgeLength: 8 });
mesh.positions; // Float64Array, a closed mesh wound outwards
```

`GrownSurface` runs the same growth one `step()` at a time, to show it growing.

## Chamber

`growChamber` builds that volume from the content and grows the surface in it:

```ts
import { growChamber } from "@spacexr/ceiling";

const { mesh, report } = growChamber({
    settings: { depth: 40, minDepth: 5, clearance: 10, attraction: 1, edgeLength: 8 }, // metres, attraction 0 to 1
    objects: [
        { points: orePoints }, // a solid, by its convex hull
        { kind: "path", points: drillHole, attraction: 1 }, // a drill hole, a drift, a camera track
    ],
    reference: (x, y) => ground(x, y), // height of the ground
});
report.unreached; // objects the surface does not hold
```

Attraction 1 keeps the clearance around each object; attraction 0 fills the hull of all the content. `top: "ceiling"` (the default) opens the chamber over the objects up to the ceiling, `top: "content"` keeps the top as near them as the walls. Both `attraction` and `top` can be set on the chamber and on each object.

## Rock face

`buildRockFace` turns any closed mesh, a chamber among others, into a rock face seen from inside: refined, then moved along its normals into the rock by an erosion field (fissures, ledges, faults), within a limit. Where the rock or the void is thin, as the wedge of rock between a tunnel and the chamber it opens into, each move is cut to a share of the room ahead of it, so that the face does not cross itself; `face.report.limited` counts those vertices.

```ts
import { buildRockFace, growChamber } from "@spacexr/ceiling";

const { mesh } = growChamber(input);
const face = buildRockFace(mesh, {
    edgeLength: 6, // metres, longest edge after refinement
    maxDisplacement: 4, // metres, keep it under the clearance
    scale: 0.25, // 1 is a pit 4 km across; smaller keeps the look at a smaller size
});
face.positions; // Float64Array, moved; face.normals and face.indices in the winding of the input
face.detailWavelength; // relief under this wavelength is for the renderer to add per pixel
```

## Envelope and convex hull

`createContentEnvelope(points, clearance)` builds the volume the ceiling stays over: the convex hull of the points, grown by the clearance. Content without volume (one drill hole, one flat level, fewer than four points) is stood for by its bounding box. `convexHull(points)` and the `QuickHull` class give the hull itself as a closed triangle mesh, or `undefined` for a set without volume.

The quickhull is ported from SpaceXR core, itself a port of the implementation of Oskar Sigvardsson.

## Limits

- The envelope is convex: it is larger than content that bends or branches, so the ceiling can rise over ground where there is no content.
- The ceiling steps between a node over the envelope and its neighbour beside it when the content is shallower than `depth + clearance`.
- Missing reference heights stay missing: the ceiling has `NaN` there.
