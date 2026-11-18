import { describe, expect, it } from "vitest";

import {
    GrownSurface,
    convexHull,
    createBoxVolume,
    createHullVolume,
    createPathVolume,
    createSphereVolume,
    createUnderSurfaceVolume,
    growSurface,
    intersectVolumes,
    uniteVolumes,
    type IGrownSurfaceMesh,
    type IPoint3,
    type IVolume,
} from "../src";

/** Volume enclosed by a mesh, positive when it is wound outwards. */
function volumeOf(mesh: IGrownSurfaceMesh): number {
    const { positions, indices } = mesh;
    let six = 0;
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i]! * 3;
        const b = indices[i + 1]! * 3;
        const c = indices[i + 2]! * 3;
        six +=
            positions[a]! * (positions[b + 1]! * positions[c + 2]! - positions[b + 2]! * positions[c + 1]!) +
            positions[a + 1]! * (positions[b + 2]! * positions[c]! - positions[b]! * positions[c + 2]!) +
            positions[a + 2]! * (positions[b]! * positions[c + 1]! - positions[b + 1]! * positions[c]!);
    }
    return six / 6;
}

/** Checks that a mesh is one closed surface of the topology of a sphere, each edge shared by two faces wound alike. */
function expectClosed(mesh: IGrownSurfaceMesh): void {
    const { indices } = mesh;
    const vertices = mesh.positions.length / 3;
    const edges = new Set<number>();
    let repeated = 0;
    for (let i = 0; i < indices.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const edge = indices[i + k]! * vertices + indices[i + ((k + 1) % 3)]!;
            if (edges.has(edge)) repeated++;
            edges.add(edge);
        }
    }
    let unpaired = 0;
    for (const edge of edges) if (!edges.has((edge % vertices) * vertices + Math.floor(edge / vertices))) unpaired++;
    expect(repeated).toBe(0);
    expect(unpaired).toBe(0);
    expect(vertices - edges.size / 2 + indices.length / 3).toBe(2);
}

/** Longest edge, and smallest angle of a face in degrees. */
function quality(mesh: IGrownSurfaceMesh): { longest: number; smallestAngle: number } {
    const { positions, indices } = mesh;
    let longest = 0;
    let smallestAngle = 180;
    for (let i = 0; i < indices.length; i += 3) {
        const corners = [0, 1, 2].map((k) => indices[i + k]! * 3);
        const lengths = [0, 1, 2].map((k) => {
            const a = corners[k]!;
            const b = corners[(k + 1) % 3]!;
            return Math.hypot(positions[a]! - positions[b]!, positions[a + 1]! - positions[b + 1]!, positions[a + 2]! - positions[b + 2]!);
        });
        longest = Math.max(longest, ...lengths);
        for (let k = 0; k < 3; k++) {
            const opposite = lengths[k]!;
            const p = lengths[(k + 1) % 3]!;
            const q = lengths[(k + 2) % 3]!;
            smallestAngle = Math.min(smallestAngle, (Math.acos(Math.min(1, Math.max(-1, (p * p + q * q - opposite * opposite) / (2 * p * q)))) * 180) / Math.PI);
        }
    }
    return { longest, smallestAngle };
}

/** Checks that every vertex of a mesh is inside a volume. */
function expectInside(mesh: IGrownSurfaceMesh, volume: IVolume): void {
    let outside = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) if (!volume.contains(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!)) outside++;
    expect(outside).toBe(0);
}

const ORIGIN = { x: 0, y: 0, z: 0 };

describe("GrownSurface", () => {
    it("starts as a small sphere around the seed", () => {
        const surface = new GrownSurface(createSphereVolume(ORIGIN, 100), { seed: { x: 20, y: -10, z: 5 }, edgeLength: 10 });
        const mesh = surface.mesh();

        expect(surface.report()).toEqual({ steps: 0, vertices: 12, faces: 20, free: 12, squeezed: 0, settled: 0, contact: 0, unresolved: 0, complete: false });
        expectClosed(mesh);
        expect(volumeOf(mesh)).toBeGreaterThan(0);
        for (let i = 0; i < 36; i += 3) expect(Math.hypot(mesh.positions[i]! - 20, mesh.positions[i + 1]! + 10, mesh.positions[i + 2]! - 5)).toBeCloseTo(5, 9);
    });

    it("fills a ball from a seed off its centre, every vertex on the boundary", () => {
        const volume = createSphereVolume(ORIGIN, 100);
        const { mesh, report } = growSurface(volume, { seed: { x: 20, y: -10, z: 5 }, edgeLength: 10 });

        expect(report).toMatchObject({ complete: true, free: 0, squeezed: 0, unresolved: 0 });
        expectClosed(mesh);
        expectInside(mesh, volume);
        let nearest = Infinity;
        for (let i = 0; i < mesh.positions.length; i += 3) nearest = Math.min(nearest, Math.hypot(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!));
        expect(nearest).toBeGreaterThan(99.5);
        expect(mesh.fixed.every((state) => state === 1)).toBe(true);

        const exact = (4 / 3) * Math.PI * 1e6;
        expect(volumeOf(mesh)).toBeLessThan(exact);
        expect(volumeOf(mesh)).toBeGreaterThan(exact * 0.99);
        const { longest, smallestAngle } = quality(mesh);
        expect(longest).toBeLessThan(15);
        expect(smallestAngle).toBeGreaterThan(15);
    });

    it("fills a box up to its walls", () => {
        const volume = createBoxVolume(ORIGIN, { x: 200, y: 120, z: 80 });
        const { mesh, report } = growSurface(volume, { seed: { x: 60, y: 60, z: 40 }, edgeLength: 10 });

        expect(report).toMatchObject({ complete: true, free: 0, unresolved: 0 });
        expectClosed(mesh);
        expectInside(mesh, volume);
        expect(volumeOf(mesh)).toBeGreaterThan(200 * 120 * 80 * 0.98);
        for (const [axis, size] of [
            [0, 200],
            [1, 120],
            [2, 80],
        ] as const) {
            let low = Infinity;
            let high = -Infinity;
            for (let i = axis; i < mesh.positions.length; i += 3) {
                low = Math.min(low, mesh.positions[i]!);
                high = Math.max(high, mesh.positions[i]!);
            }
            expect(low).toBeLessThan(0.2);
            expect(high).toBeGreaterThan(size - 0.2);
        }
    });

    it("fills a volume that is not convex", () => {
        const volume = uniteVolumes([createSphereVolume(ORIGIN, 60), createSphereVolume({ x: 90, y: 0, z: 0 }, 60)]);
        const { mesh, report } = growSurface(volume, { seed: ORIGIN, edgeLength: 10 });

        // Two balls of radius 60, 90 apart: twice a ball less the lens they share.
        const exact = 2 * (4 / 3) * Math.PI * 60 ** 3 - (Math.PI * (4 * 60 + 90) * (2 * 60 - 90) ** 2) / 12;
        expect(report).toMatchObject({ complete: true, free: 0, unresolved: 0 });
        expectClosed(mesh);
        expectInside(mesh, volume);
        expect(volumeOf(mesh)).toBeLessThan(exact);
        expect(volumeOf(mesh)).toBeGreaterThan(exact * 0.985);
    });

    it("turns a corner into a part of the volume its seed does not see", () => {
        // An L: the seed is at the end of one arm, the other arm is behind the corner.
        const volume = uniteVolumes([createBoxVolume(ORIGIN, { x: 200, y: 60, z: 60 }), createBoxVolume({ x: 140, y: 0, z: 0 }, { x: 200, y: 200, z: 60 })]);
        const { mesh, report } = growSurface(volume, { seed: { x: 30, y: 30, z: 30 }, edgeLength: 10 });

        expect(report).toMatchObject({ complete: true, free: 0, unresolved: 0 });
        expectClosed(mesh);
        expectInside(mesh, volume);
        expect(volumeOf(mesh)).toBeGreaterThan((200 * 60 * 60 + 60 * 140 * 60) * 0.97);
        let farthest = 0;
        for (let i = 1; i < mesh.positions.length; i += 3) farthest = Math.max(farthest, mesh.positions[i]!);
        expect(farthest).toBeGreaterThan(199.8);
    });

    it("follows the relief of a ceiling", () => {
        const ceiling = (x: number, y: number): number => -40 + 15 * Math.sin(x / 40) + 10 * Math.cos(y / 30);
        const volume = intersectVolumes([createBoxVolume({ x: -150, y: -100, z: -200 }, { x: 150, y: 100, z: 100 }), createUnderSurfaceVolume(ceiling)]);
        const { mesh, report } = growSurface(volume, { seed: { x: 0, y: 0, z: -120 }, edgeLength: 10 });

        expect(report).toMatchObject({ complete: true, free: 0, unresolved: 0 });
        expectClosed(mesh);
        expectInside(mesh, volume);
        // The vertices of the top, away from the walls, are on the ceiling.
        let top = 0;
        let off = 0;
        for (let i = 0; i < mesh.positions.length; i += 3) {
            const x = mesh.positions[i]!;
            const y = mesh.positions[i + 1]!;
            const z = mesh.positions[i + 2]!;
            if (Math.abs(x) > 140 || Math.abs(y) > 90 || z < -75) continue;
            top++;
            if (ceiling(x, y) - z > 0.25) off++;
        }
        expect(top).toBeGreaterThan(500);
        expect(off).toBe(0);
    });

    it("grows by stages that keep their vertices: a fixed vertex never moves again", () => {
        const surface = new GrownSurface(createBoxVolume(ORIGIN, { x: 200, y: 120, z: 80 }), { seed: { x: 60, y: 60, z: 40 }, edgeLength: 10 });
        for (let i = 0; i < 40; i++) surface.step();
        const stage = surface.mesh();
        expect(stage.fixed.some((state) => state === 1)).toBe(true);
        expect(stage.fixed.some((state) => state === 0)).toBe(true);
        expectClosed(stage);

        const report = surface.grow();
        const end = surface.mesh();
        expect(report.complete).toBe(true);
        expect(end.positions.length).toBeGreaterThan(stage.positions.length);
        let displaced = 0;
        for (let v = 0; v < stage.fixed.length; v++) {
            if (stage.fixed[v] !== 1) continue;
            for (let k = 0; k < 3; k++) if (end.positions[v * 3 + k] !== stage.positions[v * 3 + k]) displaced++;
            if (end.fixed[v] !== 1) displaced++;
        }
        expect(displaced).toBe(0);
        expect(surface.step()).toBe(false);
        expect(surface.grow()).toEqual(report);
    });

    it("gives the same surface for the same volume and options, and a finer one for shorter edges", () => {
        const volume = createSphereVolume(ORIGIN, 60);
        const first = growSurface(volume, { seed: { x: 5, y: 5, z: 5 }, edgeLength: 10 });
        const second = growSurface(volume, { seed: { x: 5, y: 5, z: 5 }, edgeLength: 10 });
        const finer = growSurface(volume, { seed: { x: 5, y: 5, z: 5 }, edgeLength: 5 });

        expect(second.mesh.positions).toEqual(first.mesh.positions);
        expect(second.mesh.indices).toEqual(first.mesh.indices);
        const ratio = finer.report.faces / first.report.faces;
        expect(ratio).toBeGreaterThan(3);
        expect(ratio).toBeLessThan(5.5);
        expect(volumeOf(finer.mesh)).toBeGreaterThan(volumeOf(first.mesh));
    });

    it("stops at its limits and says the growth is not complete", () => {
        const volume = createSphereVolume(ORIGIN, 100);
        const capped = growSurface(volume, { seed: ORIGIN, edgeLength: 10, maxVertices: 200 });
        expect(capped.report.vertices).toBeLessThanOrEqual(200);
        expect(capped.report.complete).toBe(true);
        expectClosed(capped.mesh);

        const short = growSurface(volume, { seed: ORIGIN, edgeLength: 10, maxSteps: 5 });
        expect(short.report).toMatchObject({ steps: 5, complete: false });
        expect(short.report.free).toBeGreaterThan(0);
    });

    it("stops its two fronts short of each other round a pillar, and ends", () => {
        // A slab with a pillar through it: a ring, which a surface of the topology of a sphere cannot fill whole.
        const slab = createBoxVolume(ORIGIN, { x: 200, y: 200, z: 40 });
        const pillar = createBoxVolume({ x: 60, y: 60, z: -1 }, { x: 140, y: 140, z: 41 });
        const volume: IVolume = { contains: (x, y, z) => slab.contains(x, y, z) && !pillar.contains(x, y, z) };
        const { mesh, report } = growSurface(volume, { seed: { x: 30, y: 30, z: 20 }, edgeLength: 10 });

        expect(report).toMatchObject({ complete: true, free: 0, unresolved: 0 });
        expect(report.contact).toBeGreaterThan(0);
        expectClosed(mesh);
        expectInside(mesh, volume);
        // The fronts met on the far side of the pillar: all the ring is filled but the thin wall between them.
        const exact = 200 * 200 * 40 - 80 * 80 * 40;
        expect(volumeOf(mesh)).toBeLessThan(exact);
        expect(volumeOf(mesh)).toBeGreaterThan(exact * 0.93);
    });

    it("refuses a seed outside the volume and lengths that are not lengths", () => {
        const volume = createSphereVolume(ORIGIN, 100);
        expect(() => new GrownSurface(volume, { seed: { x: 98, y: 0, z: 0 }, edgeLength: 10 })).toThrow(RangeError);
        expect(() => new GrownSurface(volume, { seed: ORIGIN, edgeLength: 0 })).toThrow(RangeError);
        expect(() => new GrownSurface(volume, { seed: ORIGIN, edgeLength: 10, seedRadius: 0.5 })).toThrow(RangeError);
        expect(() => new GrownSurface(volume, { seed: ORIGIN, edgeLength: 10, step: 0 })).toThrow(RangeError);
        expect(() => new GrownSurface(volume, { seed: ORIGIN, edgeLength: 10, tolerance: -1 })).toThrow(RangeError);
    });

    it("fills a chamber made of constraints: content, a drill hole to the surface and a ceiling", () => {
        const ground = (x: number, y: number): number => 300 + 0.05 * x + 8 * Math.sin(y / 60);
        const ore: IPoint3[] = [];
        for (const x of [0, 160]) for (const y of [0, 90]) for (const z of [120, 190]) ore.push({ x, y, z });
        ore.push({ x: 80, y: 45, z: 215 });
        const drillHole = [
            { x: 60, y: 40, z: 150 },
            { x: 50, y: 30, z: 330 },
        ];
        // Under 40 m of ground, around the ore; around the drill hole up to 5 m of the ground, where its collar stops.
        const volume = intersectVolumes([
            createUnderSurfaceVolume((x, y) => ground(x, y) - 5),
            uniteVolumes([intersectVolumes([createUnderSurfaceVolume((x, y) => ground(x, y) - 40), createHullVolume(convexHull(ore)!, 30)]), createPathVolume(drillHole, 12)]),
        ]);
        const { mesh, report } = growSurface(volume, { seed: { x: 80, y: 45, z: 160 }, edgeLength: 8 });

        expect(report).toMatchObject({ complete: true, free: 0, unresolved: 0 });
        expectClosed(mesh);
        expectInside(mesh, volume);
        let highest = -Infinity;
        let lowest = Infinity;
        for (let i = 0; i < mesh.positions.length; i += 3) {
            highest = Math.max(highest, mesh.positions[i + 2]! - ground(mesh.positions[i]!, mesh.positions[i + 1]!));
            lowest = Math.min(lowest, mesh.positions[i + 2]!);
        }
        // The chimney of the drill hole comes up to the smallest depth and no higher; the floor is 30 m under the ore.
        expect(highest).toBeLessThanOrEqual(-5);
        expect(highest).toBeGreaterThan(-5.5);
        expect(lowest).toBeLessThan(120 - 29);
    });
});
