import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            "@spacexr/3d-tiles-core": source("../../../3d-tiles-core/node/packages/core/src/index.ts"),
            "@spacexr/3d-tiles-runtime": source("../../../3d-tiles-core/node/packages/runtime/src/index.ts"),
            "@spacexr/dem": source("../dem/src/index.ts"),
            "@spacexr/grid": source("../grid/src/index.ts"),
            "@spacexr/raster": source("../raster/src/index.ts"),
            "@spacexr/tiles": source("../../../spacexr-tiling/packages/tiles/src/index.ts"),
        },
    },
    test: {
        include: ["tests/**/*.test.ts"],
        environment: "node",
    },
});
