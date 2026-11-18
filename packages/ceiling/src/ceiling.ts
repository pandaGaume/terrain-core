import { createContentEnvelope, type IContentEnvelope } from "./content-envelope";
import type { IPoint3 } from "./quickhull";

/**
 * Settings of a ceiling, in metres. Plain values, to be saved with the chamber they describe.
 *
 * The ceiling hangs `depth` under the reference surface. Where content stands higher than that, the ceiling rises to
 * keep `clearance` over it, but never nearer the reference surface than `minDepth`: content that comes closer to the
 * surface than `minDepth + clearance`, such as a ramp or the collar of a drill hole, is then nearer the ceiling than
 * the clearance, or goes through it. The report of {@link buildCeiling} says so.
 */
export interface ICeilingSettings {
    /** Depth of the ceiling under the reference surface. */
    depth: number;
    /** Smallest depth the ceiling keeps under the reference surface. From 0 to `depth`. */
    minDepth: number;
    /** Free space kept above the content, and around it when it is larger than a cell. */
    clearance: number;
    /** Ground added around the content to make the extent of the chamber. */
    margin: number;
    /** Spacing of the grid of the ceiling. It does not follow the level of detail of any view. */
    cellSize: number;
}

/** A rectangle on the ground, in metres: `x` east, `y` north. */
export interface ICeilingExtent {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface ICeilingLayoutInput {
    settings: ICeilingSettings;
    /**
     * Points of the underground content the chamber shows: `x` east, `y` north, `z` the height in the vertical datum
     * of the reference surface. Vertices or corners of bounding boxes; see {@link createContentEnvelope}.
     */
    content?: readonly IPoint3[];
    /** Ground the chamber must cover, whatever the content. Required without content. */
    extent?: ICeilingExtent;
}

/**
 * Where a ceiling stands: its extent, its grid and the envelope of its content.
 *
 * The grid has `columns` by `rows` cells of `settings.cellSize`, so `columns + 1` by `rows + 1` nodes. Nodes are
 * stored row by row from the north-west corner: columns run west to east and rows north to south.
 */
export interface ICeilingLayout {
    settings: ICeilingSettings;
    /** The extent asked for, grown to hold the content with its margin and a whole number of cells. */
    extent: ICeilingExtent;
    columns: number;
    rows: number;
    envelope: IContentEnvelope | undefined;
}

/** What {@link buildCeiling} met. */
export interface ICeilingReport {
    /** Number of nodes of the grid. */
    nodes: number;
    /** Nodes without a reference height, whose ceiling height is `NaN`. */
    missing: number;
    /** Nodes raised over the content, above `reference - depth`. */
    lifted: number;
    /** Nodes held at `minDepth` under the reference surface although the content asked for more. */
    limited: number;
    /**
     * Smallest height of the ceiling over the content, in metres; `NaN` when no node is over content. It is the
     * clearance of the settings or more, unless nodes are `limited`. Negative when the content goes through.
     */
    minClearance: number;
}

/** A ceiling: heights at the nodes of its layout. */
export interface ICeiling {
    layout: ICeilingLayout;
    /** Height of the reference surface at each node, in metres; `NaN` where it is unknown. */
    reference: Float32Array;
    /** Height of the ceiling at each node, in metres, in the vertical datum of the reference; `NaN` where unknown. */
    heights: Float32Array;
    report: ICeilingReport;
}

/** Largest number of nodes of a ceiling: a grid of 2048 cells a side. */
export const MAX_CEILING_NODES = 2049 * 2049;

function assertSettings(settings: ICeilingSettings): void {
    const { depth, minDepth, clearance, margin, cellSize } = settings;
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new RangeError("The cell size of a ceiling must be a positive length.");
    if (!(minDepth >= 0)) throw new RangeError("The smallest depth of a ceiling cannot be negative.");
    if (!(depth >= minDepth) || !Number.isFinite(depth)) throw new RangeError("The depth of a ceiling cannot be less than its smallest depth.");
    if (!(clearance >= 0) || !Number.isFinite(clearance)) throw new RangeError("The clearance of a ceiling cannot be negative.");
    if (!(margin >= 0) || !Number.isFinite(margin)) throw new RangeError("The margin of a ceiling cannot be negative.");
}

/** Number of cells covering a length, and the length they cover. */
function cells(length: number, cellSize: number): number {
    // A length that is a whole number of cells up to rounding error keeps that number.
    return Math.max(1, Math.ceil(length / cellSize - 1e-9));
}

/**
 * Lays a ceiling out: the envelope of the content, the extent of the chamber and its grid.
 *
 * The envelope keeps the clearance above the content. On the sides it keeps the clearance or one cell, whichever is
 * larger: a surface drawn between the nodes of the grid then stays over the content between the nodes too.
 */
export function createCeilingLayout(input: ICeilingLayoutInput): ICeilingLayout {
    const settings = { ...input.settings };
    assertSettings(settings);
    const { clearance, margin, cellSize } = settings;

    const envelope = createContentEnvelope(input.content ?? [], { lateral: Math.max(clearance, cellSize), vertical: clearance });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    if (envelope) {
        minX = envelope.bounds.minX - margin;
        minY = envelope.bounds.minY - margin;
        maxX = envelope.bounds.maxX + margin;
        maxY = envelope.bounds.maxY + margin;
    }
    if (input.extent) {
        minX = Math.min(minX, input.extent.minX);
        minY = Math.min(minY, input.extent.minY);
        maxX = Math.max(maxX, input.extent.maxX);
        maxY = Math.max(maxY, input.extent.maxY);
    }
    if (!(maxX >= minX) || !(maxY >= minY) || !Number.isFinite(maxX - minX) || !Number.isFinite(maxY - minY)) {
        throw new RangeError("A ceiling needs content or an extent.");
    }

    // Whole cells: the extent grows by the same length on both sides.
    const columns = cells(maxX - minX, cellSize);
    const rows = cells(maxY - minY, cellSize);
    if ((columns + 1) * (rows + 1) > MAX_CEILING_NODES) {
        throw new RangeError(`A ceiling of ${columns} by ${rows} cells is over ${MAX_CEILING_NODES} nodes: use larger cells.`);
    }
    const padX = (columns * cellSize - (maxX - minX)) / 2;
    const padY = (rows * cellSize - (maxY - minY)) / 2;
    const extent = { minX: minX - padX, minY: minY - padY, maxX: minX - padX + columns * cellSize, maxY: minY - padY + rows * cellSize };
    return { settings, extent, columns, rows, envelope };
}

/** Number of nodes of a layout. */
export function ceilingNodeCount(layout: ICeilingLayout): number {
    return (layout.columns + 1) * (layout.rows + 1);
}

/** Position eastward of the nodes of a column, from 0 in the west to `columns`. */
export function ceilingNodeX(layout: ICeilingLayout, column: number): number {
    return layout.extent.minX + column * layout.settings.cellSize;
}

/** Position northward of the nodes of a row, from 0 in the north to `rows`. */
export function ceilingNodeY(layout: ICeilingLayout, row: number): number {
    return layout.extent.maxY - row * layout.settings.cellSize;
}

/**
 * Height of a ceiling at a position, interpolated between the four nodes around it: the surface a mesh of the grid
 * draws, up to the diagonal of each cell.
 *
 * @returns The height in metres, or `NaN` outside the extent or beside a node without height.
 */
export function ceilingHeightAt(ceiling: ICeiling, x: number, y: number): number {
    const { layout, heights } = ceiling;
    const { cellSize } = layout.settings;
    const u = (x - layout.extent.minX) / cellSize;
    const v = (layout.extent.maxY - y) / cellSize;
    if (!(u >= 0 && u <= layout.columns && v >= 0 && v <= layout.rows)) return Number.NaN;
    const column = Math.min(layout.columns - 1, Math.floor(u));
    const row = Math.min(layout.rows - 1, Math.floor(v));
    const s = u - column;
    const t = v - row;
    const index = row * (layout.columns + 1) + column;
    const north = heights[index]! * (1 - s) + heights[index + 1]! * s;
    const south = heights[index + layout.columns + 1]! * (1 - s) + heights[index + layout.columns + 2]! * s;
    return north * (1 - t) + south * t;
}

/**
 * Samples the reference surface at the nodes of a layout.
 *
 * @param heightAt - Height of the reference surface in metres at a position, `NaN` where it is unknown. Read the
 * heights of the data, before any vertical exaggeration or displacement a renderer applies.
 */
export function sampleReference(layout: ICeilingLayout, heightAt: (x: number, y: number) => number): Float32Array {
    const reference = new Float32Array(ceilingNodeCount(layout));
    let index = 0;
    for (let row = 0; row <= layout.rows; row++) {
        const y = ceilingNodeY(layout, row);
        for (let column = 0; column <= layout.columns; column++) reference[index++] = heightAt(ceilingNodeX(layout, column), y);
    }
    return reference;
}

/**
 * Builds the ceiling of a layout under a reference surface: at each node, `reference - D`, where `D` is the depth of
 * the settings, less where the envelope of the content stands higher, and `minDepth` at least.
 *
 * @param reference - Height of the reference surface at each node, as {@link sampleReference} gives it.
 */
export function buildCeiling(layout: ICeilingLayout, reference: Float32Array): ICeiling {
    const nodes = ceilingNodeCount(layout);
    if (reference.length !== nodes) throw new RangeError(`The reference has ${reference.length} heights for ${nodes} nodes.`);
    const { depth, minDepth, clearance } = layout.settings;
    const { envelope } = layout;

    const heights = new Float32Array(nodes);
    const report: ICeilingReport = { nodes, missing: 0, lifted: 0, limited: 0, minClearance: Number.NaN };
    let index = 0;
    for (let row = 0; row <= layout.rows; row++) {
        const y = ceilingNodeY(layout, row);
        for (let column = 0; column <= layout.columns; column++, index++) {
            const surface = reference[index]!;
            if (Number.isNaN(surface)) {
                heights[index] = Number.NaN;
                report.missing++;
                continue;
            }
            let height = surface - depth;
            // The top of the envelope is the content plus the clearance.
            const top = envelope?.topAt(ceilingNodeX(layout, column), y);
            if (top !== undefined) {
                if (top > height) {
                    height = top;
                    report.lifted++;
                }
                if (height > surface - minDepth) {
                    height = surface - minDepth;
                    report.limited++;
                }
                const over = height - (top - clearance);
                if (!(over >= report.minClearance)) report.minClearance = over;
            }
            heights[index] = height;
        }
    }
    return { layout, reference, heights, report };
}
