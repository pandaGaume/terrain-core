// Component: SPX-DEM-001; documentation: ../../COMPONENT.md
import type { WebTileSource } from "@spacexr/tiles";
import type { DemEncoding } from "../codecs";

/** Web tile source of elevation tiles, with the encoding of its pixels. */
export interface IDemTileSource {
    source: WebTileSource;
    encoding: DemEncoding;
}
