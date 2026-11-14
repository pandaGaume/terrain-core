import { defineConfig } from "tsup";

export default defineConfig({
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    platform: "neutral",
    outDir: "dist",
    splitting: false,
    treeshake: true,
    external: ["@spacexr/3d-tiles-core", "@spacexr/3d-tiles-runtime", "@spacexr/dem", "@spacexr/geodesy", "@spacexr/grid", "@spacexr/tiles"],
});
