import { fuseContacts, type IFuseReport } from "./fuse";
import type { IPoint3 } from "./quickhull";

/**
 * A region of space, known only by the points it holds. Constraints are volumes: a surface grows inside the
 * intersection of them.
 */
export interface IVolume {
    contains(x: number, y: number, z: number): boolean;
}

export interface IGrownSurfaceOptions {
    /** Centre of the sphere the surface starts as. The whole sphere must be inside the volume. */
    seed: IPoint3;
    /** Length the edges aim at: a face larger than an equilateral triangle of that edge is split. */
    edgeLength: number;
    /** Radius of the starting sphere. Defaults to half the edge length; a tenth of it at least. */
    seedRadius?: number;
    /**
     * Largest move of a vertex along its normal in one step. Defaults to a quarter of the edge length. It is part of the result: a vertex
     * follows the normals of the steps before, so another step gives another surface. Features of the volume
     * thinner than the step can be stepped over.
     */
    step?: number;
    /** How near the boundary of the volume a stopped vertex is set. Defaults to a hundredth of the edge length. */
    tolerance?: number;
    /** No face is split beyond this number of vertices. Defaults to 200 000. */
    maxVertices?: number;
    /** {@link GrownSurface.grow} gives up after this number of steps. Defaults to 10 000. */
    maxSteps?: number;
    /**
     * Whether {@link GrownSurface.mesh} fuses the fronts that met into one surface (see `fuseContacts`) instead of
     * leaving a thin wall where they stopped. Defaults to false: the fusion fills a ring, but on a network of
     * chambers and tunnels its walls are ragged, many holes find no hole facing them and are closed by fans.
     */
    fuse?: boolean;
}

/** A closed triangle mesh, wound counter-clockwise seen from outside. */
export interface IGrownSurfaceMesh {
    /** `x`, `y`, `z` of each vertex. */
    positions: Float64Array;
    /** Three vertices per triangle. */
    indices: Uint32Array;
    /** 1 for a vertex stopped by the volume, 0 for a vertex still free to move. */
    fixed: Uint8Array;
}

/** Where a growth stands. */
export interface IGrowthReport {
    /** Steps run. */
    steps: number;
    vertices: number;
    faces: number;
    /** Vertices still free to move. */
    free: number;
    /** Vertices fixed where they stood because their edges had become very short. */
    squeezed: number;
    /** Vertices fixed inside the volume because the push outwards and the pull of their neighbours cancelled out. */
    settled: number;
    /** Vertices fixed inside the volume because another front of the surface was coming the other way. */
    contact: number;
    /** What the fusion of the fronts did, once {@link GrownSurface.mesh} has fused them; null before or without it. */
    fusion: IFuseReport | null;
    /** Face centres that stood outside the volume and could not be brought back inside. */
    unresolved: number;
    /** Whether the growth ended by itself: no vertex moves and no face is to split. */
    complete: boolean;
}

const FREE = 0;
const FIXED = 1;

/** Directed edges are keyed by `from * EDGE_BASE + to`, exact for less than 2^26 vertices. */
const EDGE_BASE = 2 ** 26;
/** A vertex whose shortest edge is under this share of the edge length is fixed where it stands. */
const SQUEEZE = 0.05;
/** Share of the way a free vertex goes towards the middle of its neighbours at each step. */
const SMOOTHING = 0.4;
/** Two fronts of the surface stop when they come within this share of the edge length of each other. */
const CONTACT = 0.9;
/** Two vertices face each other when the cosine of the angle between their normals is under this. */
const FACING = -0.2;
/** Points of the segment between two fronts where the volume is asked whether they face each other across it. */
const BETWEEN = [0.2, 0.4, 0.6, 0.8] as const;

/** Key of a cell of the grid of vertices. Two cells can share a key: a vertex is then tested for nothing. */
function cellKey(x: number, y: number, z: number): number {
    return Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
}
/** An edge is flipped when the cotangents of the two angles facing it add up to less than this. */
const FLIP_THRESHOLD = -1e-9;

const GOLDEN = (1 + Math.sqrt(5)) / 2;
const ICOSAHEDRON_VERTICES: readonly (readonly [number, number, number])[] = [
    [-1, GOLDEN, 0],
    [1, GOLDEN, 0],
    [-1, -GOLDEN, 0],
    [1, -GOLDEN, 0],
    [0, -1, GOLDEN],
    [0, 1, GOLDEN],
    [0, -1, -GOLDEN],
    [0, 1, -GOLDEN],
    [GOLDEN, 0, -1],
    [GOLDEN, 0, 1],
    [-GOLDEN, 0, -1],
    [-GOLDEN, 0, 1],
];
const ICOSAHEDRON_FACES: readonly (readonly [number, number, number])[] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
];

/**
 * A closed surface that grows from a sphere until a volume stops it.
 *
 * Each step moves every free vertex along its normal, the mean of the normals of its faces weighted by their angles
 * at the vertex. A vertex whose move would leave the volume is set on the boundary and fixed for good. Faces that
 * grow too large are split in three by a vertex at their centre, and edges are flipped where the triangles on both
 * sides are better off: together, the square root of three subdivision, which refines one face without touching its
 * neighbours and keeps the triangles regular. No vertex is ever removed, so each stage holds the vertices of the
 * stages before.
 *
 * While it grows, the surface keeps the topology of a sphere. Where two of its fronts come face to face across the
 * volume, they stop short of each other, the edge length apart, and the report counts their vertices (`contact`):
 * so do the two fronts that go round the hole of a ring, and the sides of a front that pushes through a narrow
 * opening into a larger room and curls round it. {@link GrownSurface.mesh} then fuses them (`fuseContacts`): the
 * thin wall they make is taken away and the fronts are sewn into one surface, which can have holes through it, as
 * the volume does.
 */
export class GrownSurface {
    private readonly volume: IVolume;
    private readonly positions: number[] = [];
    private readonly faces: number[] = [];
    private readonly states: number[] = [];
    private readonly fuse: boolean;
    private fusion: IFuseReport | null = null;
    /** Pairs of vertices where two fronts met: the vertex that stopped, and the vertex of the front it met. */
    private readonly meetings: number[] = [];
    /** Face on the left of each directed edge. */
    private readonly edges = new Map<number, number>();
    private readonly edgeLength: number;
    private readonly stepLength: number;
    private readonly tolerance: number;
    private readonly maxArea: number;
    private readonly maxVertices: number;
    private readonly maxSteps: number;
    private steps = 0;
    private squeezed = 0;
    private settled = 0;
    private contact = 0;
    private unresolved = 0;
    private complete = false;

    public constructor(volume: IVolume, options: IGrownSurfaceOptions) {
        const { seed, edgeLength } = options;
        if (!(edgeLength > 0) || !Number.isFinite(edgeLength)) throw new RangeError("The edge length of a grown surface must be a positive length.");
        const seedRadius = options.seedRadius ?? edgeLength / 2;
        if (!(seedRadius >= edgeLength / 10)) throw new RangeError("The seed of a grown surface must be a tenth of the edge length at least.");
        const step = options.step ?? edgeLength / 4;
        const tolerance = options.tolerance ?? edgeLength / 100;
        if (!(step > 0) || !(tolerance > 0)) throw new RangeError("The step and the tolerance of a grown surface must be positive lengths.");

        this.volume = volume;
        this.edgeLength = edgeLength;
        this.stepLength = step;
        this.tolerance = tolerance;
        this.maxArea = (Math.sqrt(3) / 4) * edgeLength * edgeLength;
        this.maxVertices = options.maxVertices ?? 200_000;
        this.maxSteps = options.maxSteps ?? 10_000;
        this.fuse = options.fuse ?? false;

        const scale = seedRadius / Math.hypot(1, GOLDEN);
        for (const [x, y, z] of ICOSAHEDRON_VERTICES) {
            const px = seed.x + x * scale;
            const py = seed.y + y * scale;
            const pz = seed.z + z * scale;
            if (!volume.contains(px, py, pz)) throw new RangeError("The seed of a grown surface must be inside the volume, with its radius.");
            this.positions.push(px, py, pz);
            this.states.push(FREE);
        }
        for (const [a, b, c] of ICOSAHEDRON_FACES) this.addFace(a, b, c);
    }

    /**
     * Runs one step of the growth: moves the free vertices, then splits the faces that are too large.
     *
     * @returns Whether anything changed. `false` means the growth has ended.
     */
    public step(): boolean {
        if (this.complete) return false;
        const moved = this.advance();
        const split = this.refine();
        this.steps++;
        this.complete = !moved && !split;
        return !this.complete;
    }

    /** Grows until nothing changes, or until the largest number of steps. */
    public grow(): IGrowthReport {
        while (this.steps < this.maxSteps && this.step());
        return this.report();
    }

    public report(): IGrowthReport {
        let free = 0;
        for (const state of this.states) if (state === FREE) free++;
        return {
            steps: this.steps,
            vertices: this.states.length,
            faces: this.faces.length / 3,
            free,
            squeezed: this.squeezed,
            settled: this.settled,
            contact: this.contact,
            fusion: this.fusion,
            unresolved: this.unresolved,
            complete: this.complete,
        };
    }

    /** Where fronts met: for each meeting, the points of the two vertices, `x, y, z` then `x, y, z`. */
    public meetingPoints(): Float64Array {
        const out = new Float64Array(this.meetings.length * 3);
        this.meetings.forEach((v, at) => out.set([this.positions[v * 3]!, this.positions[v * 3 + 1]!, this.positions[v * 3 + 2]!], at * 3));
        return out;
    }

    /** The surface as it stands, copied: with the fronts that met fused into one, unless asked otherwise. */
    public mesh(): IGrownSurfaceMesh {
        if (!this.fuse || this.contact === 0) return { positions: Float64Array.from(this.positions), indices: Uint32Array.from(this.faces), fixed: Uint8Array.from(this.states) };
        // A wall is about the distance at which two fronts stopped: a little more, to take both of its sides.
        const fused = fuseContacts({
            positions: this.positions,
            indices: this.faces,
            meetings: this.meetings,
            volume: this.volume,
            reach: this.edgeLength * (CONTACT + 0.3),
        });
        this.fusion = fused.report;
        return { positions: fused.positions, indices: fused.indices, fixed: Uint8Array.from(fused.kept, (v) => this.states[v]!) };
    }

    private addFace(a: number, b: number, c: number): number {
        const face = this.faces.length / 3;
        this.faces.push(a, b, c);
        this.edges.set(a * EDGE_BASE + b, face);
        this.edges.set(b * EDGE_BASE + c, face);
        this.edges.set(c * EDGE_BASE + a, face);
        return face;
    }

    /** Moves each free vertex along its normal, as far as the volume lets it. */
    private advance(): boolean {
        const { positions, faces, states, volume } = this;
        const count = states.length;
        const normals = new Float64Array(count * 3);
        const shortest = new Float64Array(count).fill(Infinity);
        // Sum of the positions of the neighbours of each vertex; each neighbour is met twice, once per face of the edge.
        const around = new Float64Array(count * 3);
        const degree = new Uint32Array(count);

        for (let f = 0; f < faces.length; f += 3) {
            const a = faces[f]!;
            const b = faces[f + 1]!;
            const c = faces[f + 2]!;
            const ax = positions[a * 3]!;
            const ay = positions[a * 3 + 1]!;
            const az = positions[a * 3 + 2]!;
            const abx = positions[b * 3]! - ax;
            const aby = positions[b * 3 + 1]! - ay;
            const abz = positions[b * 3 + 2]! - az;
            const acx = positions[c * 3]! - ax;
            const acy = positions[c * 3 + 1]! - ay;
            const acz = positions[c * 3 + 2]! - az;
            const bcx = acx - abx;
            const bcy = acy - aby;
            const bcz = acz - abz;

            const bx = ax + abx;
            const by = ay + aby;
            const bz = az + abz;
            const cx = ax + acx;
            const cy = ay + acy;
            const cz = az + acz;
            around[a * 3] += bx + cx;
            around[a * 3 + 1] += by + cy;
            around[a * 3 + 2] += bz + cz;
            around[b * 3] += ax + cx;
            around[b * 3 + 1] += ay + cy;
            around[b * 3 + 2] += az + cz;
            around[c * 3] += ax + bx;
            around[c * 3 + 1] += ay + by;
            around[c * 3 + 2] += az + bz;
            degree[a] += 2;
            degree[b] += 2;
            degree[c] += 2;

            const ab = Math.hypot(abx, aby, abz);
            const ac = Math.hypot(acx, acy, acz);
            const bc = Math.hypot(bcx, bcy, bcz);
            if (ab < shortest[a]!) shortest[a] = ab;
            if (ac < shortest[a]!) shortest[a] = ac;
            if (ab < shortest[b]!) shortest[b] = ab;
            if (bc < shortest[b]!) shortest[b] = bc;
            if (ac < shortest[c]!) shortest[c] = ac;
            if (bc < shortest[c]!) shortest[c] = bc;

            const nx = aby * acz - abz * acy;
            const ny = abz * acx - abx * acz;
            const nz = abx * acy - aby * acx;
            const doubleArea = Math.hypot(nx, ny, nz);
            if (!(doubleArea > 0)) continue;
            // The unit normal of the face, weighted by the angle of the face at each corner.
            const angleA = Math.atan2(doubleArea, abx * acx + aby * acy + abz * acz);
            const angleB = Math.atan2(doubleArea, -(abx * bcx + aby * bcy + abz * bcz));
            const angleC = Math.atan2(doubleArea, acx * bcx + acy * bcy + acz * bcz);
            for (const [vertex, angle] of [
                [a, angleA],
                [b, angleB],
                [c, angleC],
            ] as const) {
                const weight = angle / doubleArea;
                normals[vertex * 3] += nx * weight;
                normals[vertex * 3 + 1] += ny * weight;
                normals[vertex * 3 + 2] += nz * weight;
            }
        }

        // Unit normals, and the vertices by cell of a grid of the edge length: what a vertex could run into.
        const cell = this.edgeLength;
        const heads = new Map<number, number>();
        const next = new Int32Array(count);
        for (let v = 0; v < count; v++) {
            const length = Math.hypot(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!);
            if (length > 0) {
                normals[v * 3] /= length;
                normals[v * 3 + 1] /= length;
                normals[v * 3 + 2] /= length;
            }
            const key = cellKey(Math.floor(positions[v * 3]! / cell), Math.floor(positions[v * 3 + 1]! / cell), Math.floor(positions[v * 3 + 2]! / cell));
            next[v] = heads.get(key) ?? -1;
            heads.set(key, v);
        }
        const reach = cell * CONTACT;
        /** Whether a point of the segment between two points stands outside the volume. */
        const rockBetween = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean => {
            for (const t of BETWEEN) if (!volume.contains(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t)) return true;
            return false;
        };
        /** A vertex of another part of the surface, facing a vertex and ahead of it, within reach of where it goes; or -1. */
        const meets = (v: number, qx: number, qy: number, qz: number): number => {
            const nx = normals[v * 3]!;
            const ny = normals[v * 3 + 1]!;
            const nz = normals[v * 3 + 2]!;
            const ix = Math.floor(qx / cell);
            const iy = Math.floor(qy / cell);
            const iz = Math.floor(qz / cell);
            for (let cx = ix - 1; cx <= ix + 1; cx++) {
                for (let cy = iy - 1; cy <= iy + 1; cy++) {
                    for (let cz = iz - 1; cz <= iz + 1; cz++) {
                        for (let w = heads.get(cellKey(cx, cy, cz)) ?? -1; w >= 0; w = next[w]!) {
                            if (w === v) continue;
                            if (normals[w * 3]! * nx + normals[w * 3 + 1]! * ny + normals[w * 3 + 2]! * nz > FACING) continue;
                            const wx = positions[w * 3]!;
                            const wy = positions[w * 3 + 1]!;
                            const wz = positions[w * 3 + 2]!;
                            if ((wx - positions[v * 3]!) * nx + (wy - positions[v * 3 + 1]!) * ny + (wz - positions[v * 3 + 2]!) * nz <= 0) continue;
                            if ((wx - qx) ** 2 + (wy - qy) ** 2 + (wz - qz) ** 2 >= reach * reach) continue;
                            // Two fronts meet only across the volume. With rock between them, as on either side of the
                            // edge where a tunnel opens into a chamber, each goes on to its own wall.
                            if (rockBetween(qx, qy, qz, wx, wy, wz)) continue;
                            return w;
                        }
                    }
                }
            }
            return -1;
        };

        let moved = false;
        for (let v = 0; v < count; v++) {
            if (states[v] !== FREE) continue;
            const nx = normals[v * 3]!;
            const ny = normals[v * 3 + 1]!;
            const nz = normals[v * 3 + 2]!;
            if ((nx === 0 && ny === 0 && nz === 0) || shortest[v]! < this.edgeLength * SQUEEZE) {
                states[v] = FIXED;
                this.squeezed++;
                continue;
            }
            const px = positions[v * 3]!;
            const py = positions[v * 3 + 1]!;
            const pz = positions[v * 3 + 2]!;

            // The move: along the normal, half the shortest edge at most so that a vertex cannot cross its neighbours
            // in one step, and towards the middle of its neighbours, which keeps the surface even as it grows.
            const push = Math.min(this.stepLength, shortest[v]! / 2);
            const dx = nx * push + (around[v * 3]! / degree[v]! - px) * SMOOTHING;
            const dy = ny * push + (around[v * 3 + 1]! / degree[v]! - py) * SMOOTHING;
            const dz = nz * push + (around[v * 3 + 2]! / degree[v]! - pz) * SMOOTHING;
            const distance = Math.hypot(dx, dy, dz);
            if (distance < this.tolerance) {
                // The push and the pull of the neighbours cancel out: the vertex has settled.
                states[v] = FIXED;
                this.settled++;
                continue;
            }
            const met = meets(v, px + dx, py + dy, pz + dz);
            if (met >= 0) {
                // Another front of the surface is coming the other way: both stop short of each other. Where they met
                // is kept: the fusion starts from there.
                states[v] = FIXED;
                this.meetings.push(v, met);
                this.contact++;
                continue;
            }

            let share = 1;
            if (!volume.contains(px + dx, py + dy, pz + dz)) {
                // The move leaves the volume: the vertex goes to the boundary, found by bisection, and stays there.
                let inside = 0;
                while ((share - inside) * distance > this.tolerance) {
                    const middle = (inside + share) / 2;
                    if (volume.contains(px + dx * middle, py + dy * middle, pz + dz * middle)) inside = middle;
                    else share = middle;
                }
                share = inside;
                states[v] = FIXED;
            }
            if (share > 0) {
                positions[v * 3] = px + dx * share;
                positions[v * 3 + 1] = py + dy * share;
                positions[v * 3 + 2] = pz + dz * share;
                moved = true;
            }
        }
        return moved;
    }

    /** Splits the faces that are too large, then flips the edges around them. */
    private refine(): boolean {
        const { positions, faces } = this;
        const queue: number[] = [];
        const count = faces.length;
        let split = false;
        for (let f = 0; f < count && this.states.length < this.maxVertices; f += 3) {
            const a = faces[f]!;
            const b = faces[f + 1]!;
            const c = faces[f + 2]!;
            const ax = positions[a * 3]!;
            const ay = positions[a * 3 + 1]!;
            const az = positions[a * 3 + 2]!;
            const abx = positions[b * 3]! - ax;
            const aby = positions[b * 3 + 1]! - ay;
            const abz = positions[b * 3 + 2]! - az;
            const acx = positions[c * 3]! - ax;
            const acy = positions[c * 3 + 1]! - ay;
            const acz = positions[c * 3 + 2]! - az;
            const nx = aby * acz - abz * acy;
            const ny = abz * acx - abx * acz;
            const nz = abx * acy - aby * acx;
            const doubleArea = Math.hypot(nx, ny, nz);
            if (!(doubleArea > 2 * this.maxArea)) continue;

            const m = this.addCentre(ax + (abx + acx) / 3, ay + (aby + acy) / 3, az + (abz + acz) / 3, nx / doubleArea, ny / doubleArea, nz / doubleArea);
            // The face keeps its edge from a to b; two new faces take the other two edges.
            faces[f + 2] = m;
            this.edges.set(b * EDGE_BASE + m, f / 3);
            this.edges.set(m * EDGE_BASE + a, f / 3);
            this.addFace(b, c, m);
            this.addFace(c, a, m);
            queue.push(a, b, b, c, c, a);
            split = true;
        }
        this.flip(queue);
        return split;
    }

    /** Adds the vertex at the centre of a face. A centre outside the volume is brought back inside and fixed. */
    private addCentre(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
        let state = FREE;
        if (!this.volume.contains(x, y, z)) {
            state = FIXED;
            let back = this.tolerance;
            while (back <= this.edgeLength && !this.volume.contains(x - nx * back, y - ny * back, z - nz * back)) back *= 2;
            if (back <= this.edgeLength) {
                x -= nx * back;
                y -= ny * back;
                z -= nz * back;
            } else {
                this.unresolved++;
            }
        }
        this.positions.push(x, y, z);
        this.states.push(state);
        return this.states.length - 1;
    }

    /** The vertex of a face that is neither of two of its vertices. */
    private third(face: number, a: number, b: number): number {
        const { faces } = this;
        for (let k = 0; k < 3; k++) {
            const vertex = faces[face * 3 + k]!;
            if (vertex !== a && vertex !== b) return vertex;
        }
        return -1;
    }

    /**
     * Flips edges, given as pairs of vertices, while it improves the triangles on both sides: an edge is flipped when
     * the two angles facing it add up to more than a half turn. Each flip puts the four edges around it back in line.
     */
    private flip(queue: number[]): void {
        const { positions, faces, edges } = this;
        // The quads of a surface are not flat, so the flips are not sure to end by themselves.
        let budget = queue.length * 8 + 64;
        while (queue.length > 0 && budget-- > 0) {
            const b = queue.pop()!;
            const a = queue.pop()!;
            const f = edges.get(a * EDGE_BASE + b);
            const g = edges.get(b * EDGE_BASE + a);
            if (f === undefined || g === undefined) continue;
            const m = this.third(f, a, b);
            const n = this.third(g, a, b);
            if (m === n || edges.has(m * EDGE_BASE + n) || edges.has(n * EDGE_BASE + m)) continue;

            const ax = positions[a * 3]!;
            const ay = positions[a * 3 + 1]!;
            const az = positions[a * 3 + 2]!;
            const bx = positions[b * 3]!;
            const by = positions[b * 3 + 1]!;
            const bz = positions[b * 3 + 2]!;
            const mx = positions[m * 3]!;
            const my = positions[m * 3 + 1]!;
            const mz = positions[m * 3 + 2]!;
            const nx = positions[n * 3]!;
            const ny = positions[n * 3 + 1]!;
            const nz = positions[n * 3 + 2]!;

            // Normals of the two faces now, (a, b, m) and (b, a, n), then their cotangents at m and n.
            const fx = (by - ay) * (mz - az) - (bz - az) * (my - ay);
            const fy = (bz - az) * (mx - ax) - (bx - ax) * (mz - az);
            const fz = (bx - ax) * (my - ay) - (by - ay) * (mx - ax);
            const gx = (ay - by) * (nz - bz) - (az - bz) * (ny - by);
            const gy = (az - bz) * (nx - bx) - (ax - bx) * (nz - bz);
            const gz = (ax - bx) * (ny - by) - (ay - by) * (nx - bx);
            const areaF = Math.hypot(fx, fy, fz);
            const areaG = Math.hypot(gx, gy, gz);
            if (!(areaF > 0) || !(areaG > 0)) continue;
            const cotM = ((ax - mx) * (bx - mx) + (ay - my) * (by - my) + (az - mz) * (bz - mz)) / areaF;
            const cotN = ((ax - nx) * (bx - nx) + (ay - ny) * (by - ny) + (az - nz) * (bz - nz)) / areaG;
            if (!(cotM + cotN < FLIP_THRESHOLD)) continue;

            // The faces after the flip, (a, n, m) and (n, b, m), must look the same way as the faces now.
            const sx = fx + gx;
            const sy = fy + gy;
            const sz = fz + gz;
            const ux = (ny - ay) * (mz - az) - (nz - az) * (my - ay);
            const uy = (nz - az) * (mx - ax) - (nx - ax) * (mz - az);
            const uz = (nx - ax) * (my - ay) - (ny - ay) * (mx - ax);
            const vx = (by - ny) * (mz - nz) - (bz - nz) * (my - ny);
            const vy = (bz - nz) * (mx - nx) - (bx - nx) * (mz - nz);
            const vz = (bx - nx) * (my - ny) - (by - ny) * (mx - nx);
            if (!(ux * sx + uy * sy + uz * sz > 0) || !(vx * sx + vy * sy + vz * sz > 0)) continue;

            faces[f * 3] = a;
            faces[f * 3 + 1] = n;
            faces[f * 3 + 2] = m;
            faces[g * 3] = n;
            faces[g * 3 + 1] = b;
            faces[g * 3 + 2] = m;
            edges.delete(a * EDGE_BASE + b);
            edges.delete(b * EDGE_BASE + a);
            edges.set(a * EDGE_BASE + n, f);
            edges.set(n * EDGE_BASE + m, f);
            edges.set(m * EDGE_BASE + a, f);
            edges.set(n * EDGE_BASE + b, g);
            edges.set(b * EDGE_BASE + m, g);
            edges.set(m * EDGE_BASE + n, g);
            queue.push(a, n, n, b, b, m, m, a);
        }
    }
}

/** Grows a surface from a sphere until a volume stops it: see {@link GrownSurface}. */
export function growSurface(volume: IVolume, options: IGrownSurfaceOptions): { mesh: IGrownSurfaceMesh; report: IGrowthReport } {
    const surface = new GrownSurface(volume, options);
    surface.grow();
    // The mesh first: it fuses the fronts, which the report then tells.
    const mesh = surface.mesh();
    return { mesh, report: surface.report() };
}
