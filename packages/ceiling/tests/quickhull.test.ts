import { describe, expect, it } from "vitest";

import { QuickHull, convexHull, type IConvexHull, type IPoint3 } from "../src";

/** A repeatable generator of numbers in [0, 1): mulberry32. */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function corner(hull: IConvexHull, index: number): IPoint3 {
    return hull.vertices[hull.indices[index]!]!;
}

/** Volume enclosed by the triangles, positive when they are wound outwards. */
function volume(hull: IConvexHull): number {
    let six = 0;
    for (let i = 0; i < hull.indices.length; i += 3) {
        const a = corner(hull, i);
        const b = corner(hull, i + 1);
        const c = corner(hull, i + 2);
        six += a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x);
    }
    return six / 6;
}

/** Checks that a hull is a closed surface, wound outwards, with unit normals, and that it holds every point. */
function expectHullOf(hull: IConvexHull, points: readonly IPoint3[], tolerance: number): void {
    expect(hull.indices.length % 3).toBe(0);
    expect(hull.normals.length).toBe(hull.indices.length / 3);
    expect(new Set(hull.vertices).size).toBe(hull.vertices.length);
    for (const vertex of hull.vertices) expect(points).toContain(vertex);

    // Closed and consistently wound: each directed edge appears once, with its reverse.
    const edges = new Set<string>();
    for (let i = 0; i < hull.indices.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const edge = `${hull.indices[i + k]}>${hull.indices[i + ((k + 1) % 3)]}`;
            expect(edges.has(edge)).toBe(false);
            edges.add(edge);
        }
    }
    for (const edge of edges) expect(edges.has(edge.split(">").reverse().join(">"))).toBe(true);
    // Euler characteristic of a sphere.
    expect(hull.vertices.length - edges.size / 2 + hull.indices.length / 3).toBe(2);

    for (let face = 0; face < hull.normals.length; face++) {
        const normal = hull.normals[face]!;
        expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 9);
        const origin = corner(hull, face * 3);
        let outermost = -Infinity;
        for (const point of points) {
            outermost = Math.max(outermost, normal.x * (point.x - origin.x) + normal.y * (point.y - origin.y) + normal.z * (point.z - origin.z));
        }
        expect(outermost).toBeLessThanOrEqual(tolerance);
    }
    expect(volume(hull)).toBeGreaterThan(0);
}

describe("QuickHull", () => {
    it("gives a tetrahedron its four faces, whatever the side of the fourth point", () => {
        for (const z of [1, -1]) {
            const points = [
                { x: 0, y: 0, z: 0 },
                { x: 1, y: 0, z: 0 },
                { x: 0, y: 1, z: 0 },
                { x: 0, y: 0, z },
            ];
            const hull = convexHull(points)!;
            expect(hull.vertices).toHaveLength(4);
            expect(hull.indices).toHaveLength(12);
            expectHullOf(hull, points, 1e-9);
            expect(volume(hull)).toBeCloseTo(1 / 6, 12);
        }
    });

    it("keeps the eight corners of a cube filled with points on its faces and inside", () => {
        const points: IPoint3[] = [];
        for (let x = 0; x <= 4; x++) for (let y = 0; y <= 4; y++) for (let z = 0; z <= 4; z++) points.push({ x: x * 2.5, y: y * 2.5, z: z * 2.5 });
        const hull = convexHull(points)!;

        expectHullOf(hull, points, 1e-5);
        expect(volume(hull)).toBeCloseTo(1000, 6);
        for (const vertex of hull.vertices) for (const value of [vertex.x, vertex.y, vertex.z]) expect([0, 10]).toContain(value);
        expect(hull.vertices).toHaveLength(8);
        expect(hull.indices).toHaveLength(36);
    });

    it("holds every point of random clouds, far from the origin too", () => {
        for (const [seed, offset] of [
            [1, 0],
            [2, 0],
            [3, 500000],
        ] as const) {
            const next = random(seed);
            const points: IPoint3[] = [];
            for (let i = 0; i < 600; i++) points.push({ x: offset + next() * 2000, y: offset + next() * 800, z: -next() * 300 });
            const hull = convexHull(points)!;
            expectHullOf(hull, points, 2000 * 1e-6);
        }
    });

    it("holds the points of a sphere, which are all corners", () => {
        const next = random(7);
        const points: IPoint3[] = [];
        for (let i = 0; i < 400; i++) {
            const z = next() * 2 - 1;
            const angle = next() * 2 * Math.PI;
            const radius = Math.sqrt(1 - z * z);
            points.push({ x: 50 * radius * Math.cos(angle), y: 50 * radius * Math.sin(angle), z: 50 * z });
        }
        const hull = convexHull(points)!;
        expectHullOf(hull, points, 1e-4);
        expect(hull.vertices).toHaveLength(400);
    });

    it("ignores duplicated points", () => {
        const next = random(11);
        const base: IPoint3[] = [];
        for (let i = 0; i < 50; i++) base.push({ x: next() * 10, y: next() * 10, z: next() * 10 });
        const points = [...base, ...base.map((point) => ({ ...point })), ...base.map((point) => ({ ...point }))];
        const hull = convexHull(points)!;
        expectHullOf(hull, points, 1e-5);
        expect(volume(hull)).toBeCloseTo(volume(convexHull(base)!), 9);
    });

    it("returns no hull for a set without volume", () => {
        const next = random(5);
        const flat: IPoint3[] = [];
        for (let i = 0; i < 5000; i++) flat.push({ x: next() * 1000, y: next() * 1000, z: -120 });
        const line = [0, 1, 2, 3, 4].map((i) => ({ x: i, y: 2 * i, z: -3 * i }));
        const same = [0, 1, 2, 3].map(() => ({ x: 4, y: 5, z: 6 }));

        expect(convexHull(flat)).toBeUndefined();
        expect(convexHull(line)).toBeUndefined();
        expect(convexHull(same)).toBeUndefined();
        expect(convexHull(line.slice(0, 3))).toBeUndefined();
        expect(convexHull([])).toBeUndefined();
    });

    it("takes a tolerance, which decides when a thin set is flat", () => {
        const points = [
            { x: 0, y: 0, z: 0 },
            { x: 100, y: 0, z: 0 },
            { x: 0, y: 100, z: 0 },
            { x: 100, y: 100, z: 0 },
            { x: 50, y: 50, z: 0.01 },
        ];
        expect(convexHull(points)).toBeDefined();
        expect(convexHull(points, { epsilon: 0.1 })).toBeUndefined();
    });

    it("can be used again after a hull or a failure", () => {
        const builder = new QuickHull();
        const points = [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 1, y: 1, z: 1 },
        ];
        const first = builder.generateHull(points)!;
        expect(builder.generateHull(points.slice(0, 3))).toBeUndefined();
        const second = builder.generateHull(points)!;
        expect(second.indices).toEqual(first.indices);
        expectHullOf(second, points, 1e-9);
    });
});
