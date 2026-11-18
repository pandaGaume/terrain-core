# Ceiling of an underground observation chamber

Date: 17 November 2026. Written in the working tree of `feat/core-pick-coarsening`, not committed. Independent of `feat/excavation`, which cuts the terrain itself.

## Change impact

**Request.** The user asked for step 1 of the brief "Chambre d'observation souterraine" (v3): the geometry of a ceiling that is its own surface under the terrain, not the back face of the surface DEM. The user also asked to take the quickhull of SpaceXR core (`SpaceXR/packages/dev/core/src/geometry/geometry.convex.quickhull.ts`) for the envelope of the underground content.

**Components.** A new package, `@spacexr/ceiling`, with no dependency. No existing package, export or numerical behaviour changes. `SPX-DEM-001` is not modified: a `DemPyramid` can give the reference heights through `tileHeights`, which the new package only knows by its shape. No selection, runtime, DEM preparation, renderer or shader is touched. The package has no identifier in the federated component index (`../atmosphere-core-r1-7-1/docs/architecture/COMPONENT_INDEX.md`), which is not present in this workspace and could not be read.

**Execution path (new, CPU only).**

1. `createCeilingLayout` builds the envelope of the content points, a convex hull grown by the clearance, then the extent of the chamber and its grid of nodes at a fixed spacing.
2. The application samples the reference surface at the nodes: `sampleReference` with a function, or `sampleTiledReference` with the tiles of one level of a pyramid, loaded once. The level is chosen by the application; the camera cut has no part in it.
3. `buildCeiling` gives each node `reference - depth`, lifted where the envelope stands higher, and never nearer the reference surface than `minDepth`.

**Invariants.** Horizontal positions and heights are metres. `x` is east and `y` north in a frame chosen by the application; heights are in the vertical datum of the reference surface, and the content must be given in that same datum. Rows run north to south and columns west to east, as `IHeightGrid`. A missing reference height (`NaN`) gives a missing ceiling height. The ceiling is not a terrain tile and follows none of the junction rules of `@spacexr/grid`.

**Quickhull port.** The algorithm is the one of SpaceXR core. Four things differ, each for a case this use meets:

- The seed tetrahedron comes from extreme points, in linear time. The original tried every quadruple until one was not coplanar, which does not end in practical time on a large flat set, for example one level of drifts.
- A flat set returns `undefined` instead of throwing, so that the envelope falls back on a box.
- One tolerance decides on which side of a face a point stands, at the seed, in the horizon search and when points are reassigned. The original mixed `0` and `EPSILON`, so a point within rounding error above a face could be added and give a sliver face without a usable normal. Box corners, which the grown envelope is made of, are exactly that case.
- The exported vertex table tested an index with `!index`, which duplicated vertex 0. The port tests `undefined`.

The per-iteration consistency assertions of the original are replaced by tests on the result.

**Costs.** No measurement was made: `COST_NOT_ISOLATED`. The work runs once per chamber, not per frame. Expected orders, not measured: the hull is `O(points * faces)`; the ceiling asks the envelope for each node, `O(nodes * upward faces)`.

**Rationale.** The grown envelope is the Minkowski sum of the hull with a box, of half width the lateral clearance and height the vertical clearance. The lateral clearance is at least one cell, so that a triangle drawn between ceiling nodes stays over the content between the nodes: the top of a convex hull is concave, and a chord of a concave surface lies under it. The default tolerance of the hull, `1e-7` of the largest dimension of the points, is `RATIONALE_UNKNOWN` beyond being well over the rounding error of 64-bit coordinates.

## Verification

`quickhull.test.ts`: a tetrahedron, a cube filled with coplanar and inner points, random clouds, duplicated points and flat sets; each hull is closed, wound outwards, convex and holds every point. `content-envelope.test.ts`: the top of the envelope, its clearance and the box of a flat set. `ceiling.test.ts`: the layout, the depth, the lift over shallow content, the `minDepth` limit, missing heights and the report. `tiled-reference.test.ts`: tiles loaded once each, absent tiles and the tile edges. The mesh and its rendering are step 2 and are not part of this change.

## Second change, same day: a surface grown inside a volume

**Request.** After step 1 the user chose another way to shape the chamber than a hull tightened around the content: an adaptive closed surface that starts as one sphere and grows until geometric constraints stop it. The user asked for triangles split in three by a vertex at the centre of the face, for vertices moved along the mean normal at the vertex, and to start with a single sphere. Seeds joined by tubes were set aside by the user.

**Components.** Two new modules in `@spacexr/ceiling`: `grown-surface.ts` and `volumes.ts`, and `ceilingHeightAt` in `ceiling.ts`. Nothing existing changes behaviour. Still no dependency, no renderer, CPU only, once per chamber.

**Execution path (new).**

1. The surface starts as an icosahedron around the seed, inside the volume.
2. Each step moves every free vertex along its normal, the angle-weighted mean of the normals of its faces, by the step or by half its shortest edge, whichever is smaller, and four tenths of the way towards the middle of its neighbours. A vertex whose move would leave the volume is set on the boundary by bisection and becomes fixed for good.
3. Each face larger than the area of an equilateral triangle of the edge length asked for is split in three by a vertex at its centre. A centre outside the volume is brought back inside along the normal of the face and fixed.
4. Edges are flipped where the two angles facing them add up to more than a half turn. Splitting at the centre never shortens an edge; with the flips it is the square root of three subdivision and the triangles stay regular.
5. Growth ends when no vertex moves and no face is split.

**Invariants.** The volume is only asked whether it holds a point (`IVolume.contains`), so constraints compose by intersection and union. The surface stays closed, of the topology of a sphere, wound outwards. A fixed vertex never moves again. The same volume and options give the same surface; the step is part of the options, since the path of a vertex depends on it.

**Known limits, not handled.** The surface does not test itself for contact: in a volume with a hole through it (a ring), two fronts that meet pass through each other. A vertex whose edges become very short is fixed where it stands (`squeezed` in the report). Features of the volume thinner than the step can be stepped over.

**Costs.** No measurement: `COST_NOT_ISOLATED`. Each step computes every normal, `O(faces)`, and asks the volume once per free vertex, more for the vertices that reach the boundary.

**Rationale.** Moving along the normal instead of a ray from the seed lets the surface turn a corner and fill a volume the seed does not see whole; the price is the limits above. The pull towards the neighbours was added after a first run without it: in a ball of radius 100 with edges of 10 the surface crumpled and passed 92 000 faces after 31 steps without ending; with the pull it ends in 62 steps with 4 158 faces, every vertex on the boundary. The share of four tenths is `RATIONALE_UNKNOWN`: it is the first value tried. Half the shortest edge as the largest move and one twentieth of the edge length as the squeeze threshold are `RATIONALE_UNKNOWN` beyond keeping a vertex from crossing its neighbours in one step.

**Not done.** How the chamber is made of these constraints (the attraction of each mesh, the top held on the ceiling, drill collars under `minDepth`) is not written: `buildCeiling` still lifts the ceiling over one hull of all the content.

**Verification.** `grown-surface.test.ts`: a ball, a box, two united balls, an L whose second arm the seed does not see, a ceiling with relief, and a chamber of a hull with a margin, a drill hole to the surface and a ceiling. Each surface is closed, of the topology of a sphere, inside its volume, and fills 97 % of it or more where the volume is known. Stages, repeatability, the limits and the refusals are covered too. `volumes.test.ts` covers the constraints and `ceilingHeightAt`. A volume with a hole through it is not tested, since contact is not handled. Nothing was rendered in an engine.

## Third change, same day: the constraints of a chamber

**Request.** The user pointed out that without the constraints of the chamber there is nothing to show. This change writes them: what was "not done" above.

**Components.** A new module `chamber.ts` in `@spacexr/ceiling` (`createChamberVolume`, `growChamber`), and `distance.ts`, the distances shared with `volumes.ts`. `createHullVolume` gains a test of its bounds first, with the same result. `buildCeiling` is unchanged.

**The volume of a chamber.** With `reference` the height of the reference surface, `margin = clearance + (1 - attraction) * reach` for each object and `distance` the distance to an object, a point is in the chamber when it is under `reference - minDepth` and one of these holds:

1. it is within `clearance` of an object: the chimney of a drill hole runs up to `minDepth` under the ground and no higher;
2. it is under `reference - depth`, within the margin of an object, and within `clearance` of the convex hull of all the content;
3. it is under `reference - depth` and over an object: within its margin on the ground, above its middle height, and within `clearance` on the ground of the footprint of all the content. This holds the top of the chamber on the ceiling, as the user asked ("the hull sticks to the ceiling"). It is a setting, `top`: `ceiling` keeps it, `content` leaves it out and the top is then as tight as the sides.

**Invariants.** Attraction 1 keeps the clearance only; attraction 0 with the default reach, the largest dimension of the content, fills the hull of all the content. An object is a solid (its convex hull), a path or loose points; a solid without volume is taken as loose points. Units and frame are those of the ceiling: metres, `x` east, `y` north, heights in the datum of the reference.

**Seed.** `growChamber` starts in the largest object that has room for the starting sphere, trying smaller spheres if none has. It reports the objects the surface does not hold at the end (`unreached`): the surface fills only the part of the volume connected to its seed.

**Costs.** No measurement: `COST_NOT_ISOLATED`. A point is tested against every object, by its bounds first.

**Rationale.** The question of the height of the chamber (ceiling at `depth`, or following the content) is settled: shown the four chambers of the test scene, the user chose the top on the ceiling as the default, and asked that it stay an option. `top` is a setting of the chamber and, like the attraction, an option of each object that wins over the setting: a drift can keep its top on the content while the chamber opens up to the ceiling. "Above its middle height" for the column over an object is `RATIONALE_UNKNOWN`: a simple level inside the object.

**Two faults found on a test scene (two orebodies, a drift, three drill holes) and corrected in this change.**

- At attraction 0.85 the growth did not end. The volume had a hole through it; the two fronts that went round it crossed, and a sheet of the surface swept the chamber again: the enclosed volume went from 11.6 to 42 million cubic metres between steps 120 and 230, and the faces from 14 812 to 60 544. `GrownSurface` now stops a vertex that comes within nine tenths of the edge length of a vertex facing it and ahead of it (`contact` in the report). The same scene ends in 133 steps. The limit this leaves is a thin wall where the fronts met. Nine tenths and the facing threshold (cosine under -0.2) are `RATIONALE_UNKNOWN`: first values tried, chosen so that two fronts closing at half an edge per step cannot pass each other.
- At attraction 0 the opening over the objects had a margin of several hundred metres on the ground and nothing bounded it, unlike the walls. It is now kept within `clearance` of the footprint of all the content.

**Verification.** `chamber.test.ts`: the three parts of the volume point by point, the relief of the ground, the attraction of the settings and of an object, objects without volume, unknown ground and refusals; then chambers grown whole, with a drill hole to its collar, with the top on the content, with an object left unreached, and with seeds told or made smaller. `grown-surface.test.ts` gains a slab with a pillar through it: the growth ends, the surface is closed and holds 93 % of the ring or more. The four chambers of the test scene (attraction 1, 0.85 and 0, top on the ceiling or on the content) each ended in about 0.3 s with about 10 000 faces; they were looked at as flat images drawn by a throwaway script, not in an engine.
