import { VectorTileGeomType, type IVectorStyle, type IVectorTileContent } from "./types";

/** Canvas port; no Babylon or Three types. All coordinates and stroke sizes are local output pixels. */
export type VectorCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Corrected SpaceXR vector-to-image drawing path. Owns neither canvas nor cache. */
export class TileVectorRenderer {
    /** Clears to transparent, clips to tile bounds and draws constant styles in explicit order. */
    public renderTile(tile: IVectorTileContent, context: VectorCanvasContext, style: IVectorStyle, size: number, paintScale = 1): void {
        context.save();
        try {
            context.resetTransform();
            context.clearRect(0, 0, size, size);
            context.beginPath();
            context.rect(0, 0, size, size);
            context.clip();
            for (const rule of style.layers) {
                const layer = tile.layers[rule.sourceLayer];
                if (!layer || rule.visible === false) continue;
                context.save();
                try {
                    context.globalAlpha = rule.opacity ?? 1;
                    context.lineWidth = (rule.width ?? 1) * paintScale;
                    context.lineJoin = "round";
                    context.lineCap = "round";
                    context.setLineDash((rule.dashArray ?? []).map((value) => value * paintScale));
                    if (rule.color) {
                        context.fillStyle = rule.color;
                        context.strokeStyle = rule.color;
                    }
                    const scale = size / layer.extent,
                        dx = (rule.translate?.[0] ?? 0) * paintScale,
                        dy = (rule.translate?.[1] ?? 0) * paintScale;
                    for (const feature of layer.features) {
                        if (rule.type === "circle" && feature.type === VectorTileGeomType.POINT) {
                            for (const path of feature.geometry)
                                for (const p of path) {
                                    context.beginPath();
                                    context.arc(p.x * scale + dx, p.y * scale + dy, (rule.radius ?? 3) * paintScale, 0, 2 * Math.PI);
                                    if (rule.color) context.fill();
                                    if (rule.outlineColor) {
                                        context.strokeStyle = rule.outlineColor;
                                        context.stroke();
                                    }
                                }
                        } else if (
                            (rule.type === "fill" && feature.type === VectorTileGeomType.POLYGON) ||
                            (rule.type === "line" && (feature.type === VectorTileGeomType.LINESTRING || feature.type === VectorTileGeomType.POLYGON))
                        ) {
                            context.beginPath();
                            for (const path of feature.geometry) {
                                if (!path.length) continue;
                                context.moveTo(path[0]!.x * scale + dx, path[0]!.y * scale + dy);
                                for (let i = 1; i < path.length; i++) context.lineTo(path[i]!.x * scale + dx, path[i]!.y * scale + dy);
                                if (feature.type === VectorTileGeomType.POLYGON) context.closePath();
                            }
                            if (rule.type === "fill") {
                                if (rule.color) context.fill("evenodd");
                                if (rule.outlineColor) {
                                    context.strokeStyle = rule.outlineColor;
                                    context.stroke();
                                }
                            } else if (rule.color) context.stroke();
                        }
                    }
                } finally {
                    context.restore();
                }
            }
        } finally {
            context.restore();
        }
    }
}
