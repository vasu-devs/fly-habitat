# Habitat performance

The root URL opens the simulation directly and follows the fly after loading. The old `/world.html` link redirects to `/`.

## September 16: responsive worker and observation workspace

The habitat now owns MuJoCo inside a dedicated module worker. Loading the MJB, initializing contacts, and every numerical physics step happen off the main thread. The renderer receives the original model geometry once and small pose snapshots after each 128-step batch. Snapshot arrays on the UI remain stable so a control cycle can safely hold its pose across an awaited step. Reset and pose restoration are acknowledged before the neural loop continues. The full graph, timestep, gait parameters and step count remain unchanged.

In a local 1280 × 720 Chromium run on the same Intel gen-12lp laptop, the longest recorded main-thread startup task was **461 ms**; the 30-cycle run recorded **no main-thread long tasks (over 50 ms)**. Navigation and model notes responded during body initialization. Startup still took tens of seconds. Wall-clock cycles averaged **488 ms** in that run (brain 160 ms, body/worker/retina 322 ms); this is a responsiveness improvement, not a further throughput win over the earlier 358 ms result. Another worker run measured 384 ms. System scheduling and the larger observation canvas affect these timings; neither run supports a real-time simulation claim.

The interface uses separate Observe, Neural activity and Experiment views. Hidden views stop visual rendering while the same neural loop keeps running. The full anatomy fills the observation canvas, accompanied by a single physiology/task sidebar. Materials use neutral lighting and slate surfaces; the flybody meshes and their anatomical colours are retained.

Cache reads, downloads, worker commands and GPU waits now have bounded failure paths. Boot errors do not replace an existing saved lineage with a fresh default. Errors expose a reload action that preserves the saved lineage. The worker is terminated on fatal errors.

## Earlier September 2026 throughput measurements

Measured locally in the Codex Chromium browser on Intel integrated graphics (gen-12lp), with one test simulation open, at the normal 1280 × 720 viewport. Each run starts a fresh deterministic Life instance, uses overview camera, discards five warm-up cycles and averages the next 30 cycles. Pace is 3, neural window 10 ms, and physics advances 480 × 0.1 ms per cycle. These are wall-clock control-cycle measurements, not rendering FPS or a claim of biological real time. Other system load and authored scene colours can affect results.

| Version | Total cycle | Brain capture | Body + retinal capture |
| --- | ---: | ---: | ---: |
| Prior UI / synchronous physics | 528.0 ms | 323.4 ms | 188.7 ms |
| First attempt, 32-step yielding batches | 566.3 ms | 173.6 ms | 367.9 ms |
| Earlier release, 128-step yielding batches | 358.5 ms | 174.5 ms | 170.8 ms |

That earlier release takes 32% less time per control cycle (about 47% more cycles per second). The first attempt was rejected because excessive render opportunities between physics batches outweighed its GPU savings.

## Earlier optimizations retained

- Retinal rendering/readback occurs after physics advances, instead of also happening on every display frame. This removes a synchronous WebGL readback that competed with WebGPU computation.
- Static and offscreen brain/habitat views skip redraws. The habitat display is capped at 24 FPS and the brain view at 30 FPS, at a maximum 1.25 device pixel ratio. These display limits do not drop neural or physics steps.
- Shadow maps update with simulation poses, rather than every display render.
- Physics preserves the 0.1 ms timestep, all substeps and sensor accumulation across 128-step batches. The habitat now runs those batches in a worker; the legacy lab still uses its existing main-thread path.
- Rolling-rate captures reuse the GPU readback buffer. The habitat reuses its CPU rate array; other callers still receive independent arrays.
- Offscreen charts skip painting and refresh when they become visible, including while paused. Live chart painting is capped at five updates per second.
- GPU pipeline creation is asynchronous. The anatomical scene appears before the brain finishes loading.
- The 78 MB compiled body uses a SHA-versioned IndexedDB cache. Existing brain caching remains. Custom unversioned body URLs revalidate instead of caching indefinitely.

The measured graph, shader equations, neural timestep, learning rules and MuJoCo model were not reduced or replaced. First visits still need the large scientific assets; the server already provides Brotli compression. A full 139,255-neuron / 15,091,983-edge model remains a substantial GPU workload.

## Reproduce

Run `npm run build` and `npm run preview:habitat`, then open `/?benchmark`. The test bypasses saved lineage, does not write a checkpoint, and pauses after its bounded run. Inspect the `data-performance` attribute of `#clock-cycle` for JSON containing averages, settings, and longest observed startup/run main-thread tasks. Use one simulation tab and the same viewport/settings for comparisons. The normal URL has no benchmark limit.

Validation includes the physics batching tests (complete step counts, remainder batches, sensor reset boundary and failure propagation), the existing life/learning tests, TypeScript, production build, and browser checks for live activity, camera controls and on-demand charts.
