import { Ellipsoid, GeodeticSystem } from "@spacexr/geodesy";
import { WebMercatorTileSurface } from "@spacexr/tiles";
import { describe, expect, it } from "vitest";
import { buildGridTileGeometry, buildGridTileShape, createGridTopology } from "../src";

describe("grids on an application-supplied surface", () => {
    const surface = new WebMercatorTileSurface(new GeodeticSystem(Ellipsoid.sphere("fixture", 1000)));
    const address = { lod: 3, x: 4, y: 3 };
    it("keeps local geometry and its frame consistent", () => {
        const geometry = buildGridTileGeometry(createGridTopology(4), address, surface);
        const expected = surface.point(address, 0, 0);
        expect(geometry.center.x + geometry.positions[0]!).toBeCloseTo(expected.x, 3);
        expect(geometry.center.y + geometry.positions[1]!).toBeCloseTo(expected.y, 3);
        expect(geometry.center.z + geometry.positions[2]!).toBeCloseTo(expected.z, 3);
        expect(Math.hypot(...geometry.ups.slice(0, 3))).toBeCloseTo(1);
    });
    it("derives reusable shapes from the same supplied surface", () => {
        const shape = buildGridTileShape(address, surface, 4);
        expect(shape.positions.length).toBe(25 * 3);
        expect(shape.center).toEqual(surface.point(address, 0.5, 0.5));
    });
});
