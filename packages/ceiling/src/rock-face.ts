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
    /** Passes of subdivision, each one splitting every triangle in four. */
    refinements: number;
    triangles: number;
    vertices: number;
    /** Smallest, largest and mean move, metres. */
    displacement: { min: number; max: number; mean: number };
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

/** Splits every triangle in four at the middles of its edges; shared edges get one middle. */
function subdivide(positions: number[], indices: number[]): number[] {
    const middles = new Map<number, number>();
    const vertices = positions.length / 3;
    const middle = (a: number, b: number): number => {
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
        const a = indices[face]!,
            b = indices[face + 1]!,
            c = indices[face + 2]!;
        const ab = middle(a, b),
            bc = middle(b, c),
            ca = middle(c, a);
        next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
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

/**
 * Turns a mesh into a rock face: refined to `edgeLength`, then each vertex moved along its normal into the rock by
 * the recession of the rock field, softly limited to `maxDisplacement`. The face seen from the void reads as rock;
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
        indices = subdivide(positions, indices);
        refinements++;
    }

    const normals = vertexNormals(positions, indices);
    const vertices = positions.length / 3;
    const displacement = new Float64Array(vertices);
    const limit = (d: number): number => (maxDisplacement > 0 ? maxDisplacement * Math.tanh(d / maxDisplacement) : 0);
    const moved = new Float64Array(positions.length);
    let min = Infinity,
        max = -Infinity,
        sum = 0;
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
        min = Math.min(min, d);
        max = Math.max(max, d);
        sum += d;
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
        },
    };
}
