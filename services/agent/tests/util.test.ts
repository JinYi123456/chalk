import { describe, expect, it } from 'vitest';
import { clamp, fixValidity, looseJson, money, stableStringify, stripThinking } from '../src/lib/util.js';

describe('looseJson', () => {
  it('parses plain JSON', () => {
    expect(looseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });
  it('scoops JSON out of prose', () => {
    expect(looseJson<{ a: number }>('Sure! Here you go: {"a": 2} hope that helps')).toEqual({ a: 2 });
  });
  it('scoops JSON out of a code fence', () => {
    expect(looseJson<{ a: number }>('```json\n{"a":3}\n```')).toEqual({ a: 3 });
  });
  it('ignores a thinking model that narrates first', () => {
    expect(looseJson<{ a: number }>('<thought>{wrong}</thought>{"a":4}')).toEqual({ a: 4 });
  });
  it('returns null on garbage', () => {
    expect(looseJson('not json at all')).toBeNull();
    expect(looseJson('')).toBeNull();
  });
});

describe('stripThinking', () => {
  it('removes closed and unclosed reasoning blocks', () => {
    expect(stripThinking('<thought>a</thought>kept')).toBe('kept');
    expect(stripThinking('kept<thinking>unclosed')).toBe('kept');
  });
});

describe('money / clamp', () => {
  it('never returns less than 1', () => {
    expect(money(0)).toBe(1);
    expect(money(-4)).toBe(1);
    expect(money(12.6)).toBe(13);
    expect(money(Number.NaN)).toBe(1);
  });
  it('clamps to the range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });
});

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });
  it('handles nested structures', () => {
    expect(stableStringify({ x: [1, { b: 1, a: 2 }] })).toBe(stableStringify({ x: [1, { a: 2, b: 1 }] }));
  });
});

describe('fixValidity', () => {
  it('rewrites a validity window the model invented', () => {
    expect(fixValidity('This quote is valid for 7 days.', 14)).toBe('This quote is valid for 14 days.');
    expect(fixValidity('The price holds until 3 days from now.', 14)).toBe('The price holds until 14 days from now.');
    expect(fixValidity('valid 5 day', 14)).toBe('valid 14 day');
  });
  it('leaves other numbers alone', () => {
    const msg = 'It takes 3 days of drying time. Pay 50% up front.';
    expect(fixValidity(msg, 14)).toBe(msg);
  });
});
