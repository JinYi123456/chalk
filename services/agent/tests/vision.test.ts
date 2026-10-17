import { describe, expect, it } from 'vitest';
import { readSite } from '../src/lib/vision.js';

describe('readSite', () => {
  it('returns null with no photos rather than inventing a site', async () => {
    expect(await readSite([], 'deep_clean', 'a kitchen')).toBeNull();
  });
});
