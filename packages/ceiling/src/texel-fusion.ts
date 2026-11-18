/**
 * Fusion of the fronts of a grown surface on a grid of texels. Prototype.
 *
 * Where two fronts of a growing surface met, the growth stopped them face to face, a thin wall of two sheets between
 * them. Around each place where they met, a box is cut into texels. A texel is rock when its centre is outside the
 * volume, filled when it is inside the surface, and the filling goes on texel by texel through the volume: the gap
 * between the two fronts fills, and the wall is gone. Inside the box the surface is then rebuilt on the grid, by the
 * rule that a vertex is only ever at a point of the grid: two fronts that reach the same point are the same vertex,
 * so they merge exactly, without guessing which face matched which. The rebuilt part is sewn to the rest of the
 * surface where the box ends.
 *
 * The surface on the grid is the one of surface nets: a vertex at the centre of each cell of eight texel centres
 * whose texels are not all alike, a quad across each pair of neighbouring texels, one filled and one not.
 */

import type { IVolume } from "./grown-surface";

export interface ITexelFusionInput {
    /** A closed triangle mesh, wound outwards. */
    positions: ArrayLike<number>;
    indices: ArrayLike<number>;
    /** Points where fronts met, `x, y, z` each. */
    meetings: ArrayLike<number>;
    /** The volume the surface grew in. */
    volume: IVolume;
    /** Edge length of the surface. */
    edgeLength: number;
    /** Side of a texel. Defaults to half the edge length. */
    texel?: number;
    /** Distance from a meeting point to the side of its box. Defaults to three edge lengths. */
    margin?: number;
}

export interface ITexelFusionReport {
    /** Boxes around the places where fronts met, merged where they overlap. */
    regions: number;
    /** Boxes whose surface was rebuilt on the grid and sewn in. */
    fused: number;
    /** Boxes left as they were: the rebuilt part did not fit, and the surface was kept closed. */
    kept: number;
    /** Texels filled by the grid that the surface had not filled: the gaps between the fronts. */
    gaps: number;
    /**
     * Each box: its corners, its texels, whether it was fused, the faces its rebuilt part replaced and brought, and
     * why it was left when it was.
     */
    boxes: { min: [number, number, number]; max: [number, number, number]; texels: number; fused: boolean; replaced: number; rebuilt: number; why?: string }[];
}

/** Directed edges keyed by `from * BASE + to`. */
const BASE = 2 ** 26;
/** Passes of smoothing of the rebuilt part, each vertex towards the middle of its neighbours. */
const RELAX = 4;
/** How far out a vertex of the rebuilt part looks for the wall of the volume, in texels. */
const WALL_REACH = 1.5;
/** Width of the band cleared of faces round the rebuilt part, in texels: the seam is at least that wide. */
const GUARD = 0.5;
/** Passes that widen the hole where it touches itself at a vertex. */
const PINCH_PASSES = 6;
/** Passes that make the filled texels well composed: each may undo what the one before left. */
const COMPOSE_PASSES = 8;
/** The three squares of four texels at a texel, each by its two sides. */
const SQUARES = [
    [
        [1, 0, 0],
        [0, 1, 0],
    ],
    [
        [1, 0, 0],
        [0, 0, 1],
    ],
    [
        [0, 1, 0],
        [0, 0, 1],
    ],
] as const;
/** Times a box that does not fit is tried again, larger. */
const RETRIES = 4;
/** How far ahead of the other, in share of its length, a loop may run while two loops are sewn. */
const SLACK = 0.06;

interface IBox {
    min: [number, number, number];
    max: [number, number, number];
}

const overlap = (a: IBox, b: IBox): boolean => [0, 1, 2].every((k) => a.min[k]! <= b.max[k]! && b.min[k]! <= a.max[k]!);

/** Boxes round the meeting points, merged while two overlap. */
function regionsOf(meetings: ArrayLike<number>, margin: number): IBox[] {
    let boxes: IBox[] = [];
    for (let at = 0; at < meetings.length; at += 3) {
        const p = [meetings[at]!, meetings[at + 1]!, meetings[at + 2]!];
        boxes.push({ min: p.map((v) => v - margin) as IBox["min"], max: p.map((v) => v + margin) as IBox["max"] });
    }
    let merged = true;
    while (merged) {
        merged = false;
        const out: IBox[] = [];
        for (const box of boxes) {
            const other = out.find((candidate) => overlap(candidate, box));
            if (other) {
                for (let k = 0; k < 3; k++) {
                    other.min[k] = Math.min(other.min[k]!, box.min[k]!);
                    other.max[k] = Math.max(other.max[k]!, box.max[k]!);
                }
                merged = true;
            } else out.push({ min: [...box.min], max: [...box.max] });
        }
        boxes = out;
    }
    return boxes;
}

/** Whether a point is inside a closed mesh: crossings of a ray going up, counted on the triangles under it. */
class Inside {
    private readonly cells = new Map<string, number[]>();
    constructor(
        private readonly positions: ArrayLike<number>,
        private readonly faces: readonly number[],
        alive: readonly boolean[],
        private readonly cell: number
    ) {
        for (let f = 0; f < faces.length / 3; f++) {
            if (!alive[f]) continue;
            const xs = [0, 1, 2].map((k) => positions[faces[f * 3 + k]! * 3]!);
            const ys = [0, 1, 2].map((k) => positions[faces[f * 3 + k]! * 3 + 1]!);
            for (let i = Math.floor(Math.min(...xs) / cell); i <= Math.floor(Math.max(...xs) / cell); i++)
                for (let j = Math.floor(Math.min(...ys) / cell); j <= Math.floor(Math.max(...ys) / cell); j++) {
                    const key = `${i},${j}`;
                    const list = this.cells.get(key) ?? [];
                    list.push(f);
                    this.cells.set(key, list);
                }
        }
    }
    contains(x0: number, y0: number, z: number): boolean {
        // Off any vertex or edge of the grid of the surface by a little, so that the ray does not graze one.
        const x = x0 + 1.234567e-6 * this.cell,
            y = y0 + 2.345678e-6 * this.cell;
        let crossings = 0;
        const p = this.positions;
        for (const f of this.cells.get(`${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`) ?? []) {
            const [a, b, c] = [this.faces[f * 3]! * 3, this.faces[f * 3 + 1]! * 3, this.faces[f * 3 + 2]! * 3];
            const det = (p[b + 1]! - p[c + 1]!) * (p[a]! - p[c]!) + (p[c]! - p[b]!) * (p[a + 1]! - p[c + 1]!);
            if (det === 0) continue;
            const l1 = ((p[b + 1]! - p[c + 1]!) * (x - p[c]!) + (p[c]! - p[b]!) * (y - p[c + 1]!)) / det;
            const l2 = ((p[c + 1]! - p[a + 1]!) * (x - p[c]!) + (p[a]! - p[c]!) * (y - p[c + 1]!)) / det;
            const l3 = 1 - l1 - l2;
            if (l1 < 0 || l2 < 0 || l3 < 0) continue;
            if (l1 * p[a + 2]! + l2 * p[b + 2]! + l3 * p[c + 2]! > z) crossings++;
        }
        return crossings % 2 === 1;
    }
}

const distance = (p: ArrayLike<number>, a: number, b: number): number => Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);

/**
 * Sews a hole to the boundary of the part that fills it: a strip from one loop to the other. Each loop runs along
 * the boundary edges of its own faces, so the two run in opposite directions round the seam: the first is walked
 * forwards and the second backwards, each step taking the shorter diagonal. Neither runs ahead of the other by more
 * than a small share of its length: taken by the shorter diagonal alone, one loop could be walked a long way while
 * the other stood still, in a fan of long triangles.
 */
function sew(p: ArrayLike<number>, a: number[], b: number[]): number[][] {
    const back = [...b].reverse();
    let start = 0;
    for (let k = 1; k < back.length; k++) if (distance(p, a[0]!, back[k]!) < distance(p, a[0]!, back[start]!)) start = k;
    const m = [...back.slice(start), ...back.slice(0, start)];
    /** Length walked along a loop when at each of its vertices, as a share of its whole length. */
    const progress = (loop: number[]): number[] => {
        const along = [0];
        for (let k = 0; k < loop.length; k++) along.push(along[k]! + distance(p, loop[k]!, loop[(k + 1) % loop.length]!));
        const whole = along[loop.length]! || 1;
        return along.map((value) => value / whole);
    };
    const alongA = progress(a),
        alongM = progress(m);
    const out: number[][] = [];
    let i = 0,
        k = 0;
    while (i < a.length || k < m.length) {
        const ai = a[i % a.length]!,
            ai1 = a[(i + 1) % a.length]!,
            mk = m[k % m.length]!,
            mk1 = m[(k + 1) % m.length]!;
        let first: boolean;
        if (k >= m.length) first = true;
        else if (i >= a.length) first = false;
        else if (alongA[i]! - alongM[k]! > SLACK) first = false;
        else if (alongM[k]! - alongA[i]! > SLACK) first = true;
        else first = distance(p, ai1, mk) <= distance(p, ai, mk1);
        if (first) {
            out.push([ai1, ai, mk]);
            i++;
        } else {
            out.push([mk, mk1, ai]);
            k++;
        }
    }
    return out;
}

/** Loops of boundary half-edges, `next` from the start of each to its end; null when a vertex starts two. */
function loopsOf(halfEdges: [number, number][]): number[][] | null {
    const next = new Map<number, number>();
    for (const [from, to] of halfEdges) {
        if (next.has(from)) return null;
        next.set(from, to);
    }
    const loops: number[][] = [];
    const seen = new Set<number>();
    for (const start of next.keys()) {
        if (seen.has(start)) continue;
        const loop: number[] = [];
        let at: number | undefined = start;
        while (at !== undefined && !seen.has(at)) {
            seen.add(at);
            loop.push(at);
            at = next.get(at);
        }
        if (at !== start || loop.length < 3) return null;
        loops.push(loop);
    }
    return loops;
}

/** Whether the faces alive make a closed surface: each directed edge once, each with its twin. */
function closed(faces: readonly number[], alive: readonly boolean[]): boolean {
    const edges = new Set<number>();
    for (let f = 0; f < faces.length / 3; f++) {
        if (!alive[f]) continue;
        for (let k = 0; k < 3; k++) {
            const key = faces[f * 3 + k]! * BASE + faces[f * 3 + ((k + 1) % 3)]!;
            if (edges.has(key)) return false;
            edges.add(key);
        }
    }
    for (const key of edges) if (!edges.has((key % BASE) * BASE + Math.floor(key / BASE))) return false;
    return true;
}

/**
 * Fuses the fronts of a grown surface that met, on a grid of texels round each place where they met. Returns a mesh
 * without unused vertices.
 */
export function fuseByTexels(input: ITexelFusionInput): { positions: Float64Array; indices: Uint32Array; report: ITexelFusionReport } {
    const { volume, edgeLength } = input;
    const h = input.texel ?? edgeLength / 2;
    const margin = input.margin ?? 3 * edgeLength;
    const positions = Array.from(input.positions);
    const faces = Array.from(input.indices);
    const alive = new Array<boolean>(faces.length / 3).fill(true);
    const regions = regionsOf(input.meetings, margin);
    const report: ITexelFusionReport = { regions: regions.length, fused: 0, kept: 0, gaps: 0, boxes: [] };

    /** Rebuilds the surface in a box on the grid and sews it in. Returns why it could not, or null when done. */
    const fuseBox = (region: IBox): string | null => {
        // The grid, aligned on multiples of the texel so that two boxes share their points.
        const origin = region.min.map((v) => Math.floor(v / h) * h) as [number, number, number];
        const size = region.max.map((v, k) => Math.ceil((v - origin[k]!) / h) + 1) as [number, number, number];
        const [nx, ny, nz] = size;
        const at = (i: number, j: number, k: number): number => (k * ny + j) * nx + i;
        const centre = (i: number, j: number, k: number): [number, number, number] => [origin[0] + (i + 0.5) * h, origin[1] + (j + 0.5) * h, origin[2] + (k + 0.5) * h];

        // Texels: rock outside the volume, filled inside the surface, then filled through the volume from there.
        const inside = new Inside(positions, faces, alive, edgeLength);
        // 0 is rock.
        const OPEN = 1,
            FILLED = 2;
        const state = new Uint8Array(nx * ny * nz);
        const queue: number[] = [];
        for (let k = 0; k < nz; k++)
            for (let j = 0; j < ny; j++)
                for (let i = 0; i < nx; i++) {
                    const [x, y, z] = centre(i, j, k);
                    if (!volume.contains(x, y, z)) continue;
                    if (inside.contains(x, y, z)) {
                        state[at(i, j, k)] = FILLED;
                        queue.push(i, j, k);
                    } else state[at(i, j, k)] = OPEN;
                }
        let gaps = 0;
        while (queue.length > 0) {
            const k = queue.pop()!,
                j = queue.pop()!,
                i = queue.pop()!;
            for (const [di, dj, dk] of [
                [1, 0, 0],
                [-1, 0, 0],
                [0, 1, 0],
                [0, -1, 0],
                [0, 0, 1],
                [0, 0, -1],
            ] as const) {
                const [a, b, c] = [i + di, j + dj, k + dk];
                if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz || state[at(a, b, c)] !== OPEN) continue;
                state[at(a, b, c)] = FILLED;
                gaps++;
                queue.push(a, b, c);
            }
        }
        // The filled texels made well composed: where two of them touch only along an edge, or only at a corner, the
        // surface on the grid would have an edge with four faces, or a vertex where two sheets touch. That happens at
        // the tip of a wedge of rock thinner than a texel, between a tunnel and the chamber it opens into. A texel of
        // rock beside them is then taken as filled, which wears the tip of the wedge by less than a texel; the
        // vertices that end up in the rock are brought back into the volume below.
        const isFilled = (i: number, j: number, k: number): boolean => state[at(i, j, k)] === FILLED;
        for (let pass = 0; pass < COMPOSE_PASSES; pass++) {
            let changed = false;
            const fill = (i: number, j: number, k: number): void => {
                state[at(i, j, k)] = FILLED;
                changed = true;
            };
            for (let k = 0; k < nz; k++)
                for (let j = 0; j < ny; j++)
                    for (let i = 0; i < nx; i++) {
                        // The three squares of four texels that start here: two alike across each diagonal, the two
                        // diagonals unlike, is two texels touching along an edge.
                        for (const [u, v] of SQUARES) {
                            const [i1, j1, k1] = [i + u[0] + v[0], j + u[1] + v[1], k + u[2] + v[2]];
                            if (i1 >= nx || j1 >= ny || k1 >= nz) continue;
                            const a = isFilled(i, j, k),
                                b = isFilled(i + u[0], j + u[1], k + u[2]),
                                c = isFilled(i + v[0], j + v[1], k + v[2]),
                                d = isFilled(i1, j1, k1);
                            if (a !== d || b !== c || a === b) continue;
                            if (a) fill(i + u[0], j + u[1], k + u[2]);
                            else fill(i, j, k);
                        }
                        // The cube of eight texels that starts here: two filled at opposite corners and no other, or
                        // all filled but two at opposite corners, is two texels, or two gaps, touching at a corner.
                        if (i + 1 >= nx || j + 1 >= ny || k + 1 >= nz) continue;
                        let count = 0;
                        for (let c = 0; c < 8; c++) if (isFilled(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))) count++;
                        if (count !== 2 && count !== 6) continue;
                        for (let c = 0; c < 4; c++) {
                            const [di, dj, dk] = [c & 1, (c >> 1) & 1, (c >> 2) & 1];
                            const one = isFilled(i + di, j + dj, k + dk),
                                other = isFilled(i + 1 - di, j + 1 - dj, k + 1 - dk);
                            if (one !== other || one !== (count === 2)) continue;
                            // A texel beside the first, or one of the two gaps: the squares see to what is left.
                            if (count === 2) fill(i + 1 - di, j + dj, k + dk);
                            else fill(i + di, j + dj, k + dk);
                            break;
                        }
                    }
            if (!changed) break;
        }
        const filled = isFilled;

        // The surface on the grid, in the cells away from the side of the box: a vertex in each cell of eight texel
        // centres that are not all alike, at the point of the grid in its middle.
        const first = 1,
            lastCell = [nx - 3, ny - 3, nz - 3];
        const vertexOf = new Map<number, number>();
        const fresh: number[] = [];
        const before = positions.length;
        const cellVertex = (i: number, j: number, k: number): number => {
            const key = at(i, j, k);
            let v = vertexOf.get(key);
            if (v === undefined) {
                v = positions.length / 3;
                positions.push(origin[0] + (i + 1) * h, origin[1] + (j + 1) * h, origin[2] + (k + 1) * h);
                vertexOf.set(key, v);
                fresh.push(v);
            }
            return v;
        };
        const inCells = (i: number, j: number, k: number): boolean => i >= first && j >= first && k >= first && i <= lastCell[0]! && j <= lastCell[1]! && k <= lastCell[2]!;
        const patch: number[][] = [];
        const quad = (cells: [number, number, number][], outwards: boolean): void => {
            if (!cells.every(([i, j, k]) => inCells(i, j, k))) return;
            const [a, b, c, d] = cells.map(([i, j, k]) => cellVertex(i, j, k)) as [number, number, number, number];
            if (outwards) patch.push([a, b, c], [a, c, d]);
            else patch.push([a, c, b], [a, d, c]);
        };
        for (let k = 0; k < nz; k++)
            for (let j = 0; j < ny; j++)
                for (let i = 0; i < nx; i++) {
                    const here = filled(i, j, k);
                    // Across x, y and z: the quad of the four cells round the segment between two texels.
                    if (i + 1 < nx && here !== filled(i + 1, j, k))
                        quad(
                            [
                                [i, j - 1, k - 1],
                                [i, j, k - 1],
                                [i, j, k],
                                [i, j - 1, k],
                            ],
                            here
                        );
                    if (j + 1 < ny && here !== filled(i, j + 1, k))
                        quad(
                            [
                                [i - 1, j, k - 1],
                                [i - 1, j, k],
                                [i, j, k],
                                [i, j, k - 1],
                            ],
                            here
                        );
                    if (k + 1 < nz && here !== filled(i, j, k + 1))
                        quad(
                            [
                                [i - 1, j - 1, k],
                                [i, j - 1, k],
                                [i, j, k],
                                [i - 1, j, k],
                            ],
                            here
                        );
                }

        // The part of the surface the rebuilt part replaces: every face with a vertex within the cells it covers, or
        // within a guard round them. The faces left then stand clear of the rebuilt part, all the way round: the seam
        // between them is a strip, with nothing of one lying over the other. (Cut by the middle of the faces, the
        // faces left reached into the rebuilt part, and the strip folded back on itself.)
        const low = [0, 1, 2].map((k) => origin[k]! + (first + 1) * h - GUARD * h);
        const high = [0, 1, 2].map((k) => origin[k]! + (lastCell[k]! + 1) * h + GUARD * h);
        const within = (v: number): boolean => [0, 1, 2].every((k) => positions[v * 3 + k]! >= low[k]! && positions[v * 3 + k]! <= high[k]!);
        const owner = new Map<number, number>();
        for (let f = 0; f < faces.length / 3; f++) if (alive[f]) for (let k = 0; k < 3; k++) owner.set(faces[f * 3 + k]! * BASE + faces[f * 3 + ((k + 1) % 3)]!, f);
        const removedSet = new Set<number>();
        for (let f = 0; f < faces.length / 3; f++) if (alive[f] && (within(faces[f * 3]!) || within(faces[f * 3 + 1]!) || within(faces[f * 3 + 2]!))) removedSet.add(f);
        /** The boundary edges of the faces left round the hole, each from its start to its end. */
        const holeEdgesOf = (): [number, number][] => {
            const edges: [number, number][] = [];
            for (const f of removedSet)
                for (let k = 0; k < 3; k++) {
                    const from = faces[f * 3 + k]!,
                        to = faces[f * 3 + ((k + 1) % 3)]!;
                    const twin = owner.get(to * BASE + from);
                    if (twin !== undefined && !removedSet.has(twin)) edges.push([to, from]);
                }
            return edges;
        };
        // A vertex where the hole touches itself would start two boundary edges: the faces round it go too.
        let holeEdges = holeEdgesOf();
        for (let pass = 0; pass < PINCH_PASSES; pass++) {
            const starts = new Set<number>(),
                pinched = new Set<number>();
            for (const [from] of holeEdges) {
                if (starts.has(from)) pinched.add(from);
                starts.add(from);
            }
            if (pinched.size === 0) break;
            for (let f = 0; f < faces.length / 3; f++)
                if (alive[f] && !removedSet.has(f) && (pinched.has(faces[f * 3]!) || pinched.has(faces[f * 3 + 1]!) || pinched.has(faces[f * 3 + 2]!))) removedSet.add(f);
            holeEdges = holeEdgesOf();
        }
        const removed = [...removedSet];

        /** Leaves the box as it was: the faces back, the vertices of the rebuilt part dropped. */
        const undo = (why: string): string => {
            for (const f of removed) alive[f] = true;
            positions.length = before;
            return why;
        };
        if (patch.length === 0 || removed.length === 0) {
            return undo("nothing to rebuild");
        }

        // The rebuilt part inside the volume: a vertex outside goes back towards the filled texels round it.
        for (const v of fresh) {
            if (volume.contains(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!)) continue;
            const [ci, cj, ck] = [0, 1, 2].map((k) => Math.round((positions[v * 3 + k]! - origin[k]!) / h) - 1);
            const target = [0, 0, 0];
            let count = 0;
            for (let di = 0; di <= 1; di++)
                for (let dj = 0; dj <= 1; dj++)
                    for (let dk = 0; dk <= 1; dk++)
                        if (filled(ci! + di, cj! + dj, ck! + dk)) {
                            const c = centre(ci! + di, cj! + dj, ck! + dk);
                            for (let k = 0; k < 3; k++) target[k] += c[k]!;
                            count++;
                        }
            if (count === 0) continue;
            const goal = target.map((value) => value / count);
            let lo = 0,
                hi = 1;
            for (let step = 0; step < 20; step++) {
                const t = (lo + hi) / 2;
                const q = [0, 1, 2].map((k) => positions[v * 3 + k]! + (goal[k]! - positions[v * 3 + k]!) * t);
                if (volume.contains(q[0]!, q[1]!, q[2]!)) hi = t;
                else lo = t;
            }
            for (let k = 0; k < 3; k++) positions[v * 3 + k] = positions[v * 3 + k]! + (goal[k]! - positions[v * 3 + k]!) * hi;
        }

        // Loops: the hole the replaced faces leave, along the faces left, and the side of the rebuilt part.
        const patchEdges = new Set<number>();
        for (const [a, b, c] of patch)
            for (const [from, to] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const)
                patchEdges.add(from! * BASE + to!);
        const sideEdges: [number, number][] = [];
        for (const key of patchEdges) {
            const from = Math.floor(key / BASE),
                to = key % BASE;
            if (!patchEdges.has(to * BASE + from)) sideEdges.push([from, to]);
        }
        const holes = loopsOf(holeEdges),
            sides = loopsOf(sideEdges);
        if (!holes || !sides || holes.length !== sides.length) {
            const count = (loops: number[][] | null): string => (loops ? `${loops.length} (of ${loops.map((loop) => loop.length).join(", ")} vertices)` : "a pinched boundary");
            return undo(`the hole has ${count(holes)} loops and the rebuilt part ${count(sides)}`);
        }
        // Each hole with the side of the rebuilt part nearest to it.
        const meanGap = (x: number[], y: number[]): number => x.reduce((sum, u) => sum + Math.min(...y.map((v) => distance(positions, u, v))), 0) / x.length;
        const used = new Set<number>();
        const strip: number[][] = [];
        let paired = true;
        for (const hole of holes) {
            let best = -1,
                bestGap = Infinity;
            sides.forEach((side, index) => {
                if (used.has(index)) return;
                const gap = meanGap(hole, side) + meanGap(side, hole);
                if (gap < bestGap) {
                    bestGap = gap;
                    best = index;
                }
            });
            if (best < 0 || bestGap > 4 * edgeLength) {
                paired = false;
                break;
            }
            used.add(best);
            strip.push(...sew(positions, hole, sides[best]!));
        }
        if (!paired) {
            return undo("a loop of the hole has no loop of the rebuilt part near it");
        }

        // Smoothing of the rebuilt part: each of its vertices towards the middle of its neighbours, inside the volume.
        // Those of its side have the vertices of the hole among their neighbours, through the strip: held where the
        // grid put them, they left the strip creased in places, some of its triangles turned to the void.
        const neighbours = new Map<number, Set<number>>();
        for (const [a, b, c] of [...patch, ...strip])
            for (const [u, w] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const) {
                if (!neighbours.has(u!)) neighbours.set(u!, new Set());
                neighbours.get(u!)!.add(w!);
            }
        for (let pass = 0; pass < RELAX; pass++)
            for (const v of fresh) {
                const around = [...(neighbours.get(v) ?? [])];
                if (around.length === 0) continue;
                const goal = [0, 1, 2].map((k) => around.reduce((sum, w) => sum + positions[w * 3 + k]!, 0) / around.length);
                const q = [0, 1, 2].map((k) => positions[v * 3 + k]! + (goal[k]! - positions[v * 3 + k]!) * 0.5);
                if (volume.contains(q[0]!, q[1]!, q[2]!)) for (let k = 0; k < 3; k++) positions[v * 3 + k] = q[k]!;
            }

        // Each vertex of the rebuilt part then goes out along its normal to the wall of the volume, as the vertices
        // of the growth do: a point of the grid stands up to half a texel short of the wall, and the smoothing drew
        // it further in. A vertex with no wall within reach stays where it is.
        const normals = new Map<number, [number, number, number]>();
        for (const [a, b, c] of [...patch, ...strip]) {
            const u = [0, 1, 2].map((k) => positions[b! * 3 + k]! - positions[a! * 3 + k]!);
            const w = [0, 1, 2].map((k) => positions[c! * 3 + k]! - positions[a! * 3 + k]!);
            const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
            for (const v of [a!, b!, c!]) {
                const sum = normals.get(v) ?? [0, 0, 0];
                for (let k = 0; k < 3; k++) sum[k] += n[k]!;
                normals.set(v, sum);
            }
        }
        const step = h / 4,
            reach = WALL_REACH * h;
        for (const v of fresh) {
            const n = normals.get(v);
            const length = n ? Math.hypot(n[0], n[1], n[2]) : 0;
            if (!n || !(length > 0)) continue;
            const along = (t: number): [number, number, number] => [0, 1, 2].map((k) => positions[v * 3 + k]! + (n[k]! / length) * t) as [number, number, number];
            if (!volume.contains(...along(0))) continue;
            let inside = 0,
                outside = step;
            while (outside <= reach && volume.contains(...along(outside))) {
                inside = outside;
                outside += step;
            }
            if (outside > reach) continue;
            for (let pass = 0; pass < 12; pass++) {
                const middle = (inside + outside) / 2;
                if (volume.contains(...along(middle))) inside = middle;
                else outside = middle;
            }
            const q = along(inside);
            for (let k = 0; k < 3; k++) positions[v * 3 + k] = q[k]!;
        }

        for (const f of removed) alive[f] = false;
        const added = faces.length / 3;
        for (const [a, b, c] of [...patch, ...strip]) {
            faces.push(a!, b!, c!);
            alive.push(true);
        }
        if (!closed(faces, alive)) {
            faces.length = added * 3;
            alive.length = added;
            return undo("the seam would not leave a closed surface");
        }
        report.fused++;
        report.gaps += gaps;
        report.boxes.push({ min: region.min, max: region.max, texels: nx * ny * nz, fused: true, replaced: removed.length, rebuilt: patch.length + strip.length });
        return null;
    };

    // A box whose rebuilt part does not fit is tried again, an edge length larger on every side: its sides then cut
    // the surface elsewhere. Where a side passes through a wedge of rock thinner than the grid or than the faces,
    // between a tunnel and the chamber it opens into, the grid and the surface do not count the same loops there.
    for (const region of regions) {
        let box = region;
        let why: string | null = null;
        for (let attempt = 0; attempt <= RETRIES; attempt++) {
            if (attempt > 0) box = { min: box.min.map((v) => v - edgeLength) as IBox["min"], max: box.max.map((v) => v + edgeLength) as IBox["max"] };
            why = fuseBox(box);
            if (why === null) break;
        }
        if (why !== null) {
            report.kept++;
            report.boxes.push({ min: region.min, max: region.max, texels: 0, fused: false, replaced: 0, rebuilt: 0, why });
        }
    }

    // Nothing fused: the surface as it was given, its vertices in their order.
    if (report.fused === 0) return { positions: Float64Array.from(input.positions), indices: Uint32Array.from(input.indices), report };

    // The faces alive, without the vertices no face uses any more.
    const remap = new Map<number, number>();
    const indices: number[] = [];
    const kept: number[] = [];
    for (let f = 0; f < faces.length / 3; f++) {
        if (!alive[f]) continue;
        for (let k = 0; k < 3; k++) {
            const v = faces[f * 3 + k]!;
            let w = remap.get(v);
            if (w === undefined) {
                w = remap.size;
                remap.set(v, w);
                kept.push(v);
            }
            indices.push(w);
        }
    }
    const out = new Float64Array(kept.length * 3);
    kept.forEach((v, w) => out.set([positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!], w * 3));
    return { positions: out, indices: Uint32Array.from(indices), report };
}
