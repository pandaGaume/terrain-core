# Raster contracts

Rasters store interleaved channels in row-major order. Width, height, channel count and raster registration are explicit. Floating-point missing values are NaN. Numeric image decoders preserve stored values without colour-space conversion or alpha premultiplication.

With `area` registration, pixels represent areas; stitching obtains shared sampling boundaries from neighbours. With `point` registration, samples include shared edges. Tile pyramids provide loading, retention, ancestor subregions and cache lifecycle independently of any body or renderer.

Interpolation and neighbour access are generic data operations. Independent roots remain isolated. Topology ports describe their connectivity without requiring a particular projection. Provider endpoints and physical-body descriptors belong to the application or sample.
