import { describe, expect, it } from "vitest";

import { buildRockFace, convexHull, createRockField, createUnderSurfaceVolume, growChamber, type IRockFace, type IRockFaceInput } from "../src";

/** An octahedron of a radius around a centre, wound outwards. */
function octahedron(radius: number, centre: [number, number, number] = [0, 0, 0]): IRockFaceInput {
    const [cx, cy, cz] = centre;
    return {
        positions: [cx + radius, cy, cz, cx - radius, cy, cz, cx, cy + radius, cz, cx, cy - radius, cz, cx, cy, cz + radius, cx, cy, cz - radius],
        indices: [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5],
    };
}

/** A convex solid by its corners, wound outwards. */
function solid(corners: [number, number, number][]): IRockFaceInput {
    const hull = convexHull(corners.map(([x, y, z]) => ({ x, y, z })))!;
    return { positions: hull.vertices.flatMap((point) => [point.x, point.y, point.z]), indices: hull.indices };
}

/** Each edge of a closed surface is met twice, once in each direction, and it has the topology of a sphere. */
function expectClosed(face: IRockFace): void {
    const edges = new Map<string, number>();
    for (let at = 0; at < face.indices.length; at += 3)
        for (let k = 0; k < 3; k++) {
            const key = `${face.indices[at + k]}-${face.indices[at + ((k + 1) % 3)]}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
        }
    for (const [key, count] of edges) {
        expect(count).toBe(1);
        const [a, b] = key.split("-");
        expect(edges.get(`${b}-${a}`)).toBe(1);
    }
    expect(face.indices.length / 3).toBe(2 * (face.positions.length / 3) - 4);
}

function longest(face: { positions: ArrayLike<number>; indices: ArrayLike<number> }): number {
    let best = 0;
    for (let at = 0; at < face.indices.length; at++) {
        const a = face.indices[at]!,
            b = face.indices[at % 3 === 2 ? at - 2 : at + 1]!;
        best = Math.max(
            best,
            Math.hypot(
                face.positions[a * 3]! - face.positions[b * 3]!,
                face.positions[a * 3 + 1]! - face.positions[b * 3 + 1]!,
                face.positions[a * 3 + 2]! - face.positions[b * 3 + 2]!
            )
        );
    }
    return best;
}

describe("buildRockFace", () => {
    it("refines a closed mesh to the edge length and keeps it closed", () => {
        const input = octahedron(100);
        const face = buildRockFace(input, { edgeLength: 10, maxDisplacement: 0 });
        expect(face.report.refinements).toBe(4);
        expect(face.report.triangles).toBe(8 * 4 ** 4);
        expect(longest({ positions: Array.from(buildRockFace(input, { edgeLength: 10, maxDisplacement: 0 }).positions), indices: face.indices })).toBeLessThanOrEqual(10);
        expectClosed(face);
        // No displacement asked: the refined mesh lies on the input.
        expect(face.report.displacement).toEqual({ min: 0, max: 0, mean: 0 });
    });

    it("splits only the edges that are too long", () => {
        // An octahedron stretched three times along x: its edges to the two tips on x are long, the others not.
        const input = octahedron(100);
        const positions = Array.from(input.positions, (value, at) => (at % 3 === 0 ? value * 3 : value));
        const face = buildRockFace({ positions, indices: input.indices }, { edgeLength: 200, maxDisplacement: 0 });
        expect(face.report.refinements).toBe(1);
        // The eight edges to the tips are split, the four round the middle are not: each face in three, not in four.
        expect(face.report.triangles).toBe(8 * 3);
        expect(longest(face)).toBeLessThanOrEqual(200);
        expectClosed(face);
    });

    it("moves each vertex along its normal into the rock, never further than the limit", () => {
        const radius = 300;
        const flat = buildRockFace(octahedron(radius), { edgeLength: 20, maxDisplacement: 0 });
        const face = buildRockFace(octahedron(radius), { edgeLength: 20, maxDisplacement: 6, scale: 0.4 });
        expectClosed(face);
        let outwards = 0,
            inwards = 0;
        for (let v = 0; v < face.displacement.length; v++) {
            const d = face.displacement[v]!;
            expect(Math.abs(d)).toBeLessThanOrEqual(6);
            const move = [0, 1, 2].map((axis) => face.positions[v * 3 + axis]! - flat.positions[v * 3 + axis]!);
            expect(Math.hypot(...move)).toBeCloseTo(Math.abs(d), 9);
            // The octahedron is wound outwards and the rock is outside: a positive move goes away from the centre.
            const centre = [0, 1, 2].map((axis) => flat.positions[v * 3 + axis]!);
            const along = move[0]! * centre[0]! + move[1]! * centre[1]! + move[2]! * centre[2]!;
            if (Math.abs(d) > 1e-6) expect(Math.sign(along)).toBe(Math.sign(d));
            if (d > 0.5) outwards++;
            if (d < -0.5) inwards++;
        }
        // The rock stands back in places and forward in others.
        expect(outwards).toBeGreaterThan(0);
        expect(inwards).toBeGreaterThan(0);
        expect(face.report.displacement.max).toBeLessThanOrEqual(6);
    });

    it("moves the other way when the rock is on the side the winding faces away from", () => {
        const options = { edgeLength: 25, maxDisplacement: 5, scale: 0.4 };
        const a = buildRockFace(octahedron(200), options);
        const b = buildRockFace(octahedron(200), { ...options, towardsRock: -1 });
        const flat = buildRockFace(octahedron(200), { ...options, maxDisplacement: 0 });
        let opposed = 0;
        for (let v = 0; v < a.displacement.length; v++) {
            const ra = Math.hypot(a.positions[v * 3]!, a.positions[v * 3 + 1]!, a.positions[v * 3 + 2]!);
            const rb = Math.hypot(b.positions[v * 3]!, b.positions[v * 3 + 1]!, b.positions[v * 3 + 2]!);
            const r0 = Math.hypot(flat.positions[v * 3]!, flat.positions[v * 3 + 1]!, flat.positions[v * 3 + 2]!);
            if (Math.abs(a.displacement[v]!) > 0.5 && Math.abs(b.displacement[v]!) > 0.5 && Math.sign(ra - r0) !== Math.sign(rb - r0)) opposed++;
        }
        expect(opposed).toBeGreaterThan(a.displacement.length / 4);
    });

    it("gives the same face for the same mesh and options", () => {
        const options = { edgeLength: 30, maxDisplacement: 8, scale: 0.5, origin: [10, 20, 30] as const };
        const a = buildRockFace(octahedron(250, [100, -50, -200]), options);
        const b = buildRockFace(octahedron(250, [100, -50, -200]), options);
        expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
        expect(a.detailWavelength).toBe(75);
    });

    it("reads the field with the up axis of the mesh", () => {
        // The same octahedron in (east, north, up) and in (east, up, south) gets the same moves.
        const z = octahedron(150);
        const y: IRockFaceInput = { positions: Array.from(z.positions).map((_, at, p) => (at % 3 === 0 ? p[at]! : at % 3 === 1 ? p[at + 1]! : -p[at - 1]!)), indices: z.indices };
        // (east, north, up) to (east, up, south) is a rotation: the winding still faces outwards.
        const options = { edgeLength: 25, maxDisplacement: 6, scale: 0.3 };
        const a = buildRockFace(z, options);
        const b = buildRockFace(y, { ...options, up: "y" });
        expect(Array.from(b.displacement).map((d) => d.toFixed(9))).toEqual(Array.from(a.displacement).map((d) => d.toFixed(9)));
    });

    it("keeps the face within the volume it is given", () => {
        // Nothing over 20 m: the top of the octahedron, at 100, already stands outside and does not move; the rest
        // never rises over 20.
        const under = createUnderSurfaceVolume(() => 20);
        const flat = buildRockFace(octahedron(100), { edgeLength: 12, maxDisplacement: 0 });
        const free = buildRockFace(octahedron(100), { edgeLength: 12, maxDisplacement: 10, scale: 0.3 });
        const held = buildRockFace(octahedron(100), { edgeLength: 12, maxDisplacement: 10, scale: 0.3, within: under });
        let crossedFree = 0;
        for (let v = 0; v < held.displacement.length; v++) {
            const z0 = flat.positions[v * 3 + 2]!,
                z = held.positions[v * 3 + 2]!;
            if (z0 > 20) expect(held.displacement[v]).toBe(0);
            else expect(z).toBeLessThanOrEqual(20 + 1e-9);
            if (z0 <= 20 && free.positions[v * 3 + 2]! > 20) crossedFree++;
            expect(Math.abs(held.displacement[v]!)).toBeLessThanOrEqual(Math.abs(free.displacement[v]!) + 1e-12);
        }
        expect(crossedFree).toBeGreaterThan(0);
    });

    it("stops the walls of a thin void, and the faces of a thin slab of rock, short of each other", () => {
        // 40 m by 40 m and 1 m thick: a void in the rock, then a slab of rock in a void.
        const corners: [number, number, number][] = [];
        for (const x of [-20, 20]) for (const y of [-20, 20]) for (const z of [-0.5, 0.5]) corners.push([x, y, z]);
        // The field stands back into the rock round the origin and comes forward round (-40, 400): each case is read
        // where the field moves the faces towards each other.
        const cases = [
            { towardsRock: 1, origin: [40, -400, 0] },
            { towardsRock: -1, origin: [0, 0, 0] },
        ] as const;
        for (const { towardsRock, origin } of cases) {
            const options = { edgeLength: 2, scale: 0.1, towardsRock, origin };
            const flat = buildRockFace(solid(corners), { ...options, maxDisplacement: 0 });
            const face = buildRockFace(solid(corners), { ...options, maxDisplacement: 2 });
            expectClosed(face);
            expect(face.report.limited).toBeGreaterThan(0);
            let inwards = 0;
            for (let v = 0; v < face.positions.length / 3; v++) {
                const was = flat.positions[v * 3 + 2]!,
                    is = face.positions[v * 3 + 2]!;
                if (Math.abs(was) !== 0.5) continue;
                // Each face keeps its side of the middle. The room is half the thickness, and a move takes 0.4 of it.
                expect(Math.sign(is)).toBe(Math.sign(was));
                expect(Math.abs(is)).toBeGreaterThanOrEqual(0.5 - 0.2 - 1e-9);
                if (Math.abs(is) < 0.45) inwards++;
            }
            // Without the limit these would have gone through the other face: the field asks for up to 2 m.
            expect(inwards).toBeGreaterThan(0);
        }
    });

    it("turns no face over at the ridge of a wedge of rock", () => {
        // A wedge of rock in a void, 30 m long, whose two faces meet at 15 degrees along the y axis.
        const half = 20 * Math.tan((7.5 * Math.PI) / 180);
        const corners: [number, number, number][] = [
            [0, 0, 0],
            [0, 30, 0],
            [20, 0, half],
            [20, 30, half],
            [20, 0, -half],
            [20, 30, -half],
        ];
        const options = { edgeLength: 1.5, scale: 0.1, towardsRock: -1 as const };
        const flat = buildRockFace(solid(corners), { ...options, maxDisplacement: 0 });
        const face = buildRockFace(solid(corners), { ...options, maxDisplacement: 2 });
        expectClosed(face);
        expect(face.report.limited).toBeGreaterThan(0);
        const normal = (positions: ArrayLike<number>, at: number): number[] => {
            const [a, b, c] = [face.indices[at]! * 3, face.indices[at + 1]! * 3, face.indices[at + 2]! * 3];
            const u = [0, 1, 2].map((axis) => positions[b + axis]! - positions[a + axis]!);
            const w = [0, 1, 2].map((axis) => positions[c + axis]! - positions[a + axis]!);
            return [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
        };
        for (let at = 0; at < face.indices.length; at += 3) {
            const was = normal(flat.positions, at),
                is = normal(face.positions, at);
            expect(was[0]! * is[0]! + was[1]! * is[1]! + was[2]! * is[2]!).toBeGreaterThan(0);
        }
        // The two faces of the wedge do not pass each other: each vertex stays on its side of the middle.
        for (let v = 0; v < face.positions.length / 3; v++) {
            const was = flat.positions[v * 3 + 2]!;
            if (Math.abs(was) > 1e-9) expect(face.positions[v * 3 + 2]! * Math.sign(was)).toBeGreaterThan(0);
        }
    });

    it("refuses what it cannot do", () => {
        expect(() => buildRockFace(octahedron(100), { edgeLength: 0, maxDisplacement: 1 })).toThrow(RangeError);
        expect(() => buildRockFace(octahedron(100), { edgeLength: 1, maxDisplacement: -1 })).toThrow(RangeError);
        expect(() => buildRockFace({ positions: [0, 0, 0], indices: [0, 0] }, { edgeLength: 1, maxDisplacement: 1 })).toThrow(RangeError);
        expect(() => buildRockFace(octahedron(1000), { edgeLength: 1, maxDisplacement: 1, maxFaces: 10000 })).toThrow(RangeError);
    });

    it("dresses a chamber grown by growChamber", () => {
        const { mesh } = growChamber({
            settings: { depth: 40, minDepth: 5, clearance: 10, attraction: 1, edgeLength: 12 },
            objects: [{ points: [0, 160].flatMap((x) => [0, 90].flatMap((y) => [120, 190].map((z) => ({ x, y, z })))) }],
            reference: () => 300,
        });
        const face = buildRockFace(mesh, { edgeLength: 6, maxDisplacement: 4, scale: 0.1 });
        expectClosed(face);
        expect(face.report.refinements).toBeGreaterThanOrEqual(1);
        expect(Math.max(...Array.from(face.displacement, Math.abs))).toBeLessThanOrEqual(4);
        expect(face.report.displacement.max - face.report.displacement.min).toBeGreaterThan(1);
    });
});

describe("createRockField", () => {
    it("is the same field at every scale: scale * field(p / scale)", () => {
        const one = createRockField({ scale: 1 }),
            quarter = createRockField({ scale: 0.25 });
        for (const [x, y, z] of [
            [10, 20, 30],
            [-400, 250, 1200],
            [1777, -3, 401],
        ] as const)
            expect(quarter(x * 0.25, y * 0.25, z * 0.25)).toBeCloseTo(0.25 * one(x, y, z), 9);
    });

    it("leaves out the relief under the shortest wavelength asked for", () => {
        const full = createRockField(),
            smooth = createRockField({ minWavelength: 120 });
        // Mean change over 4 m: the short octaves and the fissures make most of it.
        let fullChange = 0,
            smoothChange = 0;
        for (let i = 0; i < 400; i++) {
            const x = (i * 37.3) % 1500,
                y = (i * 11.9) % 500,
                z = (i * 71.1) % 1500;
            fullChange += Math.abs(full(x + 4, y, z) - full(x, y, z));
            smoothChange += Math.abs(smooth(x + 4, y, z) - smooth(x, y, z));
        }
        expect(smoothChange).toBeLessThan(fullChange / 2);
    });

    it("refuses a scale that is not positive", () => {
        expect(() => createRockField({ scale: 0 })).toThrow(RangeError);
    });
});
