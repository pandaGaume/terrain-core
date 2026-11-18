import { describe, expect, it } from "vitest";

import { createContentEnvelope, type IPoint3 } from "../src";

/** The eight corners of a box. */
function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): IPoint3[] {
    const corners: IPoint3[] = [];
    for (const x of [minX, maxX]) for (const y of [minY, maxY]) for (const z of [minZ, maxZ]) corners.push({ x, y, z });
    return corners;
}

describe("createContentEnvelope", () => {
    it("has no envelope without points", () => {
        expect(createContentEnvelope([])).toBeUndefined();
    });

    it("gives the top of a hull under a point, and nothing beside it", () => {
        // A roof: a ridge along y at z = -50 over a base at z = -100.
        const points = [...box(0, 0, -200, 100, 40, -100), { x: 50, y: 0, z: -50 }, { x: 50, y: 40, z: -50 }];
        const envelope = createContentEnvelope(points)!;

        expect(envelope.shape).toBe("hull");
        expect(envelope.bounds).toEqual({ minX: 0, minY: 0, minZ: -200, maxX: 100, maxY: 40, maxZ: -50 });
        expect(envelope.topAt(50, 20)).toBeCloseTo(-50, 9);
        expect(envelope.topAt(25, 20)).toBeCloseTo(-75, 9);
        expect(envelope.topAt(75, 10)).toBeCloseTo(-75, 9);
        expect(envelope.topAt(0, 0)).toBeCloseTo(-100, 9);
        expect(envelope.topAt(100, 40)).toBeCloseTo(-100, 9);
        expect(envelope.topAt(-0.001, 20)).toBeUndefined();
        expect(envelope.topAt(50, 40.001)).toBeUndefined();
    });

    it("leaves no gap between the faces of the top", () => {
        const points: IPoint3[] = [];
        for (let i = 0; i < 300; i++) {
            const angle = i * 2.399963;
            const radius = 400 * Math.sqrt((i + 0.5) / 300);
            points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: -500 + 200 * Math.cos(radius / 300) });
        }
        const envelope = createContentEnvelope(points)!;
        for (let x = -250; x <= 250; x += 12.5) {
            for (let y = -250; y <= 250; y += 12.5) {
                const top = envelope.topAt(x, y);
                expect(top).toBeDefined();
                // The points lie on a dome: the faces between them run just under it.
                const dome = -500 + 200 * Math.cos(Math.hypot(x, y) / 300);
                expect(top!).toBeLessThanOrEqual(dome + 1e-6);
                expect(top!).toBeGreaterThan(dome - 5);
            }
        }
    });

    it("grows by the clearance, on the sides and above only", () => {
        const envelope = createContentEnvelope(box(0, 0, -200, 100, 40, -100), { lateral: 10, vertical: 5 })!;

        expect(envelope.shape).toBe("hull");
        expect(envelope.bounds).toEqual({ minX: -10, minY: -10, minZ: -200, maxX: 110, maxY: 50, maxZ: -95 });
        expect(envelope.topAt(50, 20)).toBeCloseTo(-95, 9);
        expect(envelope.topAt(-10, -10)).toBeCloseTo(-95, 9);
        expect(envelope.topAt(109.99, 49.99)).toBeCloseTo(-95, 9);
        expect(envelope.topAt(110.01, 20)).toBeUndefined();
    });

    it("keeps the clearance over a slope, measured along the vertical and along the ground", () => {
        // A ramp rising eastward by 1 for 2.
        const points = [...box(0, 0, -300, 200, 20, -300), { x: 200, y: 0, z: -200 }, { x: 200, y: 20, z: -200 }];
        const bare = createContentEnvelope(points)!;
        const grown = createContentEnvelope(points, { lateral: 10, vertical: 4 })!;

        for (let x = 0; x <= 200; x += 20) {
            for (const reach of [-10, 0, 10]) {
                const top = bare.topAt(Math.min(200, Math.max(0, x + reach)), 10)!;
                expect(grown.topAt(x, 10)!).toBeGreaterThanOrEqual(top + 4 - 1e-9);
            }
        }
    });

    it("stands for content without volume by its box", () => {
        const drillHole = [0, 1, 2, 3, 4].map((i) => ({ x: 10 + i, y: 20 + 2 * i, z: -50 * i }));
        const level = box(0, 0, -150, 300, 200, -150);
        const two = [
            { x: 0, y: 0, z: -10 },
            { x: 5, y: 5, z: -20 },
        ];

        for (const points of [drillHole, level, two]) {
            const envelope = createContentEnvelope(points, { lateral: 3, vertical: 2 })!;
            const highest = Math.max(...points.map((point) => point.z));
            expect(envelope.shape).toBe("box");
            expect(envelope.bounds.maxZ).toBe(highest + 2);
            for (const point of points) expect(envelope.topAt(point.x, point.y)).toBe(highest + 2);
            expect(envelope.topAt(points[0]!.x - 3.01, points[0]!.y)).toBeUndefined();
        }
    });

    it("refuses a negative clearance", () => {
        expect(() => createContentEnvelope(box(0, 0, 0, 1, 1, 1), { lateral: -1, vertical: 0 })).toThrow(RangeError);
    });
});
