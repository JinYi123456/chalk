#!/usr/bin/env node
/**
 * Run the head-to-head and write eval/results.json plus a markdown table you can
 * paste straight into the write-up. Nothing here is hidden from the reader: the
 * answer key, the prompts and the scoring are all in the repo, so the numbers
 * can be recomputed.
 *
 *   node services/agent/scripts/benchmark.mjs                 # everything
 *   node services/agent/scripts/benchmark.mjs --kind=scope    # one task
 *   node services/agent/scripts/benchmark.mjs --arms=open-gemma-device,closed-flash
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARMS,
  VISION_CASES,
  SCOPE_CASES,
  runVisionArm,
  runScopeArm,
  heuristicScopeRun,
  summarise,
} from '../dist/lib/benchmark.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const kind = arg('kind', 'both');
const only = arg('arms', '');
const caseOnly = arg('cases', '');
const outFile = resolve(repo, arg('out', 'eval/results.json'));

const arms = only ? ARMS.filter((a) => only.split(',').includes(a.id)) : ARMS;
const vCases = caseOnly ? VISION_CASES.filter((c) => caseOnly.split(',').includes(c.id)) : VISION_CASES;
const sCases = caseOnly ? SCOPE_CASES.filter((c) => caseOnly.split(',').includes(c.id)) : SCOPE_CASES;

const pct = (x) => `${Math.round(x * 100)}%`;
const money = (x) => (x === null ? 'n/a' : `$${x.toFixed(4)}`);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

const runs = [];
const queue = [];
if (kind !== 'scope') for (const a of arms.filter((x) => x.vision)) for (const c of vCases) queue.push(['vision', a, c]);
if (kind !== 'vision') for (const a of arms) for (const c of sCases) queue.push(['scope', a, c]);

console.log(`${queue.length} calls · ${arms.length} arms · ${new Date().toISOString()}\n`);

for (const [k, arm, c] of queue) {
  const t0 = Date.now();
  const r = k === 'vision' ? await runVisionArm(arm, c) : await runScopeArm(arm, c);
  runs.push(r);
  const s = r.score;
  const extra =
    s && 'hallucinations' in s
      ? `usable ${pct(s.recall)} in-prose ${pct(s.textRecall)} (${s.seen}/${s.of})  invented ${s.hallucinations.length}${s.hallucinations.length ? ' ' + JSON.stringify(s.hallucinations) : ''}  captions ${s.captionCount}/${c.photos.length}`
      : s && 'matched' in s
        ? `usable ${pct(s.recall)} in-prose ${pct(s.textRecall)} (${s.matched}/${s.of})  invented ${s.invented.length}  hours ${s.hours} ${s.hoursOk ? 'in' : 'OUT'}  refs ${s.photoRefsOk ? 'y' : 'n'}`
        : '';
  console.log(
    `${r.ok ? 'ok  ' : 'MISS'} ${arm.id.padEnd(22)} ${c.id.padEnd(22)} ${secs(r.ms).padStart(7)}  tok ${String(r.inTokens + r.outTokens).padStart(5)}  ${extra}${r.error ? '  !' + r.error.slice(0, 70) : ''}  [${((Date.now() - t0) / 1000).toFixed(0)}s wall]`
  );
  // Be polite to free tiers: the whole point is that these are real endpoints.
  await new Promise((res) => setTimeout(res, 1200));
}

if (kind !== 'vision') for (const c of sCases) runs.push(heuristicScopeRun(c));

const vision = summarise(runs.filter((r) => r.score && 'hallucinations' in r.score), 'vision');
const scope = summarise(runs.filter((r) => r.score && 'precision' in r.score), 'scope');

const label = (id) => (id === 'none-heuristic' ? 'no model (deterministic floor)' : (ARMS.find((a) => a.id === id)?.label ?? id));
const weights = (id) => (id === 'none-heuristic' ? 'none' : (ARMS.find((a) => a.id === id)?.weights ?? '?'));
const where = (id) => (id === 'none-heuristic' ? 'this process' : (ARMS.find((a) => a.id === id)?.where ?? '?'));

const md = [];
md.push(`_Ran ${new Date().toISOString()} · ${queue.length} model calls · scoring is keyword-set recall against the answer key in \`services/agent/src/lib/benchmark.ts\`._`);
md.push('');
md.push('**usable** = the answer survived the product parser, so it could actually be quoted. **in-prose** = the same score read off the raw reply text before parsing. The gap is work the model knew but could not deliver in a form the product can price.');
if (vision.length) {
  md.push('', '### Eyes — read the walkthrough photos', '');
  md.push('| arm | weights | where | usable | in-prose | invented facts | caption counts | p50 | tokens/call | $/call |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const s of vision)
    md.push(
      `| ${label(s.arm)} | ${weights(s.arm)} | ${where(s.arm)} | ${s.answered}/${s.cases} · ${pct(s.recall)} | ${pct(s.textRecall)} | ${s.inventions} | ${pct(s.captionCountsOk)} | ${secs(s.p50ms)} | ${s.tokensPerCase} | ${money(s.costPerCase)} |`
    );
}
if (scope.length) {
  md.push('', '### Brain — itemize the scope', '');
  md.push('| arm | weights | where | usable | in-prose | invented lines | hours in band | photo refs | p50 | tokens/call | $/call |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of scope)
    md.push(
      `| ${label(s.arm)} | ${weights(s.arm)} | ${where(s.arm)} | ${s.answered}/${s.cases} · ${pct(s.recall)} | ${pct(s.textRecall)} | ${s.inventions} | ${pct(s.hoursInBand)} | ${pct(s.photoRefsOk)} | ${secs(s.p50ms)} | ${s.tokensPerCase} | ${money(s.costPerCase)} |`
    );
}

console.log('\n' + md.join('\n'));

await mkdir(dirname(outFile), { recursive: true });
await writeFile(
  outFile,
  JSON.stringify({ ranAt: new Date().toISOString(), kind, arms, runs, summary: { vision, scope } }, null, 1)
);
console.log(`\nwrote ${outFile}`);
