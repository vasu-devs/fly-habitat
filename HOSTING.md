# Shared simulation hosting assessment

The published app currently computes in each visitor's browser. Vercel hosts its static files. It does not yet run one shared fly, and no VPS has been provisioned.

## Proposed split

- Vercel keeps the existing website and personal `fly.siddhvasudev.com` domain.
- One server owns the brain, body, survival clock, learning and generation transitions. Browsers receive snapshots and activity streams instead of advancing their own copy.
- Server checkpoints and an append-only generation archive survive restarts. Public interventions need bounded requests and server validation so visitors cannot overwrite the shared weights or clock.
- Reconnecting viewers receive the current state and archive. A stale/offline indication must distinguish a lost connection from a paused or dead fly.

The CPU benchmark suggests a CPU host is worth testing first; see `PERFORMANCE.md`. Integration still requires a persistent CPU neural engine, compatible body/retinal computation, streaming, checkpoint recovery and a sustained load test. The existing benchmark alone is not that backend.

## Cost reference, checked September 16, 2026

[Hetzner's June 2026 pricing table](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) lists CX33 (4 vCPU, 8 GB RAM) at $9.99/month and CX43 (8 vCPU, 16 GB RAM) at $18.49/month in Germany/Finland. IPv4, tax, backups and availability may change the total. These use shared CPU; sustained performance must be measured. A **$10–25/month CPU trial budget** is plausible, not a guaranteed capacity estimate.

[Runpod's RTX A4000 page](https://www.runpod.io/gpu-models/rtx-a4000) advertises GPU compute from $0.25/hour, about $180 per 30 days if always on, before additional charges. A GPU rental is not the first recommendation given the CPU result.

[Vercel's June 2026 function-duration announcement](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes) permits up to 30 minutes for qualifying Node/Python functions, not an indefinite simulation daemon. Cron-triggered catch-up could produce an intermittent experiment, but does not satisfy continuous neural/body stepping.

Before provisioning, select the personal hosting account and authorize a monthly spending ceiling. No hosting purchase is part of the current deployment.
