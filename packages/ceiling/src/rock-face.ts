/**
 * Rock face of an excavation: a closed mesh refined and moved into the rock by a field of erosion, so that its face
 * seen from the void reads as a rock wall.
 *
 * The field is the one of the SpaceXR V25 pit generator: rotated, domain-warped 3D value noise with ridges, two scales
 * of Voronoi fissures, bedding ledges on warped horizons offset by four fault planes, recession in the damage zone of
 * each fault. Contracts, frames and limits are in docs/ceiling.md.
 */

import type { IVolume } from "./grown-surface";

/** A triangle mesh: positions `x, y, z` in metres and three vertex indices per triangle. */
export interface IRockFaceInput {
    positions: ArrayLike<number>;
    indices: ArrayLike<number>;
}

/** What `buildRockFace` is asked for. Lengths are metres in the frame of the mesh. */
export interface IRockFaceOptions {
    /** Longest edge after refinement. The mesh is split until no edge is longer. */
    edgeLength: number;
    /** Largest move of a vertex, in or out of the rock. Keep it under the clearance of what the void holds. */
    maxDisplacement: number;
    /** Size of the field: 1 is the 4 km pit of V25, whose relief is about 12 m (one standard deviation). Default 1. */
    scale?: number;
    /** Relief under this wavelength is left out, for a renderer to add per pixel. Default 2.5 edge lengths. */
    minWavelength?: number;
    /** 1 when the normal of the winding points into the rock (a void wound outwards), -1 otherwise. Default 1. */
    towardsRock?: 1 | -1;
    /** The axis that points up in the frame of the mesh: `z` (east, north, up; the default) or `y` (east, up, south). */
    up?: "z" | "y";
    /** Point of the frame of the mesh where the field has its origin. Default the origin of the frame. */
    origin?: readonly [number, number, number];
    /** Refuses a refinement over this many triangles. Default 4 000 000. */
    maxFaces?: number;
    /**
     * Where the face may go, in the frame of the mesh: a vertex whose move would leave this volume moves only as far
     * as it stays in, found by bisection. A vertex already outside does not move. Default everywhere.
     */
    within?: IVolume;
}

/** A rock face: the refined mesh, moved into the rock. */
export interface IRockFace {
    /** Positions after the move, metres, frame of the input. */
    positions: Float64Array;
    /** Unit normals of the moved surface, in the winding of the input. */
    normals: Float64Array;
    /** Triangles, in the winding of the input. */
    indices: Uint32Array;
    /** Move of each vertex along its normal into the rock, metres; negative towards the void. */
    displacement: Float64Array;
    /** Wavelength under which the face carries no relief: where a renderer takes over. Metres. */
    detailWavelength: number;
    report: IRockFaceReport;
}

export interface IRockFaceReport {
    /** Passes of subdivision, each one splitting the edges still longer than the edge length. */
    refinements: number;
    triangles: number;
    vertices: number;
    /** Smallest, largest and mean move, metres. */
    displacement: { min: number; max: number; mean: number };
    /** Vertices whose move was cut to a share of the room ahead of them: the rock, or the void, is thin there. */
    limited: number;
    /** Vertices whose move was cut again by the guard, because a face they hold had turned over. */
    unturned: number;
}

/** Options of the rock field alone. */
export interface IRockFieldOptions {
    /** Size of the field: 1 is the pit of V25. Default 1. */
    scale?: number;
    /** Relief under this wavelength, in metres, is faded out. Default 0: everything. */
    minWavelength?: number;
}

/**
 * The recession of the rock at a point, in metres: how far the face of the rock stands back into it there.
 * Arguments are metres east, north and up, in the frame of the field.
 */
export type RockField = (east: number, north: number, up: number) => number;

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, x: number): number => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

function hash1(n: number): number {
    const v = Math.sin(n * 127.1 + 18.73) * 43758.5453;
    return v - Math.floor(v);
}

function noise2(x: number, z: number): number {
    const i = Math.floor(x),
        j = Math.floor(z),
        u = smooth(0, 1, x - i),
        v = smooth(0, 1, z - j);
    const m = (a: number, b: number, t: number): number => a + (b - a) * t;
    return m(m(hash1(i * 173 + j * 317), hash1((i + 1) * 173 + j * 317), u), m(hash1(i * 173 + (j + 1) * 317), hash1((i + 1) * 173 + (j + 1) * 317), u), v);
}

function hash3(i: number, j: number, k: number, seed: number): number {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1442695041) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Coherent 3D value noise in [-1, 1]. */
function noise3(x: number, y: number, z: number, seed: number): number {
    const ix = Math.floor(x),
        iy = Math.floor(y),
        iz = Math.floor(z);
    const u = smooth(0, 1, x - ix),
        v = smooth(0, 1, y - iy),
        w = smooth(0, 1, z - iz);
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
    const h = (a: number, b: number, c: number): number => hash3(ix + a, iy + b, iz + c, seed);
    return lerp(lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v), lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v), w) * 2 - 1;
}

/** A fixed orthonormal rotation: no lattice imprint, no stretch along an axis. */
function rotate3(x: number, y: number, z: number): [number, number, number] {
    return [0.792 * x - 0.441 * y + 0.422 * z, 0.539 * x + 0.823 * y - 0.18 * z, -0.268 * x + 0.37 * y + 0.89 * z];
}

// Constants of V25, tuned by eye by the user. Field frame: x east, y up, z north, metres at scale 1.
const DETAIL = { wavelengths: [320, 160, 80, 40, 20], amplitudes: [30, 18, 11, 6.5, 3.5], seed: 7429, warp: 36, ridge: 0.65 };
const EROSION = { ledgeRelief: 0.28, exposureVariation: 0.24, cellStrength: 0.34, cellScale: 82, cellSharpness: 0.23 };
const GEO = { wavelengths: [1600, 800, 350, 120], amplitudes: [18, 8, 3, 0.7], horizonSeed: 16091, faultSeed: 83117 };
const FAULTS = [
    { nx: 0.87, ny: -0.13, nz: 0.49, offset: -560, slip: [8, 65, -11] },
    { nx: -0.38, ny: 0.11, nz: 0.92, offset: 380, slip: [-9, -58, -4] },
    { nx: 0.62, ny: 0.19, nz: -0.78, offset: 1010, slip: [5, 47, 8] },
    { nx: -0.91, ny: -0.08, nz: -0.41, offset: -1280, slip: [-7, -38, 5] },
].map((fault) => {
    const length = Math.hypot(fault.nx, fault.ny, fault.nz);
    return { ...fault, nx: fault.nx / length, ny: fault.ny / length, nz: fault.nz / length };
});
const DAMAGE_WIDTH = 32,
    TRACE_RELIEF = 8,
    TRACE_RECESSION = 5;

/** Jittered 3D Voronoi: a narrow recess at the boundary of two cells, and a height of each cell. */
function cellFracture(x: number, y: number, z: number, scale: number, seed: number): { fissure: number; domain: number } {
    const q = rotate3(x / scale, y / scale, z / scale);
    const ix = Math.floor(q[0]),
        iy = Math.floor(q[1]),
        iz = Math.floor(q[2]);
    let first = 1e9,
        second = 1e9,
        site = 0;
    for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
                const cx = ix + dx,
                    cy = iy + dy,
                    cz = iz + dz;
                const sx = cx + 0.15 + 0.7 * hash3(cx, cy, cz, seed + 1);
                const sy = cy + 0.15 + 0.7 * hash3(cx, cy, cz, seed + 2);
                const sz = cz + 0.15 + 0.7 * hash3(cx, cy, cz, seed + 3);
                const d = (q[0] - sx) ** 2 + (q[1] - sy) ** 2 + (q[2] - sz) ** 2;
                if (d < first) {
                    second = first;
                    first = d;
                    site = hash3(cx, cy, cz, seed + 4);
                } else if (d < second) second = d;
            }
    const edge = Math.sqrt(second) - Math.sqrt(first);
    return { fissure: 1 - smooth(0, EROSION.cellSharpness, edge), domain: site * 2 - 1 };
}

function geoNoise2(x: number, z: number, wavelength: number, seed: number): number {
    return noise3(x / wavelength, seed * 0.00017, z / wavelength, seed);
}

function horizonWarp(x: number, z: number): number {
    let w = 0;
    for (let i = 0; i < GEO.wavelengths.length; i++) w += GEO.amplitudes[i]! * geoNoise2(x + 121.7 * i, z - 193.1 * i, GEO.wavelengths[i]!, GEO.horizonSeed + 71 * i);
    return w;
}

function horizonLocalWarp(x: number, z: number, index: number): number {
    const seed = GEO.horizonSeed + 3109 + index * 7919;
    return 2 * geoNoise2(x, z, 620, seed) + geoNoise2(x + 137, z - 89, 230, seed + 17);
}

function faultDistance(x: number, y: number, z: number, index: number): number {
    const f = FAULTS[index]!,
        seed = GEO.faultSeed + index * 13007;
    const warp = 12 * noise3((x + index * 109) / 1200, (y - 250) / 900, (z - index * 83) / 1200, seed) + 5 * noise3(x / 510 + 19, y / 600 - 7, z / 530 + 11, seed + 29);
    return f.nx * x + f.ny * (y - 250) + f.nz * z - f.offset - warp;
}

/** Recession at a point of the field frame (x east, y up, z north), at scale 1, with octaves under `minWavelength` faded. */
function recession(x: number, y: number, z: number, minWavelength: number): number {
    const fade = (wavelength: number): number => (minWavelength > 0 ? smooth(minWavelength / 2, minWavelength, wavelength) : 1);

    // Undo the youngest fault slip first: horizons are read in the rock as it was laid down.
    let gx = x,
        gy = y,
        gz = z;
    for (let i = FAULTS.length - 1; i >= 0; i--) {
        if (faultDistance(gx, gy, gz, i) >= 0) {
            const slip = FAULTS[i]!.slip;
            gx -= slip[0]!;
            gy -= slip[1]!;
            gz -= slip[2]!;
        }
    }
    let erosion = 0,
        weather = 0,
        trace = 0;
    for (let i = 0; i < FAULTS.length; i++) {
        const proximity = 1 - smooth(0, DAMAGE_WIDTH, Math.abs(faultDistance(x, y, z, i)));
        erosion += proximity * (TRACE_RECESSION + 2 * noise2(x / 310 + FAULTS[i]!.offset, z / 360));
        trace += proximity * TRACE_RELIEF;
        weather += proximity;
    }
    const layerY = gy - 0.085 * gx + 0.057 * gz - horizonWarp(gx, gz);
    const h150 = 150 + horizonLocalWarp(gx, gz, 0),
        h311 = 311 + horizonLocalWarp(gx, gz, 1),
        h408 = 408 + horizonLocalWarp(gx, gz, 2);
    const shelf1 = smooth(h150 - 11, h150 + 11, layerY) * (1 - smooth(h311 - 11, h311 + 11, layerY));
    const shelf2 = smooth(h408 - 12, h408 + 12, layerY);
    const large = 24 * (noise2(x / 520 + 7, z / 540 + 11) - 0.5) + 12 * (noise2(x / 270 - 4, z / 300 + 2) - 0.5);
    const ledgeMask = smooth(-0.35, 0.45, noise3(x / 260 + 17, y / 190 - 3, z / 290 + 7, 17173));
    const bedding = (-18 * shelf1 - 12 * shelf2) * (EROSION.ledgeRelief + (1 - EROSION.ledgeRelief) * ledgeMask) * fade(44);

    // Erosion detail, isotropic, in world space: never read from the restored layer height, which jumps at faults.
    const warpScale = 610;
    const a = x + DETAIL.warp * noise3(x / warpScale, y / warpScale, z / warpScale, DETAIL.seed + 77);
    const b = y + DETAIL.warp * noise3(x / warpScale + 17, y / warpScale + 3, z / warpScale - 13, DETAIL.seed + 79);
    const c = z + DETAIL.warp * noise3(x / warpScale + 13, y / warpScale, z / warpScale - 9, DETAIL.seed + 78);
    let octaves = 0;
    for (let k = 0; k < DETAIL.wavelengths.length; k++) {
        const wavelength = DETAIL.wavelengths[k]!,
            weight = fade(wavelength);
        if (weight === 0) continue;
        const seed = DETAIL.seed + k * 104729;
        const v = rotate3(a / wavelength + 13.71 * k, b / wavelength - 8.31 * k, c / wavelength + 21.29 * k);
        const n0 = noise3(v[0], v[1], v[2], seed);
        const n1 = noise3(v[0] + 17.2, v[1] - 9.1, v[2] + 4.7, seed + 31);
        // Smooth shapes of V26: no infinite slope at zero, no hard crease on the ridges.
        const ridge = 1 - 2 * (Math.sqrt(n1 * n1 + 0.0025) - 0.05);
        const sharp = n0 * (1.5 - 0.5 * n0 * n0);
        octaves += weight * DETAIL.amplitudes[k]! * ((1 - DETAIL.ridge) * sharp + DETAIL.ridge * ridge);
    }
    let cells = 0;
    const weightA = fade(EROSION.cellScale),
        weightB = fade(EROSION.cellScale * 0.48);
    if (weightA > 0) {
        const cellsA = cellFracture(a, b, c, EROSION.cellScale, DETAIL.seed + 600);
        cells += weightA * (-8 * cellsA.fissure + 4 * cellsA.domain);
    }
    if (weightB > 0) {
        const cellsB = cellFracture(a + 113, b - 71, c + 43, EROSION.cellScale * 0.48, DETAIL.seed + 700);
        cells += weightB * (-3 * cellsB.fissure + 1.5 * cellsB.domain);
    }
    const patch = 1 + EROSION.exposureVariation * noise3(x / 290 + 9, y / 290 - 4, z / 290 + 11, 12911);
    const exposure = 1 + 0.12 * clamp(weather, 0, 1.6);
    const detail = patch * exposure * (octaves + EROSION.cellStrength * cells);

    return large + bedding - erosion * fade(DAMAGE_WIDTH) - trace * fade(DAMAGE_WIDTH) + detail;
}

/**
 * The rock field at a scale: `scale * field(p / scale)`, so a smaller excavation keeps the look of the pit of V25 at
 * a smaller size. Relief under `minWavelength` metres is faded out over one octave.
 */
export function createRockField(options: IRockFieldOptions = {}): RockField {
    const scale = options.scale ?? 1;
    if (!(scale > 0)) throw new RangeError("The rock field needs a positive scale.");
    const minWavelength = Math.max(0, options.minWavelength ?? 0) / scale;
    return (east, north, up) => scale * recession(east / scale, up / scale, north / scale, minWavelength);
}

/**
 * Splits at its middle every edge longer than `longest`, and each triangle by the edges of it that were split: in two
 * for one, in three for two, in four for three. An edge is split or not for both its triangles, so the mesh stays
 * closed; only the long edges are touched, so a mesh with a few long edges does not grow everywhere.
 */
function subdivide(positions: number[], indices: number[], longest: number): number[] {
    const middles = new Map<number, number>();
    const vertices = positions.length / 3;
    const length = (a: number, b: number): number =>
        Math.hypot(positions[a * 3]! - positions[b * 3]!, positions[a * 3 + 1]! - positions[b * 3 + 1]!, positions[a * 3 + 2]! - positions[b * 3 + 2]!);
    /** The middle of an edge to split, made once for its two triangles; -1 for an edge kept whole. */
    const middle = (a: number, b: number): number => {
        if (length(a, b) <= longest) return -1;
        const key = a < b ? a * vertices + b : b * vertices + a;
        let at = middles.get(key);
        if (at === undefined) {
            at = positions.length / 3;
            positions.push((positions[a * 3]! + positions[b * 3]!) / 2, (positions[a * 3 + 1]! + positions[b * 3 + 1]!) / 2, (positions[a * 3 + 2]! + positions[b * 3 + 2]!) / 2);
            middles.set(key, at);
        }
        return at;
    };
    const next: number[] = [];
    for (let face = 0; face < indices.length; face += 3) {
        const corner = [indices[face]!, indices[face + 1]!, indices[face + 2]!];
        const split = [middle(corner[0]!, corner[1]!), middle(corner[1]!, corner[2]!), middle(corner[2]!, corner[0]!)];
        const count = split.filter((m) => m >= 0).length;
        if (count === 0) {
            next.push(corner[0]!, corner[1]!, corner[2]!);
            continue;
        }
        if (count === 3) {
            const [a, b, c] = corner as [number, number, number];
            const [ab, bc, ca] = split as [number, number, number];
            next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
            continue;
        }
        // Turned so that the edge from a to b is split, and, for two, the edge from b to c too: the order of the
        // corners, and so the winding, is kept.
        let turn = 0;
        if (count === 1) turn = split.findIndex((m) => m >= 0);
        else turn = (split.findIndex((m) => m < 0) + 1) % 3;
        const [a, b, c] = [corner[turn]!, corner[(turn + 1) % 3]!, corner[(turn + 2) % 3]!];
        const ab = split[turn]!,
            bc = split[(turn + 1) % 3]!;
        if (count === 1) {
            next.push(a, ab, c, ab, b, c);
            continue;
        }
        // Two: the corner at b, then the quad a, ab, bc, c by its shorter diagonal.
        next.push(ab, b, bc);
        if (length(a, bc) <= length(ab, c)) next.push(a, ab, bc, a, bc, c);
        else next.push(a, ab, c, ab, bc, c);
    }
    return next;
}

function longestEdge(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
    let longest = 0;
    const edge = (a: number, b: number): number =>
        Math.hypot(positions[a * 3]! - positions[b * 3]!, positions[a * 3 + 1]! - positions[b * 3 + 1]!, positions[a * 3 + 2]! - positions[b * 3 + 2]!);
    for (let face = 0; face < indices.length; face += 3) {
        const a = indices[face]!,
            b = indices[face + 1]!,
            c = indices[face + 2]!;
        longest = Math.max(longest, edge(a, b), edge(b, c), edge(c, a));
    }
    return longest;
}

/** Unit normals of the vertices: the sum of the normals of their faces, weighted by area, in the winding. */
function vertexNormals(positions: ArrayLike<number>, indices: ArrayLike<number>): Float64Array {
    const normals = new Float64Array(positions.length);
    for (let face = 0; face < indices.length; face += 3) {
        const a = indices[face]! * 3,
            b = indices[face + 1]! * 3,
            c = indices[face + 2]! * 3;
        const ux = positions[b]! - positions[a]!,
            uy = positions[b + 1]! - positions[a + 1]!,
            uz = positions[b + 2]! - positions[a + 2]!;
        const vx = positions[c]! - positions[a]!,
            vy = positions[c + 1]! - positions[a + 1]!,
            vz = positions[c + 2]! - positions[a + 2]!;
        const nx = uy * vz - uz * vy,
            ny = uz * vx - ux * vz,
            nz = ux * vy - uy * vx;
        for (const corner of [a, b, c]) {
            normals[corner] += nx;
            normals[corner + 1] += ny;
            normals[corner + 2] += nz;
        }
    }
    for (let at = 0; at < normals.length; at += 3) {
        const length = Math.hypot(normals[at]!, normals[at + 1]!, normals[at + 2]!) || 1;
        normals[at] /= length;
        normals[at + 1] /= length;
        normals[at + 2] /= length;
    }
    return normals;
}

/** Share of the room ahead of a vertex that its move may take. */
const ROOM_SHARE = 0.4;
/** A face is turned over when the cosine of the angle of its normal with the one it had is under this: 75 degrees. */
const TURNED = 0.25;
/** Passes of the guard that halve the moves round the faces turned over; after them, those moves are set to nothing. */
const GUARD_PASSES = 12;

/**
 * The room ahead of the vertices of a surface. For a vertex and a unit direction normal to the surface there, it is
 * the radius of the largest ball that touches the surface at the vertex, on the side of the direction, and holds
 * nothing else of the surface. A move shorter than that radius stays on its side of the middle of a slab of rock, or
 * of a narrow void, which the other face reaches from the other side.
 *
 * The ball is tried against the other vertices, and against the faces the line of the move goes through, of which it
 * can hold half the distance. The vertices alone would miss a face right ahead and nearer than its own corners.
 */
class Room {
    private readonly cell: number;
    private readonly min: [number, number, number] = [Infinity, Infinity, Infinity];
    private readonly count: [number, number, number] = [1, 1, 1];
    private readonly vertexCells = new Map<number, number[]>();
    private readonly faceCells = new Map<number, number[]>();
    /** The query that last looked at each face: a face stands in several cells. */
    private readonly seen: Uint32Array;
    private query = 0;

    /** `reach` is the largest diameter of a ball worth knowing: a larger ball limits no move. */
    public constructor(
        private readonly positions: ArrayLike<number>,
        private readonly indices: ArrayLike<number>,
        private readonly reach: number
    ) {
        this.cell = reach / 2;
        this.seen = new Uint32Array(indices.length / 3);
        const max = [-Infinity, -Infinity, -Infinity];
        for (let at = 0; at < positions.length; at += 3)
            for (let axis = 0; axis < 3; axis++) {
                this.min[axis] = Math.min(this.min[axis]!, positions[at + axis]!);
                max[axis] = Math.max(max[axis]!, positions[at + axis]!);
            }
        for (let axis = 0; axis < 3; axis++) this.count[axis] = Math.max(1, Math.floor((max[axis]! - this.min[axis]!) / this.cell) + 1);
        for (let v = 0; v < positions.length / 3; v++)
            this.add(this.vertexCells, this.key(this.at(positions[v * 3]!, 0), this.at(positions[v * 3 + 1]!, 1), this.at(positions[v * 3 + 2]!, 2)), v);
        for (let face = 0; face < indices.length / 3; face++) {
            const low = [Infinity, Infinity, Infinity],
                high = [-Infinity, -Infinity, -Infinity];
            for (let corner = 0; corner < 3; corner++)
                for (let axis = 0; axis < 3; axis++) {
                    const value = positions[indices[face * 3 + corner]! * 3 + axis]!;
                    low[axis] = Math.min(low[axis]!, value);
                    high[axis] = Math.max(high[axis]!, value);
                }
            for (let i = this.at(low[0]!, 0); i <= this.at(high[0]!, 0); i++)
                for (let j = this.at(low[1]!, 1); j <= this.at(high[1]!, 1); j++)
                    for (let k = this.at(low[2]!, 2); k <= this.at(high[2]!, 2); k++) this.add(this.faceCells, this.key(i, j, k), face);
        }
    }

    private at(value: number, axis: number): number {
        return Math.floor((value - this.min[axis]!) / this.cell);
    }

    /** The key of a cell, or -1 outside the grid. */
    private key(i: number, j: number, k: number): number {
        if (i < 0 || j < 0 || k < 0 || i >= this.count[0] || j >= this.count[1] || k >= this.count[2]) return -1;
        return (i * this.count[1] + j) * this.count[2] + k;
    }

    private add(cells: Map<number, number[]>, key: number, value: number): void {
        if (key < 0) return;
        const list = cells.get(key);
        if (list) list.push(value);
        else cells.set(key, [value]);
    }

    /** The room ahead of a vertex along a unit direction, in metres: infinite when nothing stands within reach. */
    public ahead(vertex: number, dx: number, dy: number, dz: number): number {
        const p = this.positions;
        const px = p[vertex * 3]!,
            py = p[vertex * 3 + 1]!,
            pz = p[vertex * 3 + 2]!;
        const ci = this.at(px, 0),
            cj = this.at(py, 1),
            ck = this.at(pz, 2);
        let radius = Infinity;

        // The other vertices. A ball of radius r that touches the surface at p, its centre along d, holds q when
        // |q - p|² < 2 r (q - p).d: the largest ball that does not hold q has the radius |q - p|² / (2 (q - p).d).
        const farthest = this.reach * this.reach;
        for (let i = ci - 2; i <= ci + 2; i++)
            for (let j = cj - 2; j <= cj + 2; j++)
                for (let k = ck - 2; k <= ck + 2; k++) {
                    const list = this.vertexCells.get(this.key(i, j, k));
                    if (!list) continue;
                    for (const q of list) {
                        const x = p[q * 3]! - px,
                            y = p[q * 3 + 1]! - py,
                            z = p[q * 3 + 2]! - pz;
                        const ahead = x * dx + y * dy + z * dz;
                        if (!(ahead > 0)) continue;
                        const square = x * x + y * y + z * z;
                        if (square < farthest) radius = Math.min(radius, square / (2 * ahead));
                    }
                }

        // The faces on the line of the move, those of the vertex left out: the ball holds half the way to the nearest.
        this.query++;
        const ex = px + dx * this.reach,
            ey = py + dy * this.reach,
            ez = pz + dz * this.reach;
        for (let i = this.at(Math.min(px, ex), 0); i <= this.at(Math.max(px, ex), 0); i++)
            for (let j = this.at(Math.min(py, ey), 1); j <= this.at(Math.max(py, ey), 1); j++)
                for (let k = this.at(Math.min(pz, ez), 2); k <= this.at(Math.max(pz, ez), 2); k++) {
                    const list = this.faceCells.get(this.key(i, j, k));
                    if (!list) continue;
                    for (const face of list) {
                        if (this.seen[face] === this.query) continue;
                        this.seen[face] = this.query;
                        const a = this.indices[face * 3]!,
                            b = this.indices[face * 3 + 1]!,
                            c = this.indices[face * 3 + 2]!;
                        if (a === vertex || b === vertex || c === vertex) continue;
                        const distance = this.crossing(px, py, pz, dx, dy, dz, a * 3, b * 3, c * 3);
                        if (distance < this.reach) radius = Math.min(radius, distance / 2);
                    }
                }
        return radius;
    }

    /** How far along a line from a point a triangle is, infinite when the line misses it (Möller and Trumbore). */
    private crossing(px: number, py: number, pz: number, dx: number, dy: number, dz: number, a: number, b: number, c: number): number {
        const p = this.positions;
        const ux = p[b]! - p[a]!,
            uy = p[b + 1]! - p[a + 1]!,
            uz = p[b + 2]! - p[a + 2]!;
        const vx = p[c]! - p[a]!,
            vy = p[c + 1]! - p[a + 1]!,
            vz = p[c + 2]! - p[a + 2]!;
        const hx = dy * vz - dz * vy,
            hy = dz * vx - dx * vz,
            hz = dx * vy - dy * vx;
        const det = ux * hx + uy * hy + uz * hz;
        if (Math.abs(det) < 1e-12) return Infinity;
        const sx = px - p[a]!,
            sy = py - p[a + 1]!,
            sz = pz - p[a + 2]!;
        const s = (sx * hx + sy * hy + sz * hz) / det;
        if (s < 0 || s > 1) return Infinity;
        const qx = sy * uz - sz * uy,
            qy = sz * ux - sx * uz,
            qz = sx * uy - sy * ux;
        const t = (dx * qx + dy * qy + dz * qz) / det;
        if (t < 0 || s + t > 1) return Infinity;
        const distance = (vx * qx + vy * qy + vz * qz) / det;
        return distance > 1e-9 ? distance : Infinity;
    }
}

/**
 * The faces turned over by a move: those whose normal after it makes, with the normal they had, an angle of more than
 * 75 degrees. A face without area before the move is left out; one without area after it counts.
 */
function facesTurned(before: ArrayLike<number>, after: ArrayLike<number>, indices: ArrayLike<number>): number[] {
    const turned: number[] = [];
    const normal = (positions: ArrayLike<number>, face: number): [number, number, number, number] => {
        const a = indices[face]! * 3,
            b = indices[face + 1]! * 3,
            c = indices[face + 2]! * 3;
        const ux = positions[b]! - positions[a]!,
            uy = positions[b + 1]! - positions[a + 1]!,
            uz = positions[b + 2]! - positions[a + 2]!;
        const vx = positions[c]! - positions[a]!,
            vy = positions[c + 1]! - positions[a + 1]!,
            vz = positions[c + 2]! - positions[a + 2]!;
        const nx = uy * vz - uz * vy,
            ny = uz * vx - ux * vz,
            nz = ux * vy - uy * vx;
        return [nx, ny, nz, Math.hypot(nx, ny, nz)];
    };
    for (let face = 0; face < indices.length; face += 3) {
        const [bx, by, bz, was] = normal(before, face);
        if (!(was > 0)) continue;
        const [ax, ay, az, is] = normal(after, face);
        if (!(is > 0) || (ax * bx + ay * by + az * bz) / (was * is) < TURNED) turned.push(face / 3);
    }
    return turned;
}

/**
 * Turns a mesh into a rock face: refined to `edgeLength`, then each vertex moved along its normal into the rock by
 * the recession of the rock field, softly limited to `maxDisplacement` and to a share of the room ahead of it, so
 * that the face does not cross itself where the rock or the void is thin. The face seen from the void reads as rock;
 * relief under `detailWavelength` is left to the renderer.
 */
export function buildRockFace(mesh: IRockFaceInput, options: IRockFaceOptions): IRockFace {
    const { edgeLength, maxDisplacement } = options;
    if (!(edgeLength > 0)) throw new RangeError("A rock face needs a positive edge length.");
    if (!(maxDisplacement >= 0)) throw new RangeError("A rock face needs a displacement limit of zero or more.");
    if (mesh.indices.length % 3 !== 0) throw new RangeError("A rock face needs whole triangles.");
    const towardsRock = options.towardsRock ?? 1;
    const maxFaces = options.maxFaces ?? 4_000_000;
    const detailWavelength = options.minWavelength ?? 2.5 * edgeLength;
    const field = createRockField({ scale: options.scale, minWavelength: detailWavelength });
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    // The field reads east, north, up.
    const sample: (x: number, y: number, z: number) => number = options.up === "y" ? (x, y, z) => field(x - ox, -(z - oz), y - oy) : (x, y, z) => field(x - ox, y - oy, z - oz);

    const positions = Array.from(mesh.positions);
    let indices = Array.from(mesh.indices);
    let refinements = 0;
    while (indices.length > 0 && longestEdge(positions, indices) > edgeLength) {
        if (indices.length * 4 > maxFaces * 3) throw new RangeError(`Refining the rock face to ${edgeLength} m would make more than ${maxFaces} triangles.`);
        indices = subdivide(positions, indices, edgeLength);
        refinements++;
    }

    const normals = vertexNormals(positions, indices);
    const vertices = positions.length / 3;
    const displacement = new Float64Array(vertices);
    const limit = (d: number): number => (maxDisplacement > 0 ? maxDisplacement * Math.tanh(d / maxDisplacement) : 0);
    const moved = new Float64Array(positions.length);
    // A ball that limits a move has a radius under maxDisplacement / ROOM_SHARE: what it could hold is within its diameter.
    const room = maxDisplacement > 0 ? new Room(positions, indices, (2 * maxDisplacement) / ROOM_SHARE) : null;
    let limited = 0;
    for (let v = 0; v < vertices; v++) {
        const px = positions[v * 3]!,
            py = positions[v * 3 + 1]!,
            pz = positions[v * 3 + 2]!;
        const nx = normals[v * 3]! * towardsRock,
            ny = normals[v * 3 + 1]! * towardsRock,
            nz = normals[v * 3 + 2]! * towardsRock;
        // The field is read where the face ends up, as in V25: three fixed-point steps.
        let d = 0;
        for (let step = 0; step < 3; step++) d = limit(sample(px + nx * d, py + ny * d, pz + nz * d));
        // No further than a share of the room ahead, on the side the vertex moves to, the rock or the void: the two
        // faces of a wedge of rock, each moving into it, would pass each other.
        if (room && d !== 0) {
            const side = d > 0 ? 1 : -1;
            const most = ROOM_SHARE * room.ahead(v, nx * side, ny * side, nz * side);
            if (Math.abs(d) > most) {
                d = side * most;
                limited++;
            }
        }
        const within = options.within;
        if (within && !within.contains(px + nx * d, py + ny * d, pz + nz * d)) {
            if (!within.contains(px, py, pz)) d = 0;
            else {
                // The share of the move that stays in: bisection between none (in) and all (out).
                let inside = 0,
                    outside = 1;
                for (let step = 0; step < 24; step++) {
                    const share = (inside + outside) / 2;
                    if (within.contains(px + nx * d * share, py + ny * d * share, pz + nz * d * share)) inside = share;
                    else outside = share;
                }
                d *= inside;
            }
        }
        displacement[v] = d;
        moved[v * 3] = px + nx * d;
        moved[v * 3 + 1] = py + ny * d;
        moved[v * 3 + 2] = pz + nz * d;
    }

    // The guard: no face turned over. The moves of the vertices of such a face are halved, pass after pass, then set
    // to nothing, which gives the face back as it was.
    const held = new Uint8Array(vertices);
    for (let pass = 0; ; pass++) {
        const turned = facesTurned(positions, moved, indices);
        if (turned.length === 0) break;
        const factor = pass < GUARD_PASSES ? 0.5 : 0;
        const marked = new Set<number>();
        for (const face of turned) for (let corner = 0; corner < 3; corner++) marked.add(indices[face * 3 + corner]!);
        let changed = false;
        for (const v of marked) {
            if (displacement[v] === 0) continue;
            changed = true;
            held[v] = 1;
            const d = displacement[v]! * factor;
            displacement[v] = d;
            for (let axis = 0; axis < 3; axis++) moved[v * 3 + axis] = positions[v * 3 + axis]! + normals[v * 3 + axis]! * towardsRock * d;
        }
        if (!changed) break;
    }

    let min = Infinity,
        max = -Infinity,
        sum = 0,
        unturned = 0;
    for (let v = 0; v < vertices; v++) {
        const d = displacement[v]!;
        min = Math.min(min, d);
        max = Math.max(max, d);
        sum += d;
        unturned += held[v]!;
    }
    const triangles = Uint32Array.from(indices);
    return {
        positions: moved,
        normals: vertexNormals(moved, triangles),
        indices: triangles,
        displacement,
        detailWavelength,
        report: {
            refinements,
            triangles: triangles.length / 3,
            vertices,
            displacement: vertices > 0 ? { min, max, mean: sum / vertices } : { min: 0, max: 0, mean: 0 },
            limited,
            unturned,
        },
    };
}
