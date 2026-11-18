/**
 * Fusion of the fronts of a grown surface that met.
 *
 * Where two fronts of a growing surface come face to face across the volume, the growth stops both of them, about
 * the edge length apart: they make a wall of two sheets back to back. The growth keeps the pair of vertices where they
 * met. From each such pair, fusion grows two regions of faces together, one on each sheet, a face joining its region
 * only when a face of the other region faces it: two discs that match. Both are taken away, and each hole on one side
 * is sewn to the hole facing it on the other side by a strip of triangles. The two fronts become one surface: in a
 * ring, a torus, as the volume is.
 *
 * A fusion that would not leave a closed surface, every edge met once in each direction, is undone: its wall stays.
 */

import type { IVolume } from "./grown-surface";

/** A closed triangle mesh, wound outwards, the volume it grew in and where its fronts met. */
export interface IFuseInput {
    positions: ArrayLike<number>;
    indices: ArrayLike<number>;
    /** Pairs of vertices where two fronts met. */
    meetings: ArrayLike<number>;
    /** The volume the surface grew in: two faces of a wall face each other with the volume between them. */
    volume: IVolume;
    /** Largest thickness of a wall: about the edge length of the surface. */
    reach: number;
}

export interface IFuseReport {
    /** Walls fused: their two sheets taken away and the holes sewn. */
    fused: number;
    /** Walls left as they were, because their fusion would not have left a closed surface. */
    kept: number;
    /** Faces of the walls taken away. */
    removed: number;
    /** Pairs of holes sewn together. */
    sewn: number;
}

/** Directed edges keyed by `from * BASE + to`. */
const BASE = 2 ** 26;
/** Two faces face each other when the cosine of the angle between their normals is under this. */
const FACING = -0.5;
/** Points of the segment between two faces where the volume is asked whether they face each other across it. */
const BETWEEN = [0.25, 0.5, 0.75] as const;
/** Passes that add to a region the faces it surrounds. */
const CLOSING_PASSES = 4;

interface IMesh {
    positions: ArrayLike<number>;
    faces: number[];
    alive: boolean[];
    /** Face on the left of each directed edge, among the faces alive. */
    edges: Map<number, number>;
    /** Faces of each vertex, alive or not. */
    around: Map<number, number[]>;
}

function addFace(mesh: IMesh, a: number, b: number, c: number): number {
    const face = mesh.faces.length / 3;
    mesh.faces.push(a, b, c);
    mesh.alive.push(true);
    for (const [from, to] of [
        [a, b],
        [b, c],
        [c, a],
    ] as const)
        mesh.edges.set(from * BASE + to, face);
    for (const v of [a, b, c]) {
        const list = mesh.around.get(v) ?? [];
        list.push(face);
        mesh.around.set(v, list);
    }
    return face;
}

function corners(mesh: IMesh, f: number): [number, number, number] {
    return [mesh.faces[f * 3]!, mesh.faces[f * 3 + 1]!, mesh.faces[f * 3 + 2]!];
}

/** The faces across the three edges of a face, alive. */
function neighbours(mesh: IMesh, f: number): number[] {
    const [a, b, c] = corners(mesh, f);
    const out: number[] = [];
    for (const [from, to] of [
        [a, b],
        [b, c],
        [c, a],
    ] as const) {
        const g = mesh.edges.get(to * BASE + from);
        if (g !== undefined && mesh.alive[g]) out.push(g);
    }
    return out;
}

/** Centre and unit normal of a face. */
function frame(mesh: IMesh, f: number): { centre: [number, number, number]; normal: [number, number, number] } {
    const p = mesh.positions;
    const [a, b, c] = corners(mesh, f).map((v) => v * 3) as [number, number, number];
    const u = [0, 1, 2].map((k) => p[b + k]! - p[a + k]!);
    const w = [0, 1, 2].map((k) => p[c + k]! - p[a + k]!);
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const length = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    return {
        centre: [0, 1, 2].map((k) => (p[a + k]! + p[b + k]! + p[c + k]!) / 3) as [number, number, number],
        normal: n.map((value) => value / length) as [number, number, number],
    };
}

/** Whether two faces face each other within reach, each ahead of the other, with the volume between them. */
function facing(mesh: IMesh, f: number, g: number, volume: IVolume, reach: number): number | null {
    const a = frame(mesh, f),
        b = frame(mesh, g);
    if (a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2] > FACING) return null;
    const d = [0, 1, 2].map((k) => b.centre[k]! - a.centre[k]!);
    if (d[0]! * a.normal[0] + d[1]! * a.normal[1] + d[2]! * a.normal[2] <= 0) return null;
    if (d[0]! * b.normal[0] + d[1]! * b.normal[1] + d[2]! * b.normal[2] >= 0) return null;
    const distance = Math.hypot(d[0]!, d[1]!, d[2]!);
    if (distance > reach) return null;
    for (const t of BETWEEN) if (!volume.contains(a.centre[0] + d[0]! * t, a.centre[1] + d[1]! * t, a.centre[2] + d[2]! * t)) return null;
    return distance;
}

/** The faces near a point, among the faces of the mesh as it was, by a grid of cells of the reach. */
class FaceGrid {
    private readonly cells = new Map<string, number[]>();
    constructor(
        private readonly mesh: IMesh,
        private readonly cell: number
    ) {
        for (let f = 0; f < mesh.faces.length / 3; f++) {
            const key = this.key(frame(mesh, f).centre);
            const list = this.cells.get(key) ?? [];
            list.push(f);
            this.cells.set(key, list);
        }
    }
    private key(p: readonly number[]): string {
        return p.map((value) => Math.floor(value / this.cell)).join(",");
    }
    near(p: readonly number[]): number[] {
        const base = p.map((value) => Math.floor(value / this.cell));
        const out: number[] = [];
        for (let i = -1; i <= 1; i++)
            for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) out.push(...(this.cells.get(`${base[0]! + i},${base[1]! + j},${base[2]! + k}`) ?? []));
        return out.filter((f) => this.mesh.alive[f]);
    }
}

const gapOf = (p: ArrayLike<number>, a: number, b: number): number => Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);

/**
 * Sews two holes facing each other: a strip of triangles from one loop to the other. Each loop runs along the
 * boundary edges of the faces left round its hole; the two run in opposite directions, as the holes of two sheets
 * facing each other do. The first is walked forwards, the second backwards, each step taking the shorter diagonal.
 */
function sew(p: ArrayLike<number>, a: number[], b: number[]): number[][] {
    const back = [...b].reverse();
    let start = 0;
    for (let k = 1; k < back.length; k++) if (gapOf(p, a[0]!, back[k]!) < gapOf(p, a[0]!, back[start]!)) start = k;
    const m = [...back.slice(start), ...back.slice(0, start)];
    const out: number[][] = [];
    let i = 0,
        k = 0;
    const n = a.length,
        q = m.length;
    while (i < n || k < q) {
        const ai = a[i % n]!,
            ai1 = a[(i + 1) % n]!,
            mk = m[k % q]!,
            mk1 = m[(k + 1) % q]!;
        if (k >= q || (i < n && gapOf(p, ai1, mk) <= gapOf(p, ai, mk1))) {
            out.push([ai1, ai, mk]);
            i++;
        } else {
            out.push([mk, mk1, ai]);
            k++;
        }
    }
    return out;
}

/** The loops of a hole left by faces taken away, along the boundary edges of the faces left round it. */
function holeLoops(mesh: IMesh, removed: Set<number>): number[][] | null {
    const next = new Map<number, number>();
    for (const f of removed) {
        const [a, b, c] = corners(mesh, f);
        for (const [from, to] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const g = mesh.edges.get(to * BASE + from);
            if (g === undefined || !mesh.alive[g] || removed.has(g)) continue;
            // The face left keeps its edge (to, from): the loop runs along it.
            if (next.has(to)) return null;
            next.set(to, from);
        }
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

/**
 * Closes a slit: one loop, long and narrow, left by taking away a sheet folded on itself. Its two tips are the two
 * vertices farthest apart; from one tip to the other, its two sides are zipped together, each step taking the
 * shorter diagonal. The triangles run the loop the other way round, as the faces that were there did.
 */
function zip(p: ArrayLike<number>, loop: number[]): number[][] {
    const ring = [...loop].reverse();
    const n = ring.length;
    let s = 0,
        t = 1,
        far = -1;
    for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
            const d = gapOf(p, ring[i]!, ring[j]!);
            if (d > far) {
                far = d;
                s = i;
                t = j;
            }
        }
    // One side goes forwards from tip s to tip t, the other backwards from s to t.
    const forwards: number[] = [],
        backwards: number[] = [];
    for (let k = s; ; k = (k + 1) % n) {
        forwards.push(ring[k]!);
        if (k === t) break;
    }
    for (let k = s; ; k = (k - 1 + n) % n) {
        backwards.push(ring[k]!);
        if (k === t) break;
    }
    const last = forwards.length - 1,
        lastBack = backwards.length - 1;
    // The tip s: one triangle across it, to the first vertex of each side.
    const out: number[][] = [[forwards[0]!, forwards[1]!, backwards[1]!]];
    let i = 1,
        k = 1;
    // Then down the slit to the tip t, which closes it: a step that would bring both sides to t is not needed.
    while (!((i === last && k >= lastBack - 1) || (k === lastBack && i >= last - 1))) {
        const f = forwards[i]!,
            b = backwards[k]!;
        const canForwards = i < last && forwards[i + 1] !== b;
        const canBackwards = k < lastBack && backwards[k + 1] !== f;
        if (!canForwards && !canBackwards) break;
        if (canForwards && (!canBackwards || gapOf(p, forwards[i + 1]!, b) <= gapOf(p, f, backwards[k + 1]!))) {
            out.push([f, forwards[i + 1]!, b]);
            i++;
        } else {
            out.push([f, backwards[k + 1]!, b]);
            k++;
        }
    }
    return out;
}

/** Closes a small hole by a fan from its first vertex, without a vertex of its own. */
function fan(loop: number[]): number[][] {
    const ring = [...loop].reverse();
    const out: number[][] = [];
    for (let j = 1; j + 1 < ring.length; j++) out.push([ring[0]!, ring[j]!, ring[j + 1]!]);
    return out;
}

/** Holes a fold may leave beside its slit, closed by a fan: at most this many vertices. */
const SMALL_HOLE = 8;

/**
 * Takes away a pair of matched regions and closes what they leave; undoes it all when the surface would not stay
 * closed. Two regions apart leave a hole each, sewn to each other. Two regions that touch are the two sides of one
 * sheet folded on itself, as a front curls round the neck of a tunnel: together they leave one slit, zipped.
 * Returns the holes closed, or null.
 */
function fuseWall(mesh: IMesh, sideA: Set<number>, sideB: Set<number>, reach: number): number | null {
    const p = mesh.positions;
    const verticesA = new Set([...sideA].flatMap((f) => corners(mesh, f)));
    const folded = [...sideB].some((f) => corners(mesh, f).some((v) => verticesA.has(v)));
    const removed = new Set([...sideA, ...sideB]);
    let strip: number[][];
    let closed: number;
    if (folded) {
        const loops = holeLoops(mesh, removed);
        if (!loops || loops.length === 0) return null;
        // The slit is the longest loop; any other must be a small hole beside it.
        loops.sort((x, y) => y.length - x.length);
        if (loops.slice(1).some((loop) => loop.length > SMALL_HOLE)) return null;
        strip = [...zip(p, loops[0]!), ...loops.slice(1).flatMap(fan)];
        closed = loops.length;
    } else {
        const loopsA = holeLoops(mesh, sideA),
            loopsB = holeLoops(mesh, sideB);
        if (!loopsA || !loopsB || loopsA.length === 0 || loopsA.length !== loopsB.length) return null;
        // Pairs of loops, the nearest first.
        const meanGap = (x: number[], y: number[]): number => x.reduce((sum, u) => sum + Math.min(...y.map((v) => gapOf(p, u, v))), 0) / x.length;
        const pairs: [number, number][] = [];
        const usedB = new Set<number>();
        for (let i = 0; i < loopsA.length; i++) {
            let best = -1,
                bestGap = Infinity;
            for (let j = 0; j < loopsB.length; j++) {
                if (usedB.has(j)) continue;
                const gap = (meanGap(loopsA[i]!, loopsB[j]!) + meanGap(loopsB[j]!, loopsA[i]!)) / 2;
                if (gap < bestGap) {
                    bestGap = gap;
                    best = j;
                }
            }
            if (best < 0 || bestGap > 2 * reach) return null;
            usedB.add(best);
            pairs.push([i, best]);
        }
        strip = pairs.flatMap(([i, j]) => sew(p, loopsA[i]!, loopsB[j]!));
        closed = pairs.length;
    }
    if (strip.some(([a, b, c]) => a === b || b === c || c === a)) {
        if (process.env.FUSE_DEBUG) console.log("degenerate", folded);
        return null;
    }

    // Take the regions away, then check that the strip fits: each of its edges new, each with its twin.
    const saved = new Map<number, number>();
    for (const f of removed) {
        mesh.alive[f] = false;
        const [a, b, c] = corners(mesh, f);
        for (const [from, to] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            saved.set(from * BASE + to, f);
            mesh.edges.delete(from * BASE + to);
        }
    }
    const fresh = new Set<number>();
    let fits = true;
    for (const [a, b, c] of strip)
        for (const [from, to] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const key = from * BASE + to;
            if (mesh.edges.has(key) || fresh.has(key)) fits = false;
            fresh.add(key);
        }
    if (fits)
        for (const key of fresh) {
            const twin = (key % BASE) * BASE + Math.floor(key / BASE);
            if (!mesh.edges.has(twin) && !fresh.has(twin)) fits = false;
        }
    if (!fits) {
        if (process.env.FUSE_DEBUG) console.log("fit", folded, sideA.size, sideB.size);
        for (const f of removed) mesh.alive[f] = true;
        for (const [key, f] of saved) mesh.edges.set(key, f);
        return null;
    }
    for (const [a, b, c] of strip) addFace(mesh, a, b, c);
    return closed;
}

/**
 * Takes away the walls left where fronts met, and sews the fronts into one surface. Returns a mesh without unused
 * vertices; `kept` gives the vertex of the input each vertex of the output is.
 */
export function fuseContacts(input: IFuseInput): { positions: Float64Array; indices: Uint32Array; kept: Int32Array; report: IFuseReport } {
    const { volume, reach } = input;
    const mesh: IMesh = { positions: input.positions, faces: [], alive: [], edges: new Map(), around: new Map() };
    for (let f = 0; f < input.indices.length; f += 3) addFace(mesh, input.indices[f]!, input.indices[f + 1]!, input.indices[f + 2]!);
    const grid = new FaceGrid(mesh, reach);
    const consumed = new Set<number>();
    const report: IFuseReport = { fused: 0, kept: 0, removed: 0, sewn: 0 };

    /** A face of the other side, facing `f`, in that region or beside it; the nearest, or -1. */
    const partner = (f: number, region: Set<number>, own: Set<number>): number => {
        let best = -1,
            bestDistance = Infinity;
        for (const g of grid.near(frame(mesh, f).centre)) {
            if (consumed.has(g) || own.has(g)) continue;
            if (!region.has(g) && !neighbours(mesh, g).some((h) => region.has(h))) continue;
            const distance = facing(mesh, f, g, volume, reach);
            if (distance !== null && distance < bestDistance) {
                bestDistance = distance;
                best = g;
            }
        }
        return best;
    };

    for (let m = 0; m < input.meetings.length; m += 2) {
        const v = input.meetings[m]!,
            w = input.meetings[m + 1]!;
        // The pair of faces, one round each vertex, that face each other the nearest.
        let seed: [number, number] | null = null,
            nearest = Infinity;
        for (const f of mesh.around.get(v) ?? [])
            for (const g of mesh.around.get(w) ?? []) {
                if (!mesh.alive[f] || !mesh.alive[g] || consumed.has(f) || consumed.has(g)) continue;
                const distance = facing(mesh, f, g, volume, reach);
                if (distance !== null && distance < nearest) {
                    nearest = distance;
                    seed = [f, g];
                }
            }
        if (!seed) continue;

        // Two regions grown together: a face joins one only when a face of the other faces it.
        const sideA = new Set([seed[0]]),
            sideB = new Set([seed[1]]);
        const queue: [number, number][] = [seed];
        while (queue.length > 0) {
            const [f, g] = queue.pop()!;
            for (const [from, mine, theirs] of [
                [f, sideA, sideB],
                [g, sideB, sideA],
            ] as const)
                for (const next of neighbours(mesh, from)) {
                    if (mine.has(next) || theirs.has(next) || consumed.has(next)) continue;
                    const match = partner(next, theirs, mine);
                    if (match < 0) continue;
                    mine.add(next);
                    theirs.add(match);
                    queue.push(mine === sideA ? [next, match] : [match, next]);
                }
        }
        // The faces a region surrounds join it, so that it has no holes of its own.
        for (let pass = 0; pass < CLOSING_PASSES; pass++)
            for (const [mine, theirs] of [
                [sideA, sideB],
                [sideB, sideA],
            ] as const)
                for (const f of [...mine])
                    for (const next of neighbours(mesh, f))
                        if (!mine.has(next) && !theirs.has(next) && !consumed.has(next) && neighbours(mesh, next).every((h) => mine.has(h))) mine.add(next);
        if ([...sideA].some((f) => sideB.has(f))) {
            report.kept++;
            continue;
        }

        const sewn = fuseWall(mesh, sideA, sideB, reach);
        for (const f of [...sideA, ...sideB]) consumed.add(f);
        if (sewn === null) {
            report.kept++;
            continue;
        }
        report.fused++;
        report.removed += sideA.size + sideB.size;
        report.sewn += sewn;
    }

    // The faces alive, without the vertices no face uses any more.
    const remap = new Map<number, number>();
    const indices: number[] = [];
    const kept: number[] = [];
    for (let f = 0; f < mesh.faces.length / 3; f++) {
        if (!mesh.alive[f]) continue;
        for (const v of corners(mesh, f)) {
            let w = remap.get(v);
            if (w === undefined) {
                w = remap.size;
                remap.set(v, w);
                kept.push(v);
            }
            indices.push(w);
        }
    }
    const positions = new Float64Array(kept.length * 3);
    kept.forEach((v, w) => positions.set([input.positions[v * 3]!, input.positions[v * 3 + 1]!, input.positions[v * 3 + 2]!], w * 3));
    return { positions, indices: Uint32Array.from(indices), kept: Int32Array.from(kept), report };
}
