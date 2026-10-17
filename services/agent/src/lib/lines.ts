import type { JobScope, QuoteLine } from './types.js';
import { money } from './util.js';

/**
 * The AI writes the words; this function does the arithmetic. Line items are
 * allocated from the real total so the numbers a client sees always add up.
 */
export function buildLines(scope: JobScope, total: number, materialsCost: number): QuoteLine[] {
  const weighted = scope.tasks.map((t) => ({
    task: t,
    w: t.hours * (0.7 + t.complexity * 0.15),
  }));
  const wsum = weighted.reduce((s, x) => s + x.w, 0) || 1;
  const laborPool = Math.max(total - materialsCost, total * 0.3);

  const lines: QuoteLine[] = weighted.map(({ task, w }) => {
    const amount = laborPool * (w / wsum);
    return {
      label: task.label,
      detail: `${task.hours}h · complexity ${task.complexity}/5`,
      qty: task.hours,
      unit: 'hour',
      unitPrice: money(amount / Math.max(task.hours, 0.25)),
      total: money(amount),
      kind: 'labor' as const,
      // The photo the scope attributed this work to. Carried through untouched so
      // the client's quote can show the work beside the picture of it.
      ...(task.photo ? { photo: task.photo } : {}),
    };
  });

  if (scope.materials.length > 0 || materialsCost > 0) {
    const detail = scope.materials.map((m) => m.label).slice(0, 3).join(', ') || 'consumables and supplies';
    lines.push({
      label: 'Materials and consumables',
      detail: detail.slice(0, 90),
      qty: 1,
      unit: 'job',
      unitPrice: money(materialsCost || 1),
      total: money(materialsCost || 1),
      kind: 'materials',
    });
  }

  // Fix rounding drift on the largest labor line so the sum is exact.
  const sum = lines.reduce((s, l) => s + l.total, 0);
  const drift = total - sum;
  if (drift !== 0 && lines.length > 0) {
    const target = lines.find((l) => l.kind === 'labor') ?? lines[0];
    target.total = Math.max(1, target.total + drift);
    if (target.unit === 'hour') target.unitPrice = money(target.total / Math.max(target.qty, 0.25));
  }
  return lines;
}

export function sumLines(lines: QuoteLine[]): number {
  return lines.reduce((s, l) => s + l.total, 0);
}
