import { describe, expect, it } from "vitest";

import { createBoxVolume, createPathVolume, createSphereVolume, fuseByTexels, GrownSurface, type IVolume, uniteVolumes } from "../src";

const ORIGIN = { x: 0, y: 0, z: 0 };

/** Euler characteristic, and whether each directed edge is met once and has its twin. */
function topology(mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }): { euler: number; repeated: number; unpaired: number } {
    const vertices = mesh.positions.length / 3;
    const edges = new Set<number>();
    let repeated = 0;
    for (let i = 0; i < mesh.indices.length; i += 3)
        for (let k = 0; k < 3; k++) {
            const edge = mesh.indices[i + k]! * vertices + mesh.indices[i + ((k + 1) % 3)]!;
            if (edges.has(edge)) repeated++;
            edges.add(edge);
        }
    let unpaired = 0;
    for (const edge of edges) if (!edges.has((edge % vertices) * vertices + Math.floor(edge / vertices))) unpaired++;
    return { euler: vertices - edges.size / 2 + mesh.indices.length / 3, repeated, unpaired };
}

function volumeOf(mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }): number {
    const p = mesh.positions;
    let six = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
        const [a, b, c] = [mesh.indices[i]! * 3, mesh.indices[i + 1]! * 3, mesh.indices[i + 2]! * 3];
        six += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) + p[a + 1]! * (p[b + 2]! * p[c]! - p[b]! * p[c + 2]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
    }
    return six / 6;
}

describe("fuseByTexels", () => {
    it("fuses the two fronts that met round a pillar: a closed surface with one hole through it", () => {
        // A slab with a pillar through it: a ring.
        const slab = createBoxVolume(ORIGIN, { x: 200, y: 200, z: 40 });
        const pillar = createBoxVolume({ x: 60, y: 60, z: -1 }, { x: 140, y: 140, z: 41 });
        const volume: IVolume = { contains: (x, y, z) => slab.contains(x, y, z) && !pillar.contains(x, y, z) };
        const surface = new GrownSurface(volume, { seed: { x: 30, y: 30, z: 20 }, edgeLength: 10 });
        surface.grow();
        const grown = surface.mesh();
        expect(surface.report().contact).toBeGreaterThan(0);
        expect(topology(grown).euler).toBe(2);

        const fused = fuseByTexels({ positions: grown.positions, indices: grown.indices, meetings: surface.meetingPoints(), volume, edgeLength: 10 });
        expect(fused.report).toMatchObject({ kept: 0 });
        expect(fused.report.fused).toBeGreaterThan(0);
        expect(fused.report.gaps).toBeGreaterThan(0);
        // Closed, every edge once in each direction, and one hole through: a torus.
        expect(topology(fused)).toEqual({ euler: 0, repeated: 0, unpaired: 0 });
        // The wall is gone: more of the ring is filled than before, nearly all of it.
        const exact = 200 * 200 * 40 - 80 * 80 * 40;
        expect(volumeOf(fused)).toBeGreaterThan(volumeOf(grown));
        expect(volumeOf(fused)).toBeGreaterThan(exact * 0.96);
        expect(volumeOf(fused)).toBeLessThan(exact * 1.02);
    });

    it("fuses a loop of two rooms joined by two tunnels, with their thin wedges of rock where a tunnel opens", () => {
        const at = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x, y, z });
        const volume = uniteVolumes([
            createSphereVolume(at(0, 0, 0), 22),
            createSphereVolume(at(90, 0, 0), 22),
            createPathVolume([at(12, 14, 0), at(45, 32, 0), at(78, 14, 0)], 5),
            createPathVolume([at(12, -14, 0), at(45, -32, 0), at(78, -14, 0)], 5),
        ]);
        const surface = new GrownSurface(volume, { seed: ORIGIN, edgeLength: 3 });
        surface.grow();
        const grown = surface.mesh();
        // The growth keeps the topology of a sphere: where the loop closes, and round the mouths of the tunnels, its
        // fronts met and stopped.
        expect(surface.report().contact).toBeGreaterThan(0);
        expect(topology(grown)).toEqual({ euler: 2, repeated: 0, unpaired: 0 });

        const fused = fuseByTexels({ positions: grown.positions, indices: grown.indices, meetings: surface.meetingPoints(), volume, edgeLength: 3 });
        expect(fused.report.kept).toBe(0);
        expect(fused.report.fused).toBeGreaterThan(0);
        expect(fused.report.gaps).toBeGreaterThan(0);
        expect(fused.report.boxes.every((box) => box.fused && box.rebuilt > 0)).toBe(true);
        // Closed, and one hole through, as the loop.
        expect(topology(fused)).toEqual({ euler: 0, repeated: 0, unpaired: 0 });
        expect(volumeOf(fused)).toBeGreaterThan(volumeOf(grown));
        // Every vertex inside the volume, or on its wall.
        for (let v = 0; v < fused.positions.length; v += 3) expect(volume.contains(fused.positions[v]!, fused.positions[v + 1]!, fused.positions[v + 2]!)).toBe(true);
    });

    it("leaves a surface whose fronts never met as it is", () => {
        const volume = createSphereVolume(ORIGIN, 40);
        const surface = new GrownSurface(volume, { seed: ORIGIN, edgeLength: 8 });
        surface.grow();
        const grown = surface.mesh();
        expect(surface.meetingPoints().length).toBe(0);
        const fused = fuseByTexels({ positions: grown.positions, indices: grown.indices, meetings: surface.meetingPoints(), volume, edgeLength: 8 });
        expect(fused.report).toEqual({ regions: 0, fused: 0, kept: 0, gaps: 0, boxes: [] });
        expect(Array.from(fused.indices)).toEqual(Array.from(grown.indices));
        expect(Array.from(fused.positions)).toEqual(Array.from(grown.positions));
    });
});
