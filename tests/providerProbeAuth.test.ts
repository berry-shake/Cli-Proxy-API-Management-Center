import { describe, expect, test } from 'bun:test';
import { resolveProviderProbeAuth } from '../src/features/providers/sheets/forms/providerProbeAuth';
import type { ApiKeyEntryInput } from '../src/features/providers/types';

const baseUrl = 'https://upstream.example/v1';
const saved = { baseUrl, apiKey: 'fixture-key', authIndex: 'opaque/server/index' };
const blank = { apiKey: '', proxyUrl: '' };
const entries: ApiKeyEntryInput[] = [
  { ...blank, sourceIndex: 2, existingApiKey: 'first', authIndex: 'untrusted-draft-index' },
  { ...blank, sourceIndex: 7, existingApiKey: 'second' },
];
const group = {
  baseUrl,
  authIndex: 'must-not-replace-a-key-index',
  apiKeyEntries: [
    { sourceIndex: 2, apiKey: 'first', authIndex: 'opaque-first' },
    { sourceIndex: 7, apiKey: 'second', authIndex: 'opaque-second' },
  ],
};
const resolveEntries = (apiKeyEntries: ApiKeyEntryInput[], url = baseUrl) =>
  resolveProviderProbeAuth({ baseUrl: url, apiKey: '', apiKeyEntries }, group);

describe('persisted provider probe identity', () => {
  test('uses the opaque saved index only for an unchanged or restored identity', () => {
    for (const apiKey of ['', 'fixture-key', ' fixture-key ']) {
      expect(resolveProviderProbeAuth({ baseUrl, apiKey }, saved).authIndex).toBe(saved.authIndex);
    }
    expect(
      resolveProviderProbeAuth({ baseUrl, apiKey: 'rotated' }, saved).authIndex
    ).toBeUndefined();
    const changedBase = resolveProviderProbeAuth(
      { baseUrl: `${baseUrl}/other`, apiKey: '' },
      saved
    );
    expect(changedBase.authIndex).toBeUndefined();
    expect(changedBase.fallbackApiKey).toBe(saved.apiKey);
    expect(resolveProviderProbeAuth({ baseUrl, apiKey: '' }, saved).authIndex).toBe(
      saved.authIndex
    );
    expect(resolveProviderProbeAuth({ baseUrl, apiKey: 'fixture-key' }).authIndex).toBeUndefined();
    expect(
      resolveProviderProbeAuth({ baseUrl, apiKey: '' }, { ...saved, authIndex: undefined })
        .authIndex
    ).toBeUndefined();
  });

  test('clearing a saved proxy drops its routing index without losing the explicit key', () => {
    const persisted = { ...saved, proxyUrl: 'http://saved-proxy.example:8080' };
    for (const proxyUrl of ['', '   ']) {
      const resolved = resolveProviderProbeAuth({ baseUrl, apiKey: '', proxyUrl }, persisted);
      expect(resolved.authIndex).toBeUndefined();
      expect(resolved.fallbackApiKey).toBe(saved.apiKey);
    }
    for (const proxyUrl of [persisted.proxyUrl, 'direct', 'http://changed-proxy.example:8080']) {
      expect(resolveProviderProbeAuth({ baseUrl, apiKey: '', proxyUrl }, persisted).authIndex).toBe(
        saved.authIndex
      );
    }
  });

  test('clearing a compatible key proxy invalidates only that key routing index', () => {
    const persisted = {
      ...group,
      apiKeyEntries: group.apiKeyEntries.map((entry) => ({
        ...entry,
        proxyUrl: 'http://saved-proxy.example:8080',
      })),
    };
    const draftEntries = [
      { ...entries[0], proxyUrl: '' },
      { ...entries[1], proxyUrl: 'direct' },
    ];
    const resolved = resolveProviderProbeAuth(
      {
        baseUrl,
        apiKey: '',
        apiKeyEntries: draftEntries,
      },
      persisted
    );
    expect(resolved.apiKeyEntries?.map((entry) => entry.authIndex)).toEqual([
      undefined,
      'opaque-second',
    ]);
    expect(resolved.apiKeyEntries?.[0].existingApiKey).toBe('first');
    draftEntries[0].proxyUrl = persisted.apiKeyEntries[0].proxyUrl;
    expect(
      resolveProviderProbeAuth(
        {
          baseUrl,
          apiKey: '',
          apiKeyEntries: draftEntries,
        },
        persisted
      ).apiKeyEntries?.[0].authIndex
    ).toBe('opaque-first');
  });

  test('selects per-key indexes by persisted source identity, not position or draft index', () => {
    expect(
      resolveEntries([entries[1], entries[0]]).apiKeyEntries?.map((entry) => entry.authIndex)
    ).toEqual(['opaque-second', 'opaque-first']);
    expect(resolveEntries([entries[1]]).apiKeyEntries?.[0].authIndex).toBe('opaque-second');
    expect(resolveEntries(entries).authIndex).toBeUndefined();
  });

  test('invalidates edited and new keys independently and restores the original index', () => {
    const changed = resolveEntries([
      { ...entries[0], apiKey: 'rotated' },
      { ...blank, apiKey: 'first', authIndex: 'opaque-first' },
      entries[1],
    ]);
    expect(changed.apiKeyEntries?.map((entry) => entry.authIndex)).toEqual([
      undefined,
      undefined,
      'opaque-second',
    ]);
    expect(resolveEntries([{ ...entries[0], apiKey: 'first' }]).apiKeyEntries?.[0].authIndex).toBe(
      'opaque-first'
    );
    expect(
      resolveEntries([{ ...entries[0], sourceIndex: 7 }]).apiKeyEntries?.[0].authIndex
    ).toBeUndefined();
  });

  test('group base changes invalidate every per-key identity without losing credentials or proxies', () => {
    const drafts = entries.map((entry) => ({ ...entry, proxyUrl: 'direct' }));
    const changed = resolveEntries(drafts, 'https://changed.example/v1');
    expect(changed.apiKeyEntries).toEqual(
      drafts.map((entry) => ({ ...entry, authIndex: undefined }))
    );
    expect(resolveEntries(drafts).apiKeyEntries?.map((entry) => entry.authIndex)).toEqual([
      'opaque-first',
      'opaque-second',
    ]);
  });

  test('keyless group identity does not follow added keys or a changed base', () => {
    const keyless = { baseUrl, apiKeyEntries: [], authIndex: 'opaque-keyless-group' };
    const draft = { baseUrl, apiKey: '', apiKeyEntries: [blank] };
    expect(resolveProviderProbeAuth(draft, keyless).authIndex).toBe(keyless.authIndex);
    expect(resolveProviderProbeAuth({ ...draft, apiKeyEntries: [] }, keyless).authIndex).toBe(
      keyless.authIndex
    );
    const added = resolveProviderProbeAuth(
      {
        ...draft,
        apiKeyEntries: [{ ...blank, apiKey: 'new-key', authIndex: keyless.authIndex }],
      },
      keyless
    );
    expect(added.authIndex).toBeUndefined();
    expect(added.apiKeyEntries?.[0].authIndex).toBeUndefined();
    expect(
      resolveProviderProbeAuth({ ...draft, baseUrl: `${baseUrl}/other` }, keyless).authIndex
    ).toBeUndefined();
    expect(resolveProviderProbeAuth(draft, keyless).authIndex).toBe(keyless.authIndex);
  });

  test('removing every saved key cannot turn a keyed resource into the saved keyless identity', () => {
    expect(resolveEntries([]).authIndex).toBeUndefined();
    expect(resolveEntries([blank]).authIndex).toBeUndefined();
  });
});
