// slim-dist.mjs — strip the 100 MB-class binaries from dist/ after `vite build`.
// Deployments (Vercel, Cloudflare Pages) serve those from a public bucket via
// VITE_*_URL; local builds keep them. Cross-platform replacement for `rm -rf`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const heavy = ['flybody', 'flybody.bundle.bin', 'brain.bin', 'brain.meta.json', 'vnc.bin', 'vnc.meta.json', 'habitat.mjb',
  'walking-policy.bin', 'walking-obs-norm.bin', 'walking-ref.bin', 'walking-policy-fixtures.json'];
let freed = 0;
for (const name of heavy) {
  const target = path.join(dist, name);
  if (!fs.existsSync(target)) continue;
  const stat = fs.statSync(target);
  freed += stat.isDirectory() ? 0 : stat.size;
  fs.rmSync(target, { recursive: true, force: true });
}
const remaining = fs.readdirSync(dist).map(f => ({ f, size: fs.statSync(path.join(dist, f)).size })).filter(x => x.size > 5e6);
if (remaining.length) { console.error('Files over 5 MB still in dist:', remaining); process.exit(1); }
console.log(`dist slimmed: removed ${(freed / 1e6).toFixed(0)} MB of heavy assets; nothing over 5 MB remains.`);
