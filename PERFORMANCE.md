# Habitat performance

The root URL opens the simulation directly and follows the fly after loading. The old `/world.html` link redirects to `/`.

## September 2026 measurements

Measured locally in the Codex Chromium browser on Intel integrated graphics (gen-12lp), with one test simulation open, at the normal 1280 × 720 viewport. Each run starts a fresh deterministic Life instance, uses overview camera, discards five warm-up cycles and averages the next 30 cycles. Pace is 3, neural window 10 ms, and physics advances 480 × 0.1 ms per cycle. These are wall-clock control-cycle measurements, not rendering FPS or a claim of biological real time. Other system load and authored scene colours can affect results.

| Version | Total cycle | Brain capture | Body + retinal capture |
| --- | ---: | ---: | ---: |
| Prior UI / synchronous physics | 528.0 ms | 323.4 ms | 188.7 ms |
| First attempt, 32-step yielding batches | 566.3 ms | 173.6 ms | 367.9 ms |
| Final, 128-step yielding batches | 358.5 ms | 174.5 ms | 170.8 ms |

The final run takes 32% less time per control cycle (about 47% more cycles per second). The first attempt was rejected because excessive render opportunities between physics batches outweighed its GPU savings.

## Changes

- Retinal rendering/readback occurs after physics advances, instead of also happening on every display frame. This removes a synchronous WebGL readback that competed with WebGPU computation.
- Static and offscreen brain/habitat views skip redraws. The habitat display is capped at 24 FPS and the brain view at 30 FPS, at a maximum 1.25 device pixel ratio. These display limits do not drop neural or physics steps.
- Shadow maps update with simulation poses, rather than every display render.
- Physics yields between 128-step batches while preserving the 0.1 ms timestep, all substeps and sensor accumulation across batches. It still runs on the main thread, so very slow devices can experience pauses.
- Rolling-rate captures reuse the GPU readback buffer. The habitat reuses its CPU rate array; other callers still receive independent arrays.
- Offscreen charts skip painting and refresh when they become visible, including while paused. Live chart painting is capped at five updates per second.
- GPU pipeline creation is asynchronous. The anatomical scene appears before the brain finishes loading.
- The 78 MB compiled body uses a SHA-versioned IndexedDB cache. Existing brain caching remains. Custom unversioned body URLs revalidate instead of caching indefinitely.

The measured graph, shader equations, neural timestep, learning rules and MuJoCo model were not reduced or replaced. First visits still need the large scientific assets; the server already provides Brotli compression. A full 139,255-neuron / 15,091,983-edge model remains a substantial GPU workload.

## Reproduce

Run `npm run build` and `npm run preview:habitat`, then open `/?benchmark`. The test bypasses saved lineage, does not write a checkpoint, and pauses after its bounded run. Inspect the `data-performance` attribute of `#clock-cycle` for JSON containing averages and settings. Use one simulation tab and the same viewport/settings for comparisons. The normal URL has no benchmark limit.

Validation includes the physics batching tests (complete step counts, remainder batches, sensor reset boundary and failure propagation), the existing life/learning tests, TypeScript, production build, and browser checks for live activity, camera controls and on-demand charts.
