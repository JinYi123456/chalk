// The stored benchmark run is data, not code, but the deployed function may
// only read what sits inside its own bundle. Copy it beside the compiled agent
// so /api/benchmark answers with the real table instead of the "no run" card.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = resolve(repo, 'eval', 'results.json');
const dest = resolve(repo, 'services', 'agent', 'dist', 'eval', 'results.json');

if (!existsSync(src)) {
  console.log('chalk: no eval/results.json to bundle — /api/benchmark will report the gap');
} else {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`chalk: bundled ${src.replace(repo + '/', '')} → ${dest.replace(repo + '/', '')}`);
}
