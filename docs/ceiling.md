# Ceiling contracts

`@spacexr/ceiling` computes the ceiling of an underground observation chamber: heights on a grid, under a reference surface and over the content of the chamber. It runs on the CPU, once per chamber. It has no dependency and knows no renderer, no body and no tiling.

## Frame and units

- Positions on the ground are metres, `x` east and `y` north, in a frame the application chooses, for example the tangent frame of the place of the chamber.
- Heights are metres in the vertical datum of the reference surface. The content is given in the same datum. Nothing is subtracted in a body-fixed frame or in the space of a shader.
- The reference surface is the data: the heights before the vertical exaggeration or the displacement a renderer applies.

The package does not convert between frames. An application that places the ceiling on a body maps each node to that body with its own geodesy.

## Grid

`createCeilingLayout` gives `columns` by `rows` square cells of `cellSize`, so `(columns + 1) * (rows + 1)` nodes, stored row by row from the north-west corner: columns run west to east and rows north to south, as the samples of `IHeightGrid`. `ceilingNodeX` and `ceilingNodeY` give the position of a node.

The extent is the union of the extent asked for and of the envelope of the content with the margin around it, grown on both sides to a whole number of cells. The cell size does not depend on any view. A layout cannot exceed `MAX_CEILING_NODES`.

The grid is not a terrain tile: it has no neighbour and follows none of the junction rules of `@spacexr/grid`.

## Envelope

The envelope is the convex hull of the content points, grown by the clearance: above by `clearance`, on the sides by `clearance` or one cell, whichever is larger. Growing is exact: the result is the hull of the content swept by a box of that size.

The side growth of one cell at least is what keeps a surface drawn between the nodes over the content. The top of a convex hull is concave, so a segment between two nodes runs under the top of the envelope between them; with one cell of side growth it still runs over the content itself, with the clearance.

Content without volume has no hull. Its envelope is its bounding box, grown the same way.

## Height

At each node:

```text
height = reference - depth
height = max(height, top of the envelope)        over the envelope
height = min(height, reference - minDepth)       over the envelope
```

So the depth under the reference surface is `depth`, less where the content asks for it, and `minDepth` at least. No noise or relief is added.

`minDepth` wins over the clearance. Content that comes nearer the reference surface than `minDepth + clearance` is then nearer the ceiling than the clearance, or goes through it. The report counts these nodes (`limited`) and gives the smallest clearance met (`minClearance`, negative when content goes through). Which content enters the envelope is the choice of the application: a ramp to the surface or drill collars can be left out.

A node without reference height (`NaN`) has no ceiling height (`NaN`) and is counted in `missing`.

## Reference from tiles

`sampleTiledReference` reads the nodes from the tiles of one level of a pyramid. The pyramid is anything with the `tileHeights` method of `DemPyramid` (`@spacexr/dem`), the level is fixed for the whole ceiling, and `locate` places a position of the ceiling in the pyramid, `x` eastward and `y` southward in `[0, 1]`. Each tile is loaded once. A node over an absent tile, or outside the pyramid, is missing.

## Settings

`ICeilingSettings` is a plain object of five lengths in metres (`depth`, `minDepth`, `clearance`, `margin`, `cellSize`), meant to be saved with the chamber. The same settings, content and reference give the same ceiling. The package has no default values: they depend on the site.

## Grown surface

`GrownSurface` shapes the chamber itself: a closed surface that starts as a small sphere around a seed and grows until a volume stops it. `growSurface` runs it to the end.

The volume is anything that says whether it holds a point (`IVolume.contains`). Constraints are volumes and compose: `intersectVolumes`, `uniteVolumes`, a ball, a box, what is under a surface (`createUnderSurfaceVolume`, with `ceilingHeightAt` for a ceiling), a convex hull with a margin around it (`createHullVolume`) and what is within a radius of a path (`createPathVolume`: a drill hole, a drift, the track of a camera). The unit and the frame are those of the volume.

Each step:

1. Every free vertex moves along its normal, the mean of the normals of its faces weighted by their angles at the vertex, by `step` or half its shortest edge, whichever is smaller, and part of the way towards the middle of its neighbours, which keeps the surface even.
2. A vertex whose move would leave the volume is set on the boundary, within `tolerance`, and is fixed for good.
3. A face larger than an equilateral triangle of `edgeLength` is split in three by a vertex at its centre. A centre outside the volume is brought back inside along the normal of the face and fixed.
4. An edge is flipped when the two angles facing it add up to more than a half turn. With the split at the centre this is the square root of three subdivision: a face is refined without touching its neighbours and the triangles stay regular.

The growth ends when no vertex moves and no face is split. The report counts the steps, the vertices still free, those fixed because their edges had become very short (`squeezed`) or because the push and the pull of their neighbours cancelled out (`settled`), and the face centres that could not be brought back inside (`unresolved`).

Contracts:

- The surface is closed, of the topology of a sphere, wound counter-clockwise seen from outside. Seen from inside the chamber, a renderer reverses it.
- Every vertex is inside the volume. Faces can cut a corner of the boundary by about the edge length; edges and corners of the volume are rounded at that scale.
- No vertex is removed and a fixed vertex never moves again, so each stage holds the fixed vertices of the stages before: the stages can be played as an animation.
- The same volume and options give the same surface. `step` is part of the options: a vertex follows the normals of the steps before it.

Limits:

- The surface has the topology of a sphere. In a volume with a hole through it, such as a chamber round a pillar of rock, the two fronts that go round the hole stop when they come within nine tenths of the edge length of each other, facing each other. They leave a thin wall across the volume where they met, and the report counts their vertices (`contact`). Without this stop the fronts crossed and the growth did not end. Two fronts stop each other only across the volume: with rock between them, as on either side of the edge where a tunnel opens into a chamber, each goes on to its own wall. A front that pushes through a narrow opening into a larger room also meets itself as it curls round the opening. Two ways take these walls away and make the fronts one surface, neither run by the growth unless asked:
  - `fuseByTexels(surface, meetings, volume)`, the one to use. Round the places where fronts met (`GrownSurface.meetingPoints`, or `meetings` in the result of `growChamber`), a box is cut into texels of half the edge length. A texel is rock when its centre is outside the volume, filled when it is inside the surface, and the filling goes on through the volume, which closes the gap between the fronts. In the box the surface is rebuilt on the grid, a vertex only ever at a point of the grid, so that two fronts reaching the same point are one vertex; its vertices are then moved out to the wall of the volume, and it is sewn to the rest of the surface where the box ends. A loop of tunnels gives a surface with a hole through it, as the volume has. The filled texels are first made well composed (no two touching only by an edge or a corner), which wears the tip of a wedge of rock thinner than a texel by less than a texel. A box that cannot be sewn in is tried larger, then left as it was, and the report says why. Inside a box the edges are a texel long.
  - `fuse: true` in the options of the growth (`fuseContacts`, report `fusion`), which sews the two sheets of each wall to each other. It fills a ring as a torus, but on a network of chambers and tunnels it leaves some walls, the largest among them.
- Only the part of the volume connected to the seed is filled.
- A part of the volume thinner than the step can be stepped over, and one thinner than the edge length is filled coarsely.

## Chamber

`createChamberVolume` composes the volume of a chamber from its content, and `growChamber` grows the surface in it.

The content is a list of objects, each a set of points and a kind: `solid` for the convex hull of the points (an orebody), `path` for the line through them (a drill hole, the centre line of a drift, the track of a camera), `points` for each point on its own (camera stations). A solid without volume is taken as loose points.

Each object has a margin, `clearance + (1 - attraction) * reach`. The attraction, from 0 to 1, is the one of the settings unless the object gives its own. `reach` defaults to the largest dimension of the content.

A point is in the chamber when it is under `reference - minDepth` and one of these holds:

1. It is within `clearance` of an object. This is the only part of the chamber above the ceiling: a drill hole gets a chimney up to `minDepth` under the ground, and its collar, over the ground, stays out.
2. It is under the ceiling, `reference - depth`, within the margin of an object and within `clearance` of the convex hull of all the content. At attraction 1 the walls and the floor keep the clearance; at attraction 0 with the default reach they are the hull of all the content.
3. With `top` at `ceiling` (the default), it is under the ceiling and over an object: within its margin on the ground, above its middle height, and within `clearance` on the ground of the footprint of all the content. The chamber then opens up to the ceiling, which carries the relief of the ground. With `top` at `content` this part is left out and the top is as near the objects as the walls are.

Depths are counted from the reference surface at the point, so the ceiling and the limit follow the relief. Where the reference is unknown (`NaN`) the chamber holds nothing.

`growChamber` starts the surface in the largest object that has room for the starting sphere, half the edge length in radius, then a quarter, then a tenth. Its report adds the seed and `unreached`, the indices of the objects the surface does not hold: those beyond the limits, and those not connected to the seed, since the margins of two distant objects do not always meet.

`top` is a setting of the chamber and an option of each object, which wins over the setting, as the attraction does. Over a long object such as a drift, opening up to the ceiling gives a tall slot along it: give that object `top: "content"` to keep its top at its margin while the rest of the chamber opens up to the ceiling.

## Rock face

`buildRockFace(mesh, options)` turns any triangle mesh, the surface of a `growChamber` among others, into a rock face seen from the void.

1. Every edge longer than `edgeLength` is split at its middle, and each triangle by its edges split (in two, three or four), pass after pass, until no edge is longer. Only the long edges are touched. Topology and winding are kept.
2. Each vertex has the area-weighted normal of its faces, in the winding. `towardsRock` is 1 when that normal points into the rock (a void wound outwards, as `growChamber` makes it), -1 when it points into the void.
3. Each vertex moves along that normal into the rock by the recession of the rock field where it ends up (three fixed-point steps), limited to `maxDisplacement` by `maxDisplacement * tanh(d / maxDisplacement)`. A negative recession moves it towards the void.
4. The move is limited again to 0.4 of the room ahead of the vertex, on the side it moves to. The room is the radius of the largest ball that touches the surface at the vertex on that side and holds nothing else of the surface: no other vertex, and no more than half the way to a face on the line of the move. Where the rock between two voids is thin, as the wedge between a tunnel and the chamber it opens into, its two faces then stop short of each other instead of passing each other; so do the two walls of a narrow void. On the ridge of such a wedge the room is nothing, and the face keeps no relief. The report counts the vertices limited this way (`limited`).
5. With `within`, a volume in the frame of the mesh, a move that would leave it is shortened by bisection to stay in, and a vertex already outside does not move: a chamber keeps its smallest depth under the ground this way.
6. A face whose normal has turned by more than 75 degrees from the one it had gets the moves of its three vertices halved, up to twelve times, then set to nothing: no face is turned over. The report counts the vertices this touched (`unturned`).
7. Normals are computed again on the moved mesh, in the winding of the input.

Frame and units: metres in the frame of the mesh. `up: "z"` (the default) reads it east, north, up; `up: "y"` reads it east, up, south, as glTF holds it. `origin` is the point of that frame where the field has its origin.

The rock field (`createRockField`) is the one of the SpaceXR V25 pit generator: rotated, domain-warped 3D value noise with ridges (wavelengths 320 to 20 m), Voronoi fissures (82 and 39 m), bedding ledges on warped and tilted horizons, four global fault planes that offset the horizons, and a recession along each fault. At `scale` s it is `s * field(p / s)`: the pit of V25, 4 km across, is s = 1, where the relief has a standard deviation of about 12 m and extremes near 60 m. Every part of the field whose wavelength is under `minWavelength` is faded out over one octave, so that the mesh carries no relief it cannot sample; `detailWavelength` in the result says where a renderer must take over with relief of its own, per pixel.

Limits: the room is tried against the vertices and against the line of each move, not against every point of every face, so two faces can still cross where the rock is thinner than the edges are long and the faces do not stand face to face; on the excavation of five chambers and five tunnels it was tried on, none does. Keep `maxDisplacement` under the clearance of the content: the room keeps the face off itself, not off what the void holds. The faults and horizons are those of the field, not of a geological model. The same mesh and options give the same face.

## Convex hull

`QuickHull` and `convexHull` give the hull of a point set as a closed mesh: shared vertices, triangles counter-clockwise seen from outside and one unit normal per triangle. A set without volume gives `undefined`. The tolerance defaults to `1e-7` of the largest dimension of the set. The search of the horizon is recursive: the hull is meant for thousands of points. Give it the corners of bounding boxes or decimated vertices, not every vertex of large meshes.
