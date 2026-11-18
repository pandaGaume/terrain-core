# Rock face that crossed itself where the rock is thin

Date: 18 November 2026. Written on `feat/underground-ceiling`, after the commit tagged `ceiling-convex-v1` and after the changes of `2026-11-18-grown-surface-fronts.md`. Not committed.

## Change impact

**Request.** In the excavation of chambers and tunnels (`spacexr-rendering/examples/babylon-excavation`), the user saw dark blades across the rock at the mouths of the tunnels, after the fusion of the fronts. The user took them for points that had moved too far into the volume, and asked for a statistical correction of the positions at the junctions.

**Cause.** Measured on that excavation (62 986 triangles, edges of 1 to 3.2 m, moves of up to 2 m). The surface given to `buildRockFace` is clean: no two of its faces go through each other. Once moved, 293 pairs of faces without a vertex in common go through each other and 90 faces are turned over, all of them round the mouths of the tunnels, in the parts rebuilt by the fusion as in those the growth left. There the rock between the tunnel and the chamber is a wedge that thins to nothing, and each of its two faces moves into it, along its own normal, by up to `maxDisplacement`: the two faces pass each other, and near the ridge of the wedge the faces turn over. The user was right about the points: they had moved too far, through the wedge and out of its other face. This is the limit the first record of the rock face left open (`2026-11-18-rock-face.md`: no test against self-intersection).

**Components.** `rock-face.ts` of `@spacexr/ceiling`. `IRockFaceReport` gains `limited` and `unturned`. A move is still along the normal of its vertex, and `IRockFace.displacement` keeps its meaning.

**Changes.**

1. Behaviour change: the move of a vertex is limited by the room ahead of it. The room is the radius of the largest ball that touches the surface at the vertex, on the side the vertex moves to, and holds nothing else of the surface. It is tried against the other vertices (a ball of radius `r` tangent at `p`, its centre along the unit direction `d`, holds `q` when `|q - p|² < 2 r (q - p).d`) and against the faces the line of the move goes through, of which it can hold half the distance. A vertex moves by at most 0.4 of that radius, towards the rock as towards the void. The two faces of a slab of rock then stop short of its middle, and so do the two walls of a narrow void; on the ridge of a wedge the room goes to nothing and the relief with it. The report counts these vertices (`limited`).
2. Behaviour change, a guard after the moves: a face whose normal has turned by more than 75 degrees from the one it had gets the moves of its three vertices halved, up to twelve times, then set to nothing, which gives the face back as it was. No face of the result is turned over. The report counts the vertices it touched (`unturned`).

**What was tried and not kept.** The correction the user proposed, in the form closest to the cause. The statistic is the move of a vertex against the mean move of its neighbours, over the mean length of its edges; a vertex over the median by a number of robust standard deviations (1.4826 times the median absolute deviation) takes the mean move of its neighbours, pass after pass, with the vertices of the faces turned over. As a detector it is good: at four deviations it marks 2.1 % of the vertices, and 171 of the 172 faces whose normal stood against that of one of their vertices have one. As a correction alone it is not enough: it leaves 57 pairs of crossing faces at three deviations (6.7 % of the moves changed), 111 at four, 120 at five, and three faces turned over that no pass frees. A statistic over the neighbours of a vertex along the surface does not see the other face of the wedge, which is near in space and far along the surface. The same statistic on the positions alone, the offset of a vertex from the middle of its neighbours, marks only 96 of those 172 faces at three deviations. Added after the limit by the room, it changes nothing that the counts below see, so it is left out.

**Measured on the excavation**, one run on one machine, by the build script of the example and by scripts kept out of the repository. Before: 293 pairs of crossing faces (312 faces), 90 faces turned over. With the room, by the share of it a move may take:

| Share | Vertices limited | Pairs of crossing faces | Faces turned over |
| ----- | ---------------- | ----------------------- | ----------------- |
| 0.4   | 829 (2.6 %)      | 0                       | 0                 |
| 0.5   | 629 (2.0 %)      | 0                       | 0                 |
| 0.6   | 491 (1.6 %)      | 2                       | 1                 |
| 0.8   | 302 (1.0 %)      | 27                      | 3                 |

At 0.4, the share kept: 829 vertices limited, 815 of them on their way into the rock and 14 into the void, by 0.61 m on average; the mean move of all the vertices goes from 1.234 to 1.218 m; the guard touches no vertex. At a share of 0.6, the lines of the moves alone, without the other vertices, limit 94 vertices and leave 81 faces turned over; the other vertices alone give the same counts as both, at 0.4, 0.5 and 0.6, on this surface. Looked at in a browser, the ten mouths of the five tunnels are whole: no blade, no flap.

**Known limits.** The room is tried against the vertices and against the lines of the moves, not against every point of every face: a face that stands nearer than its own corners and off the line of the move is not seen, so two faces can still cross where the rock is thinner than the edges are long and the faces are not face to face. The share of 0.4 passed on one surface; 0.5 passed too and 0.6 did not. Nothing was measured on a mesh that needs refining, nor on the chamber of the Studio beyond its tests. On the ridge of a wedge, and at the bottom of a narrow slot, the face keeps no relief. The guard looks at each face against itself: two faces that cross without either turning over are not seen by it.

**Costs.** `buildRockFace` on the excavation: 531 and 609 ms before, 805 and 827 ms after, two runs each. The room keeps the vertices and the faces in a grid of cells half its reach wide, the reach being five times `maxDisplacement`: it looks at the vertices of 125 cells and at the faces of the cells along the move, once per vertex that moves. Memory: `COST_NOT_ISOLATED`.

**Rationale.** The room is the local feature size of the surface on one side: a face moved along its normals by less than it does not reach the middle of the rock, or of the void, that the other face moves towards. The share has to be under 1 because the room is found on the vertices, which stand off the point where the ball would touch; 0.4 is `RATIONALE_UNKNOWN` beyond the table above. So are the 75 degrees and the twelve halvings of the guard, which nothing triggered on this surface.

## Verification

`rock-face.test.ts`, two tests added. A slab 40 m by 40 m and 1 m thick, as a void in the rock then as a slab of rock in a void, read where the field moves its two faces towards each other by up to 2 m: each face keeps its side of the middle, within 0.2 m of where it was, and the report counts vertices limited. A wedge of rock whose faces meet at 15 degrees: no face of the result has turned against the one it was, and each vertex keeps its side of the middle of the wedge. Run against the builder as it was, both fail: a vertex of the slab is on the wrong side of its middle, and a face of the wedge is turned over. 83 tests of the package pass, with typecheck and lint. The two tests of the chamber of the Studio of geomodels-explorer, which builds on this package, pass too.
