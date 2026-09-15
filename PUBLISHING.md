# Publishing Fly Habitat

Repository: `vasu-devs/fly-habitat` (public).

Vercel project: `fly-habitat`, scoped to `vasu-devs-projects-a637f703` under the personal account `siddhvasudev1402@gmail.com`.

Intended domain: `fly.siddhvasudev.com`. The root domain remains assigned to the personal portfolio. No company team or company domain is used.

## Reproducible assets

Large data/model files are release assets at the tag recorded in `release-assets.json`. `tools/fetch-release-assets.mjs` retrieves and validates every byte count and SHA-256 hash. Original upstream source URLs and licenses are recorded in `asset-receipts.json` and `NOTICE`.

Production builds download these files in Vercel's build environment and include them as same-origin static assets. Source uploads exclude local binaries via `.vercelignore`. This avoids both cross-origin browser failures and dependency on the original author's hosting bandwidth. No paid object-storage account is required.

The compiled habitat is tied to MuJoCo 3.8.0 WASM. Recompile and update release hashes when its runtime or fixture geometry changes. Publish a new versioned asset release instead of replacing an existing release's binaries.

## Deploy

```sh
npm ci
npm run test:unit
npx vercel --prod --scope vasu-devs-projects-a637f703
```

Vercel runs the checked-in `build:vercel` command. `.vercel/` and environment/credential files are excluded from Git. Only connect the public repo to the personal project for automatic deployments.

If custom-domain DNS is not yet configured, Vercel's project domain settings supply the CNAME target for `fly`. Add only that record in the `siddhvasudev.com` Cloudflare zone; do not change the apex, nameservers, or other projects' records.
