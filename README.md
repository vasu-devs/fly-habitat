# Fly Habitat

A fruit-fly connectome experiment in a 3D home: measured FlyWire wiring simulated on WebGPU, an anatomical flybody running in MuJoCo, learned steering and goal selection, and a lineage that carries learning across lifetimes.

**[Open the habitat](https://fly.siddhvasudev.com/world.html)** · **[Website](https://fly.siddhvasudev.com)** · **[Model and controls](HABITAT.md)** · **[Circuit laboratory](CONNECTOME-HOUSE.md)**

## Explore

- Follow the fly as it finds food and water, rests, collects pollen, tends a nursery, lays eggs and dies.
- Inspect all 139,255 neurons in a 3D brain map or pixel matrix, watch named descending neurons spike, and inspect population-level connectivity.
- Give reinforcement, freeze learning, alter synaptic strength, pulse a neuron or disconnect it.
- Compare lifetimes and export/import learned weights, wiring interventions and experience history.

The app runs in the browser. Use a current Chrome or Edge with WebGPU and hardware acceleration. First load downloads scientific models totaling hundreds of megabytes; speed depends on your GPU. No API key or remote inference service is required.

## Run locally

Requires Node.js 22.18 or later.

```sh
npm ci
node tools/fetch-release-assets.mjs
npm run dev
```

Open `http://127.0.0.1:4173`. The versioned data/model release is verified against SHA-256 hashes in [`release-assets.json`](release-assets.json). It includes the precompiled habitat, so local use does not require parsing the original OBJ bundle again.

To rebuild the anatomical habitat from its original model bundle:

```sh
node --experimental-strip-types tools/compile-habitat.mjs
```

## Measured and modeled

The measured inputs are the FlyWire v783 wiring graph, neuron annotations and positions, and the flybody meshes and joint layout. LIF dynamics, sensory encodings, gait assistance, physiology, reinforcement and inheritance are authored models. The whole-organism coupling has not been biologically validated; this is not a one-to-one living digital fly. More generations do not guarantee improvement. See [HABITAT.md](HABITAT.md) and [LIMITATIONS.md](LIMITATIONS.md).

The habitat has two online learners: a steering policy over bilateral neural activity and a goal readout over needs and neural population responses. Resource effects require proximity. Memories and learned parameters are artificially inherited between simulated generations.

## Project layout

| Path | Purpose |
| --- | --- |
| `world.html`, `src/world.ts` | Habitat and experiment controls |
| `src/life.ts`, `src/steer.ts`, `src/senses.ts` | Physiology, learning and sensory adapters |
| `src/sim.ts`, `src/shaders/` | Full-connectome WebGPU simulation |
| `src/physics.ts`, `src/room.ts`, `src/habitat.ts` | MuJoCo anatomy and Three.js world |
| `lab.html` | Circuit experiments and MANC nerve-cord bridge |
| `tests-unit/`, `tests/` | Software validation |
| `legacy/fly-house/` | Preserved early artificial-agent prototype; not deployed |
| `UPSTREAM-README.md`, `research.html` | Preserved upstream documentation |

## Checks and deployment

```sh
npm run test:unit
npm run typecheck
npm run build
```

Vercel uses `npm run build:vercel`: it downloads this repository's versioned release assets, verifies them, builds the site and serves those assets from the same origin. Binary data is kept in GitHub Releases rather than bloating Git history. See [PUBLISHING.md](PUBLISHING.md).

## Attribution and license

This project extends **[webgpu-fly](https://github.com/abgnydn/webgpu-fly)** by Ahmet Barış Günaydın. Its source history, MIT license and notices are preserved. The habitat extensions are maintained by [vasu-devs](https://github.com/vasu-devs).

- Code: [MIT](LICENSE).
- [TuragaLab flybody](https://github.com/TuragaLab/flybody) and [MuJoCo](https://github.com/google-deepmind/mujoco): [Apache 2.0](LICENSE-FLYBODY).
- [FlyWire](https://flywire.ai) and [Janelia MANC](https://www.janelia.org/project-team/flyem/manc-connectome) data and the published walking policy: their respective CC BY terms.

See [NOTICE](NOTICE) for source attribution and licensing of data/model derivatives, and [asset-receipts.json](asset-receipts.json) for original prepared-data provenance. The MIT code license does not relicense those data or model assets.
