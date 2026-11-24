import { describe, expect, test } from 'bun:test';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';

describe('quota class contract', () => {
  test('bindQuotaClasses reports every missing key rather than the first', () => {
    const partial = Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, `_${key}`]));
    delete partial.quotaReset;
    delete partial.quotaResetRelative;

    expect(() => bindQuotaClasses(partial, 'test-host')).toThrow(/quotaReset.*quotaResetRelative/);
  });
});
