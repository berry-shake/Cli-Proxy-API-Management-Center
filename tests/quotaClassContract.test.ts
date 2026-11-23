import { describe, expect, test } from 'bun:test';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';

describe('quota class contract', () => {
  test('the flagship quota badge has a static highlight', async () => {
    const css = await Bun.file(
      new URL('../src/features/quota/components/QuotaBody.module.scss', import.meta.url)
    ).text();
    const badge = css.match(/^\.elitePlanValue\s*\{([\s\S]*?)^\}/m)?.[1];
    expect(badge).toContain('at 50% 58%, var(--jade-glow)');
    expect(badge).not.toMatch(/\banimation(?:-name)?:/);
  });

  test('bindQuotaClasses reports every missing key rather than the first', () => {
    const partial = Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, `_${key}`]));
    delete partial.quotaReset;
    delete partial.quotaResetRelative;

    expect(() => bindQuotaClasses(partial, 'test-host')).toThrow(/quotaReset.*quotaResetRelative/);
  });
});
