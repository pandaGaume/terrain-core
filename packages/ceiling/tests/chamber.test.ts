import { describe, expect, it } from "vitest";

import { createChamberVolume, growChamber, type IChamberInput, type IChamberObject, type IChamberSettings, type IGrownSurfaceMesh, type IPoint3 } from "../src";

const SETTINGS: IChamberSettings = { depth: 40, minDepth: 5, clearance: 10, attraction: 1, edgeLength: 10 };

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): IPoint3[] {
    const corners: IPoint3[] = [];
    for (const x of [minX, maxX]) for (const y of [minY, maxY]) for (const z of [minZ, maxZ]) corners.push({ x, y, z });
    return corners;
}

/** An orebody under flat ground at 300: the ceiling is at 260 and nothing goes over 295. */
const ORE: IChamberObject = { points: box(0, 0, 120, 160, 90, 190) };
/** A drill hole from the orebody to a collar 30 m over the ground. */
const DRILL_HOLE: IChamberObject = {
    kind: "path",
    points: [
        { x: 60, y: 40, z: 150 },
        { x: 60, y: 40, z: 330 },
    ],
};
const flat = (): number => 300;

function chamber(objects: IChamberObject[], settings: Partial<IChamberSettings> = {}, reference: (x: number, y: number) => number = flat): IChamberInput {
    return { settings: { ...SETTINGS, ...settings }, objects, reference };
}

/** Checks that a mesh is one closed surface of the topology of a sphere. */
function expectClosed(mesh: IGrownSurfaceMesh): void {
    const { indices } = mesh;
    const vertices = mesh.positions.length / 3;
    const edges = new Set<number>();
    for (let i = 0; i < indices.length; i += 3) for (let k = 0; k < 3; k++) edges.add(indices[i + k]! * vertices + indices[i + ((k + 1) % 3)]!);
    let unpaired = 0;
    for (const edge of edges) if (!edges.has((edge % vertices) * vertices + Math.floor(edge / vertices))) unpaired++;
    expect(edges.size).toBe(indices.length);
    expect(unpaired).toBe(0);
    expect(vertices - edges.size / 2 + indices.length / 3).toBe(2);
}

/** Highest and lowest heights of the vertices of a mesh inside a rectangle on the ground. */
function heights(mesh: IGrownSurfaceMesh, minX: number, minY: number, maxX: number, maxY: number): { highest: number; lowest: number } {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i]!;
        const y = mesh.positions[i + 1]!;
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        highest = Math.max(highest, mesh.positions[i + 2]!);
        lowest = Math.min(lowest, mesh.positions[i + 2]!);
    }
    return { highest, lowest };
}

describe("createChamberVolume", () => {
    it("keeps the clearance around an object at attraction 1", () => {
        const volume = createChamberVolume(chamber([ORE], { top: "content" }));

        expect(volume.contains(80, 45, 150)).toBe(true);
        expect(volume.contains(169, 45, 150)).toBe(true);
        expect(volume.contains(171, 45, 150)).toBe(false);
        expect(volume.contains(80, 45, 111)).toBe(true);
        expect(volume.contains(80, 45, 109)).toBe(false);
        expect(volume.contains(80, 45, 199)).toBe(true);
        expect(volume.contains(80, 45, 201)).toBe(false);
    });

    it("opens over an object up to the ceiling, unless the top is asked to follow the content", () => {
        const open = createChamberVolume(chamber([ORE]));
        const closed = createChamberVolume(chamber([ORE], { top: "content" }));

        expect(open.contains(80, 45, 259)).toBe(true);
        expect(closed.contains(80, 45, 259)).toBe(false);
        // Over the object and its margin on the ground, no wider, and not over the ceiling.
        expect(open.contains(169, 45, 250)).toBe(true);
        expect(open.contains(171, 45, 250)).toBe(false);
        expect(open.contains(80, 45, 261)).toBe(false);
        // Under the object nothing changes.
        expect(open.contains(80, 45, 109)).toBe(false);
    });

    it("follows the ground: the ceiling and the smallest depth are depths, not heights", () => {
        const ground = (x: number): number => 300 + 0.5 * x;
        const volume = createChamberVolume(chamber([ORE], {}, ground));

        expect(volume.contains(20, 45, 269)).toBe(true);
        expect(volume.contains(20, 45, 271)).toBe(false);
        expect(volume.contains(140, 45, 329)).toBe(true);
        expect(volume.contains(140, 45, 331)).toBe(false);
    });

    it("lets a drill hole come up to the smallest depth, within the clearance only", () => {
        const volume = createChamberVolume(chamber([ORE, DRILL_HOLE]));

        expect(volume.contains(60, 40, 280)).toBe(true);
        expect(volume.contains(69, 40, 280)).toBe(true);
        expect(volume.contains(71, 40, 280)).toBe(false);
        expect(volume.contains(60, 40, 294)).toBe(true);
        expect(volume.contains(60, 40, 296)).toBe(false);
        // The collar itself is over the ground: it stays out.
        expect(volume.contains(60, 40, 320)).toBe(false);
    });

    it("goes further from an object as its attraction falls, up to the hull of all the content", () => {
        const far: IChamberObject = { points: box(300, 0, 120, 360, 90, 190) };
        const between: [number, number, number] = [230, 45, 150];

        expect(createChamberVolume(chamber([ORE, far], { top: "content" })).contains(...between)).toBe(false);
        expect(createChamberVolume(chamber([ORE, far], { top: "content", attraction: 0 })).contains(...between)).toBe(true);
        // 70 m from both: a reach of 1000 at attraction 0.93 gives a margin of 80, at 0.95 one of 60.
        expect(createChamberVolume(chamber([ORE, far], { top: "content", attraction: 0.93, reach: 1000 })).contains(...between)).toBe(true);
        expect(createChamberVolume(chamber([ORE, far], { top: "content", attraction: 0.95, reach: 1000 })).contains(...between)).toBe(false);
        // Even at attraction 0 the chamber stays within the clearance of the hull of all the content.
        const loose = createChamberVolume(chamber([ORE, far], { top: "content", attraction: 0 }));
        expect(loose.contains(230, 99, 150)).toBe(true);
        expect(loose.contains(230, 101, 150)).toBe(false);
        expect(loose.contains(-9, 45, 150)).toBe(true);
        expect(loose.contains(-11, 45, 150)).toBe(false);
    });

    it("keeps the opening over the objects within the clearance of the footprint of all the content", () => {
        const far: IChamberObject = { points: box(300, 0, 120, 360, 90, 190) };
        const loose = createChamberVolume(chamber([ORE, far], { attraction: 0 }));

        // Over the content and between the two orebodies, up to the ceiling.
        expect(loose.contains(230, 45, 255)).toBe(true);
        expect(loose.contains(230, 99, 255)).toBe(true);
        // The margin on the ground is 370 at attraction 0, but the opening stops 10 m from the footprint.
        expect(loose.contains(230, 101, 255)).toBe(false);
        expect(loose.contains(-11, 45, 255)).toBe(false);
    });

    it("takes the top of an object before the one of the settings", () => {
        const drift: IChamberObject = {
            kind: "path",
            points: [
                { x: 200, y: 20, z: 110 },
                { x: 400, y: 20, z: 110 },
            ],
        };
        // The orebody opens up to the ceiling; the drift, told otherwise, keeps its top at the clearance.
        const mixed = createChamberVolume(chamber([ORE, { ...drift, top: "content" }]));
        expect(mixed.contains(80, 45, 259)).toBe(true);
        expect(mixed.contains(300, 20, 119)).toBe(true);
        expect(mixed.contains(300, 20, 125)).toBe(false);
        expect(createChamberVolume(chamber([ORE, drift])).contains(300, 20, 259)).toBe(true);

        // The other way round: the settings keep the top on the content, one object opens it.
        const one = createChamberVolume(chamber([{ ...ORE, top: "ceiling" }, drift], { top: "content" }));
        expect(one.contains(80, 45, 259)).toBe(true);
        expect(one.contains(300, 20, 125)).toBe(false);
    });

    it("takes the attraction of an object before the one of the settings", () => {
        const loose = createChamberVolume(chamber([{ ...ORE, attraction: 0.5 }], { top: "content", reach: 100 }));
        const hole = createChamberVolume(chamber([ORE, { ...DRILL_HOLE, attraction: 0.5 }], { top: "content", reach: 100 }));

        // The hull of all the content still bounds the chamber: one object alone cannot go past its own clearance.
        expect(loose.contains(171, 45, 150)).toBe(false);
        // Around the drill hole the margin is 60 under the ceiling, inside the hull of the content.
        expect(hole.contains(60, 40, 240)).toBe(true);
        expect(hole.contains(100, 40, 215)).toBe(true);
        expect(createChamberVolume(chamber([ORE, DRILL_HOLE], { top: "content", reach: 100 })).contains(100, 40, 215)).toBe(false);
    });

    it("stands for a solid without volume, loose points and a path of one point by their points", () => {
        const level: IChamberObject = { points: box(0, 0, 150, 100, 100, 150) };
        const stations: IChamberObject = { kind: "points", points: [{ x: 0, y: 0, z: 100 }] };
        const single: IChamberObject = { kind: "path", points: [{ x: 50, y: 50, z: 100 }] };
        const volume = createChamberVolume(chamber([level, stations, single, { points: [] }], { top: "content" }));

        expect(volume.contains(100, 100, 159)).toBe(true);
        // The middle of the flat level is far from its corners: only its points count.
        expect(volume.contains(50, 50, 150)).toBe(false);
        expect(volume.contains(0, 9, 100)).toBe(true);
        expect(volume.contains(50, 50, 109)).toBe(true);
        expect(volume.contains(50, 50, 111)).toBe(false);
    });

    it("holds nothing where the ground is unknown, and refuses settings that make no chamber", () => {
        const volume = createChamberVolume(chamber([ORE], {}, (x) => (x > 100 ? Number.NaN : 300)));
        expect(volume.contains(80, 45, 150)).toBe(true);
        expect(volume.contains(120, 45, 150)).toBe(false);

        expect(() => createChamberVolume(chamber([ORE], { minDepth: 50 }))).toThrow(RangeError);
        expect(() => createChamberVolume(chamber([ORE], { minDepth: -1 }))).toThrow(RangeError);
        expect(() => createChamberVolume(chamber([ORE], { clearance: -1 }))).toThrow(RangeError);
        expect(() => createChamberVolume(chamber([ORE], { attraction: 1.5 }))).toThrow(RangeError);
        expect(() => createChamberVolume(chamber([ORE], { reach: -1 }))).toThrow(RangeError);
        expect(() => createChamberVolume(chamber([ORE], { edgeLength: 0 }))).toThrow(RangeError);
        expect(() => createChamberVolume(chamber([{ ...ORE, attraction: -0.1 }]))).toThrow(RangeError);
    });
});

describe("growChamber", () => {
    const ground = (x: number, y: number): number => 300 + 0.05 * x + 8 * Math.sin(y / 60);

    it("grows a chamber around its content, up to the ceiling and up the drill hole", () => {
        const input = chamber([ORE, DRILL_HOLE], {}, ground);
        const { volume, mesh, report } = growChamber(input);

        expect(report).toMatchObject({ complete: true, free: 0, unresolved: 0, unreached: [], seedRadius: 5 });
        expect(report.seed).toEqual({ x: 80, y: 45, z: 155 });
        expectClosed(mesh);
        let outside = 0;
        let highest = -Infinity;
        for (let i = 0; i < mesh.positions.length; i += 3) {
            if (!volume.contains(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!)) outside++;
            highest = Math.max(highest, mesh.positions[i + 2]! - ground(mesh.positions[i]!, mesh.positions[i + 1]!));
        }
        expect(outside).toBe(0);
        // The chimney of the drill hole stops at the smallest depth; away from it the top is on the ceiling.
        expect(highest).toBeLessThanOrEqual(-5);
        expect(highest).toBeGreaterThan(-5.5);
        const top = heights(mesh, 100, 10, 150, 80).highest;
        expect(top).toBeLessThanOrEqual(ground(150, 80) - 40);
        expect(top).toBeGreaterThan(250);
        expect(heights(mesh, 0, 0, 160, 90).lowest).toBeLessThan(111);
    });

    it("keeps the top near the content when asked to", () => {
        const { mesh, report } = growChamber(chamber([ORE], { top: "content" }, ground));

        expect(report).toMatchObject({ complete: true, unreached: [] });
        expectClosed(mesh);
        const { highest } = heights(mesh, -20, -20, 180, 110);
        expect(highest).toBeLessThanOrEqual(200);
        expect(highest).toBeGreaterThan(199);
    });

    it("says which objects its surface does not hold", () => {
        const far: IChamberObject = { points: box(400, 0, 120, 460, 90, 190) };
        const tight = growChamber(chamber([ORE, far], { top: "content" }));
        const loose = growChamber(chamber([ORE, far], { top: "content", attraction: 0, edgeLength: 20 }));

        // At attraction 1 the two orebodies are 240 m apart with 10 m of clearance: the surface stays in the larger.
        expect(tight.report.unreached).toEqual([1]);
        expect(loose.report.unreached).toEqual([]);
        expectClosed(loose.mesh);
    });

    it("starts where it is told, or in a smaller sphere when the largest object has no room", () => {
        const told = growChamber(chamber([ORE]), { seed: { x: 20, y: 20, z: 130 } });
        expect(told.report.seed).toEqual({ x: 20, y: 20, z: 130 });
        expect(told.report.unreached).toEqual([]);

        // A drill hole alone, with 3 m of clearance: a sphere of radius 5 does not fit, one of 2.5 does.
        const hole: IChamberObject = {
            kind: "path",
            points: [
                { x: 0, y: 0, z: 100 },
                { x: 0, y: 0, z: 200 },
            ],
        };
        const narrow = growChamber(chamber([hole], { clearance: 3, top: "content", edgeLength: 10 }));
        expect(narrow.report.seedRadius).toBe(2.5);
        expect(narrow.report.seed).toEqual({ x: 0, y: 0, z: 150 });
        expectClosed(narrow.mesh);
    });

    it("refuses a chamber without room for a seed", () => {
        // The orebody is over the smallest depth: nothing of it is in the chamber.
        expect(() => growChamber(chamber([ORE], {}, () => 100))).toThrow(RangeError);
        expect(() => growChamber(chamber([]))).toThrow(RangeError);
        expect(() => growChamber(chamber([ORE]), { seed: { x: 1000, y: 0, z: 0 } })).toThrow(RangeError);
    });
});
