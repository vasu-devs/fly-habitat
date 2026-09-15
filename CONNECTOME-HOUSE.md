# Connectome House — corrected scientific foundation

The interactive home is **[Fly Habitat](http://127.0.0.1:4173/world.html)** (`/world.html`): bilateral senses → the full FlyWire LIF brain → a learned steering policy and goal readout → the anatomical body, with hunger, sleep, death, eggs and inherited learning. See [HABITAT.md](HABITAT.md) for the control loop, instruments, run instructions and limits. The remainder of this file describes the separate circuit laboratory at `/lab.html`.

This separate app uses the actual prepared FlyWire and MANC wiring from `abgnydn/webgpu-fly`, with the TuragaLab Flybody anatomical meshes in MuJoCo. The earlier `../fly-house` toy is not used.

## Start locally

Requires Node 22+ and a WebGPU-capable current Chromium browser with hardware acceleration.

```powershell
npm ci
node tools/fetch-prepared-assets.mjs
npm run dev
```

Open http://127.0.0.1:4173/lab.html. First load reads about 300 MB and compiles the anatomical model; it may briefly pause while compiling. Browser caches subsequent loads. No API key, Python service or paid inference is required. Keep the terminal running while using the local app; Ctrl+C stops it.

## Try it

1. Select **Mixed sensory**, then **Run**. Brain colors, spike totals, population rates and named descending-neuron history come from new GPU readbacks every 10 simulated milliseconds. Wall-clock performance is shown separately.
2. Pause. Both neural and body clocks stop. Step advances both by 10 ms. No prerecorded activity is replayed as live.
3. Use **DNp09** or **MDN**, or select a neuron and give a 200 ms input pulse. Keyboard Q/W/E/R/A/S/F selects the labeled inputs. These keys stimulate neurons inside this app, not the host OS.
4. Inspect a cell and **Disconnect cell** to zero its incoming and outgoing functional weights. This resets dynamic state so earlier synaptic currents cannot masquerade as post-intervention firing. Restore original wiring for a comparison.
5. **Body vision** maps the rendered image's mean brightness to the optic population. This is a simplified authored sensory bridge, not reconstructed retinal circuitry.
6. The default **MANC muscle drive** maps measured motor-pool activity to three joint targets per leg. It has no gait oscillator or root-velocity assist. Coordinated walking is not guaranteed. **Assisted gait** visibly opts into an authored tripod gait, velocity assistance and attitude damping scaled by circuit activity.
7. Teaching pulses adjust gains of existing, co-active, nonzero KC→MBON edges. Save/restore synaptic checkpoints in local storage; download the experiment JSON with parameters, activity and recent event history.

## Scientific scope and important findings

- Brain: 139,255 neurons and 15,091,983 neuron-pair edges; these are weighted aggregated connections, not the raw synapse count. Positions are soma/centroid annotations; dots are not neurite reconstructions. Array indices shown in the UI are not biological root IDs.
- VNC: 23,188 neurons and 5,243,574 weighted edges. FlyWire brain and MANC are different specimens. The bridge matches available descending-neuron type names and averages each type; it is not a measured continuous brain-to-muscle reconstruction.
- Body: actual Flybody meshes, joints and physics. The compiled browser model reports its own segment and actuator counts in the event log. Mesh appearance is rendered; this is a simulation, not video of a living animal.
- Neuron dynamics: upstream alpha-synapse leaky integrate-and-fire WebGPU implementation, 1 ms steps, with empirically adjusted weights. This is informed by Shiu et al., not a claim to run their complete validated Brian2 setup unchanged. The kernel dispatches neurons in in-degree order with 16 cooperating lanes per row (see `src/schedule.ts`, `src/shaders/lif.wgsl`); results are numerically identical to the thread-per-row version, only faster.
- Prepared dataset audit found **62,261 KC→MBON edges: 62,248 have zero functional weight and 13 are inhibitory**. The app preserves those supplied signs and does not silently manufacture cholinergic KC output. Consequently its teaching control is a very limited synaptic experiment; it does not establish biological dopamine learning or learned household skills. Proper learning experiments require revisiting the source neurotransmitter annotations and physiological model first.
- The two networks and body advance equal simulated durations, but the circuit bridge uses window-averaged rates in 10 ms blocks rather than transmitting individual spikes at 1 ms precision.
- No human house routine, trained household behavior or one-to-one living digital fly is claimed. The habitat's learning lives in two explicit learners outside the measured graph (see HABITAT.md).

## Data provenance and licenses

`asset-receipts.json` records source URLs and verified SHA256 hashes. Downloader pins the prepared binary hashes from `public/assets.json`. Prepared assets came from the public bucket linked by the upstream app. License/attribution files `LICENSE`, `NOTICE`, `LICENSE-FLYBODY` are preserved. Upstream source remains in this folder for inspection; its original experiment pages are preserved separately.

- Browser implementation: https://github.com/abgnydn/webgpu-fly
- Research model: https://github.com/philshiu/Drosophila_brain_model
- FlyWire: https://flywire.ai
- Anatomical body: https://github.com/TuragaLab/flybody
- MuJoCo: https://github.com/google-deepmind/mujoco

## Validation

```powershell
npm run typecheck
node --experimental-strip-types --test --test-concurrency=2 tests-unit/*.test.ts
npm run build
```

The experimental learning tests verify sign preservation, eligibility, bounds, lesions, exact restoration and checkpoint validation. Browser checks are documented in `VALIDATION.md`.
