# Fly Habitat

Public deployment uses this project's own versioned model release and serves assets on the same origin. See [PUBLISHING.md](PUBLISHING.md) for the current Vercel workflow; the external-bucket instructions below remain an alternative deployment option.

`/` opens the living-connectome habitat directly (`/world.html` redirects here): a measured FlyWire brain simulated on WebGPU, an anatomical flybody in MuJoCo, and a small house where the fly eats, drinks, sleeps, forages, lays eggs, dies, and passes what it learned to the next generation. `/lab.html` is the circuit laboratory (single-cell interventions, MANC nerve-cord bridge). `/research.html` preserves the upstream overview.

Observe shows the body and brain side by side on desktop, stacked on smaller screens. Neurons with no spikes in the captured neural window are dimmed; active cells use their simulated rates. The lifetime archive below records attempted goals, completed actions, death causes, exposures, recorded experiences and actual inherited weight changes. Predator pressure is an authored moving danger footprint with a refuge exemption, not a reconstructed predator. Its damage and negative reinforcement are recorded.

This release remains browser-local. It stops when the tab closes; a shared 24/7 host is not connected. See [HOSTING.md](HOSTING.md) for the CPU feasibility result and proposed hosting split.

## Run

```powershell
npm ci
node tools/fetch-prepared-assets.mjs
node --max-old-space-size=4096 --experimental-strip-types tools/compile-habitat.mjs
npm run dev
```

Open http://127.0.0.1:4173/world.html in a current Chromium browser with WebGPU. Everything runs in the tab; there is no API key, backend, remote inference or generated fly imagery. Assets total several hundred MB; `habitat.mjb` is compiled once with the same MuJoCo 3.8.0 WASM used in the browser (recipe and hash in `tools/compile-habitat.mjs` and `public/habitat-model.json`).

Production: `npm run build`, then `node tools/serve-habitat.mjs` (serves `dist` only, loopback port 4173, expires after two hours). Note that this static server and Vite share port 4173; a leftover static server silently serves the old bundle.

**GPU.** On dual-GPU Windows laptops Chrome uses whichever GPU Windows assigns it and ignores WebGPU's `powerPreference`. To run on the discrete card: Settings → System → Display → Graphics → add `chrome.exe` → High performance, then restart Chrome. On an Intel Iris Xe the brain costs about 15 ms per 1 ms step and a cycle with a 10 ms window takes ~300 ms; a discrete GPU is roughly an order of magnitude faster.

## The control loop

Each cycle:

1. **Senses** (`src/senses.ts`). Every zone except the courtyard emits an odor plume, `strength · exp(−0.6 · distance_cm)` (55 % at 1 cm, 22 % at 2.5 cm). Olfactory receptor neurons (2,276 cells, `cell_type` ORN) are split into left and right by the medial plane of measured soma positions (1,098 | 1,178) and assigned round-robin to five odor channels, one per zone. The antenna facing a source receives up to 50 % more drive than the other, and the resting drive sits just under the firing threshold so even a faint plume fires the facing antenna's receptors first. The fly's rendered retina is averaged over its left and right halves and drives the left and right optic lobes (39,054 | 38,474 cells). All sensory and optic cells receive a small tonic drive. Channel assignment, plume shape and antennal asymmetry are authored; the prepared data has no glomerulus labels.
2. **Brain** (`src/sim.ts`, `src/shaders/lif.wgsl`). The full FlyWire v783 graph — 139,255 neurons, 15,091,983 signed directed edges — advances 5, 10 or 20 one-millisecond leaky integrate-and-fire steps (alpha synapses, Shiu et al. 2024 constants, empirically scaled weights). Per-neuron spike counts over the window are read back as rates.
3. **Steering** (`src/steer.ts`). Seven features: left−right activity asymmetry of the non-goal olfactory receptors (distractor plumes), PN, LHN, visual-projection, optic and descending populations, plus the asymmetry of the current goal's odor channel. The olfactory feature excludes the goal channel on purpose: otherwise it is collinear with the goal feature during every approach and a weight learned on the way to fruit keeps pulling the fly back to the fruit once the goal is water. A linear policy with Gaussian exploration outputs a turn in [−1, 1]. REINFORCE with a running baseline updates it every cycle from progress toward the goal (distance decrease, small time cost, bonus on arrival). Bilateral features are smoothed over about three cycles before the policy sees them. Generation 1 starts with an innate positive gain on the goal-channel feature only (weight 2.2, others 0). Two authored reflexes keep the experiment moving and are logged in the journal: an escape reflex (after 20 cycles with under 0.6 mm of displacement while not at a goal, the fly backs up, turns about a quarter turn toward the side whose goal-channel receptors fire more, then walks straight briefly with the odor policy suppressed; backing up first matters because a body pressed against a wall cannot yaw) and a righting reflex (if the thorax's up vector points down for two cycles the pose is restored upright at the same place and heading, as a real fly rights itself). **Navigation assist** (default 0 %) blends a coordinate bearing into the turn for faster demonstrations.
4. **Goal selection** (`src/life.ts`). A goal is kept until the fly arrives and finishes interacting, 48 habitat seconds pass without the goal plume being strong (96 s regardless, about one crossing of the house), or energy or hydration falls below 15 %. At each decision a linear Q-learner scores the six goals from 16 features: bias, hunger, thirst, fatigue, injury, fertility, carrying-pollen, eight population rates (ORN, PN, LHN, KC, MBON, DN, optic, central) and the sensed odor of that goal's channel. Fixed innate need priorities are added; ε-greedy exploration starts at 15 % and decays 12 % per generation to a 3 % floor. Temporal-difference updates use rewards earned since the last choice.
5. **Body** (`src/physics.ts`, `src/room.ts`). Forward and turn commands drive flybody's 78 actuators through an authored tripod gait with velocity assistance and attitude damping; MuJoCo handles contacts with the compiled walls. Physics advances 16 ms and the habitat clock 0.08 s per cycle at pace 1; the default pace 3 advances 48 ms of physics and 0.24 habitat seconds per brain sample (×8 available). A 240-habitat-second lifetime is therefore about 48 s of body time, roughly 20 cm of walking on the assisted gait.
6. **Life.** Energy, hydration, rest, health and fertility drift; resources act only when the body is inside a zone and the brain is active. Pollen is collected at the garden and delivered to the nursery; enough fertility at the nursery lays an egg (up to eight). Starvation, dehydration, exhaustion, heat exposure, food withdrawal, or the 240-habitat-second lifespan end a life.
7. **Inheritance.** At death both learners (96 goal weights, 7 steering weights), the journal, lesions and synaptic strength are archived with the lifetime's outcomes. An egg hatches into the next adult; without eggs the experiment reseeds a descendant. Either way the current weights are inherited. Descendants can improve or regress; the lineage panel reports the early-third versus latest-third means without claiming a controlled benchmark.

Clocks are reported separately: neural milliseconds, physics seconds, habitat seconds, and wall milliseconds per cycle.

## Deploy (Vercel or any static host)

The current Vercel deployment downloads the versioned binaries at build time, verifies them and serves them from the same origin. Alternatively, a host with tighter file limits can use `npm run build:slim` and an external asset bucket. The page supports these locations baked in at build time:

| Variable | Asset | Behaviour if unset |
|---|---|---|
| `VITE_BRAIN_URL` | `brain.bin` (126 MB) | same-origin `/brain.bin` |
| `VITE_BRAIN_META_URL` | `brain.meta.json` | same-origin |
| `VITE_FLYBODY_BUNDLE_URL` | `flybody.bundle.bin` (140 MB) | same-origin |
| `VITE_HABITAT_MJB_URL` | compiled `habitat.mjb` (78 MB, optional) | if absent the body is compiled in the browser from the bundle with the habitat walls injected (`src/habitatFixtures.ts`); first load ~20 s slower, cached in IndexedDB afterwards |
| `VITE_VNC_URL`, `VITE_VNC_META_URL` | MANC nerve cord (lab page only) | same-origin |

Steps:

1. Host `brain.bin`, `brain.meta.json`, `flybody.bundle.bin` (and optionally `habitat.mjb`) on a bucket with public read and CORS `GET` from any origin (`r2-cors.json` is the Cloudflare R2 policy the upstream project uses; the `?v=<sha>` suffix from `public/assets.json` keeps them cacheable forever). `asset-receipts.json` lists the upstream public bucket that already serves the first three; use your own bucket for anything you publish, it is someone else's bandwidth.
2. In the Vercel project set the `VITE_*` variables above, keep `vercel.json` (build command `npm run build:vercel`, output `dist`, cache headers).
3. Push. Every page runs client-side; there are no functions.

Rehearsal without Vercel: build with the variables set, then `PORT=4180 npm run preview:habitat` and open http://127.0.0.1:4180/world.html. Verified 2026-09-16: boots from the bucket with the browser-compiled body, the fly ate at 18 s.

## Instruments

- **Spike strip** (top): named descending neurons (DNa01, DNa02, DNb01 "moonwalker", DNp01 giant fiber, DNp09, DNg13, MDN, DNp52) and six populations, 240 cycles of history.
- **Brain map** (right): every neuron at its measured position, colored by live rate. Click a cell for class, hemisphere, incoming synapse count and rate; **Pulse** injects 200 ms of input; **Disconnect** zeroes its incoming and outgoing edges on the GPU (inherited across generations); **Restore wiring** undoes all interventions. The six hottest cells are listed.
- **Every neuron, one pixel** (`src/matrix.ts`): all 139,255 cells as a 512-wide pixel matrix, grouped by population and hemisphere, repainted every cycle from the same rates that colour the 3D map.
- **Connectome matrix**: summed signed weight and edge count between every pair of populations, computed once from the measured CSR at boot (amber excitatory, teal inhibitory, log scale; hover for numbers). **Live drive** shows presynaptic mean rate × summed weight, an estimate, not a spike-resolved current.
- **What the fly senses**: the actual 64 × 16 retina render, its left/right optic drive, and the odor concentration at each antenna per channel.
- **Brain view**: auto-orbit, front/top/side/iso presets, show one population, hemisphere tint.
- **Populations**: left | right mean rates in Hz for lateral populations, single bars otherwise.
- **Learning**: last reward, steering advantage, goal values (Q + innate need), steering weights, manual ± reinforcement, learning freeze, navigation assist, synaptic strength (scales every measured weight), neural window.
- **Lineage** and **journal**: per-lifetime bars (reward) and line (deliveries), rows with cause of death, age, distance walked; the experience log.

Checkpoints autosave to local storage every few habitat seconds and on page hide, survive refresh, and export/import as JSON (latest 100 generations). Completed generations are also written to a separate IndexedDB archive and older pages can be loaded on demand. Browser storage can be cleared or evicted; this is not server persistence. Version-1 lineages from the earlier build are migrated (interoceptive weights kept, neural weights reset).

## Kernel notes

The gather over incoming edges dominates. Two changes matter on real hardware: neurons are dispatched in in-degree order (`src/schedule.ts`) so a workgroup is not held by one 10,356-edge row, and 16 lanes cooperate on each row so consecutive edges are read contiguously and reduced through workgroup memory. On the Iris Xe this took a 1 ms step from ~63 ms to ~15 ms (bench page: 0.23 → 1.0 G edges/s).

## What is measured, what is authored

Measured: wiring, weights' signs and magnitudes, neuron classes and positions, the body's meshes, joints and actuator layout. Authored: LIF constants and weight scaling, sensory encodings, the gait, the life rules, rewards, and both learners. Rewards are algorithmic signals, not simulated dopamine; the prepared KC→MBON edges are mostly zero-weight and are not presented as a functioning learning pathway (see `CONNECTOME-HOUSE.md`). This is a simulation informed by measured data, not a digital copy of a living fly.

## Validation

```powershell
npm run typecheck
node --experimental-strip-types --test --test-concurrency=2 tests-unit/*.test.ts
npm run build
node tools/probe-habitat.mjs http://127.0.0.1:4173/world.html 60000 shot.png
node tools/probe-bench.mjs
```

Unit tests cover parsers, the dispatch schedule, bilateral sensing, the steering learner, the goal readout, resource rules, death and hatching, checkpoint validation and migration. The probes open the real page in system Chrome with WebGPU and print the instruments; these are software checks, not biological validation.

Source attribution: [webgpu-fly](https://github.com/abgnydn/webgpu-fly), [FlyWire](https://flywire.ai), [flybody](https://github.com/TuragaLab/flybody), [MuJoCo](https://github.com/google-deepmind/mujoco), [Shiu et al. 2024 model](https://github.com/philshiu/Drosophila_brain_model). License files: `LICENSE`, `NOTICE`, `LICENSE-FLYBODY`.
