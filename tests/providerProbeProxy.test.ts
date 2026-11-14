import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { apiCallApi, type ApiCallRequest } from '../src/services/api/apiCall';
import {
  useConnectivityTest,
  type UseConnectivityTestArgs,
  type ConnectivityErrorMessages,
} from '../src/features/providers/sheets/forms/useConnectivityTest';
import { useModelDiscovery } from '../src/features/providers/sheets/forms/useModelDiscovery';
import { resolveProviderProbeAuth } from '../src/features/providers/sheets/forms/providerProbeAuth';
import type { ApiKeyEntryInput } from '../src/features/providers/types';

function captureHook<T>(hook: () => T): T {
  let result: T;
  function Harness() {
    result = hook();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result!;
}

const messages: ConnectivityErrorMessages = {
  baseUrlRequired: 'base required',
  endpointInvalid: 'invalid endpoint',
  apiKeyRequired: 'key required',
  modelRequired: 'model required',
  timeout: () => 'timeout',
  requestFailed: 'failed',
};
const success = { statusCode: 200, header: {}, bodyText: '', body: { data: [] } };
let requestSpy: ReturnType<typeof spyOn<typeof apiCallApi, 'request'>> | undefined;
afterEach(() => requestSpy?.mockRestore());

const args: UseConnectivityTestArgs = {
  brand: 'codex',
  baseUrl: 'https://upstream.example/v1',
  apiKey: 'fixture-key',
  proxyUrl: ' socks5://proxy.example:1080 ',
  models: [{ name: 'fixture-model', alias: '' }],
  formHeaders: [],
};

test('OpenAI unauthenticated discovery retry keeps the selected key proxy', async () => {
  const requests: ApiCallRequest[] = [];
  requestSpy = spyOn(apiCallApi, 'request').mockImplementation(async (request) => {
    requests.push(request);
    return requests.length === 1 ? { ...success, statusCode: 401 } : success;
  });
  const hook = captureHook(() =>
    useModelDiscovery({
      ...args,
      brand: 'openaiCompatibility',
      apiKeyEntries: [{ apiKey: 'fixture-key', proxyUrl: ' direct ' }],
    })
  );
  await hook.fetch();
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.proxy_url)).toEqual(['direct', 'direct']);
  expect(requests[0].header?.Authorization).toBe('Bearer fixture-key');
  expect(requests[1].header).toBeUndefined();
  expect(requests[1].authIndex).toBeUndefined();
});

describe('provider probes use persisted opaque auth indexes', () => {
  test('compatible probes keep selected indexes with their keys after edits and reordering', async () => {
    requestSpy = spyOn(apiCallApi, 'request').mockResolvedValue(success);
    const saved = {
      baseUrl: args.baseUrl,
      apiKeyEntries: [
        { sourceIndex: 3, apiKey: 'first', authIndex: 'opaque-first' },
        { sourceIndex: 8, apiKey: 'second', authIndex: 'opaque-second' },
      ],
    };
    const entries: ApiKeyEntryInput[] = [
      { sourceIndex: 8, apiKey: '', existingApiKey: 'second', proxyUrl: 'direct' },
      {
        sourceIndex: 3,
        apiKey: 'rotated',
        existingApiKey: 'first',
        authIndex: 'stale-draft',
        proxyUrl: 'http://key-proxy.example:8080',
      },
      { apiKey: 'first', authIndex: 'stale-draft', proxyUrl: '' },
    ];
    const input = {
      ...args,
      brand: 'openaiCompatibility' as const,
      ...resolveProviderProbeAuth({ ...args, apiKeyEntries: entries }, saved),
    };
    await captureHook(() => useConnectivityTest(input, messages)).runOpenAIAllKeys();
    await captureHook(() => useModelDiscovery(input)).fetch();
    const requests = requestSpy.mock.calls.map(([request]) => request);
    expect(requests.map((request) => request.authIndex)).toEqual([
      'opaque-second',
      undefined,
      undefined,
      'opaque-second',
    ]);
    expect(requests.map((request) => request.header?.Authorization)).toEqual([
      'Bearer second',
      'Bearer rotated',
      'Bearer first',
      'Bearer second',
    ]);
    expect(requests.map((request) => request.proxy_url)).toEqual([
      'direct',
      'http://key-proxy.example:8080',
      undefined,
      'direct',
    ]);
    for (const selected of [entries[1], entries[2]]) {
      requestSpy.mockClear();
      const draft = { ...args, apiKeyEntries: [selected] };
      const changed = { ...input, ...resolveProviderProbeAuth(draft, saved) };
      await captureHook(() => useConnectivityTest(changed, messages)).runOpenAIKey(0);
      await captureHook(() => useModelDiscovery(changed)).fetch();
      expect(requestSpy.mock.calls).toHaveLength(2);
      for (const [request] of requestSpy.mock.calls) {
        expect(request.authIndex).toBeUndefined();
        expect(request.header?.Authorization).toBe(`Bearer ${selected.apiKey}`);
      }
    }
    requestSpy.mockClear();
    const movedDraft = {
      ...args,
      baseUrl: 'https://changed.example/v1',
      apiKeyEntries: [entries[0]],
    };
    const moved = {
      ...input,
      baseUrl: movedDraft.baseUrl,
      ...resolveProviderProbeAuth(movedDraft, saved),
    };
    await captureHook(() => useConnectivityTest(moved, messages)).runOpenAIKey(0);
    await captureHook(() => useModelDiscovery(moved)).fetch();
    expect(requestSpy.mock.calls).toHaveLength(2);
    for (const [request] of requestSpy.mock.calls) {
      expect(request.authIndex).toBeUndefined();
      expect(request.header?.Authorization).toBe('Bearer second');
      expect(request.proxy_url).toBe('direct');
    }
  });

  test('keyless group index is shared only while the group remains keyless', async () => {
    requestSpy = spyOn(apiCallApi, 'request').mockResolvedValue(success);
    const saved = { baseUrl: args.baseUrl, apiKeyEntries: [], authIndex: 'opaque-keyless' };
    for (const apiKey of ['', 'added-key', '']) {
      requestSpy.mockClear();
      const draft = { ...args, apiKey: '', apiKeyEntries: [{ apiKey, proxyUrl: 'direct' }] };
      const input = {
        ...draft,
        brand: 'openaiCompatibility' as const,
        ...resolveProviderProbeAuth(draft, saved),
      };
      await captureHook(() => useConnectivityTest(input, messages)).runOpenAIKey(0);
      await captureHook(() => useModelDiscovery(input)).fetch();
      expect(requestSpy.mock.calls).toHaveLength(2);
      for (const [request] of requestSpy.mock.calls) {
        expect(request.authIndex).toBe(apiKey ? undefined : saved.authIndex);
        expect(request.header?.Authorization).toBe(apiKey ? `Bearer ${apiKey}` : undefined);
        expect(request.proxy_url).toBe('direct');
      }
    }
    for (const original of [saved, undefined]) {
      requestSpy.mockClear();
      const draft = {
        ...args,
        baseUrl: 'https://changed.example/v1',
        apiKey: '',
        apiKeyEntries: [{ apiKey: '', proxyUrl: 'direct' }],
      };
      const input = {
        ...draft,
        brand: 'openaiCompatibility' as const,
        ...resolveProviderProbeAuth(draft, original),
      };
      await captureHook(() => useConnectivityTest(input, messages)).runOpenAIKey(0);
      await captureHook(() => useModelDiscovery(input)).fetch();
      expect(requestSpy.mock.calls).toHaveLength(2);
      for (const [request] of requestSpy.mock.calls) {
        expect(request.authIndex).toBeUndefined();
        expect(request.header?.Authorization).toBeUndefined();
        expect(request.proxy_url).toBe('direct');
      }
    }
  });

  test('clearing a persisted proxy probes with current explicit credentials and no stale routing index', async () => {
    requestSpy = spyOn(apiCallApi, 'request').mockResolvedValue(success);
    const persisted = {
      baseUrl: args.baseUrl,
      apiKey: 'fixture-key',
      proxyUrl: 'http://saved-proxy.example:8080',
      authIndex: 'opaque-saved',
    };
    const draft = { ...args, apiKey: '', proxyUrl: '' };
    const input = { ...draft, ...resolveProviderProbeAuth(draft, persisted) };
    await captureHook(() => useConnectivityTest(input, messages)).runCodex();
    await captureHook(() => useModelDiscovery(input)).fetch();
    const group = {
      baseUrl: args.baseUrl,
      apiKeyEntries: [{ ...persisted, sourceIndex: 4 }],
    };
    const compatibleDraft = {
      ...draft,
      brand: 'openaiCompatibility' as const,
      apiKeyEntries: [
        {
          sourceIndex: 4,
          apiKey: '',
          existingApiKey: 'fixture-key',
          proxyUrl: '',
        },
      ],
    };
    const compatible = {
      ...compatibleDraft,
      ...resolveProviderProbeAuth(compatibleDraft, group),
    };
    await captureHook(() => useConnectivityTest(compatible, messages)).runOpenAIKey(0);
    await captureHook(() => useModelDiscovery(compatible)).fetch();
    expect(requestSpy.mock.calls).toHaveLength(4);
    for (const [request] of requestSpy.mock.calls) {
      expect(request.authIndex).toBeUndefined();
      expect(request.proxy_url).toBeUndefined();
      expect(request.header?.Authorization).toBe('Bearer fixture-key');
    }
  });
});

describe('OpenAI connectivity token limits (#572)', () => {
  const models = [
    { name: 'reasoner', alias: 'reasoning-alias', useMaxCompletionTokens: true },
    { name: 'legacy', alias: 'legacy-alias', useMaxCompletionTokens: false },
    { name: 'default', alias: '' },
    { name: 'alias-owner', alias: 'collision', useMaxCompletionTokens: true },
    { name: 'collision', alias: '', useMaxCompletionTokens: false },
    { name: ' Configured (high) ', alias: ' Friendly (low) ', useMaxCompletionTokens: true },
  ];

  test.each([
    ['reasoner', true],
    ['legacy', false],
    ['default', false],
    ['unknown', false],
    ['reasoning-alias', true],
    ['legacy-alias', false],
    ['collision', false],
    [' REASONER (high) ', true],
    [' REASONING-ALIAS(anything) ', true],
    ['configured', true],
    ['friendly', true],
    ['reasoner(unclosed', false],
    ['(high)', false],
    ['', true],
    ['   ', true],
    [undefined, true],
  ] as const)('selected model %s uses completion tokens: %s', async (testModel, completion) => {
    requestSpy = spyOn(apiCallApi, 'request').mockResolvedValue(success);
    const hook = captureHook(() =>
      useConnectivityTest(
        {
          ...args,
          brand: 'openaiCompatibility',
          testModel,
          models: [{ name: ' ', alias: 'ignored' }, ...models],
          apiKeyEntries: [{ apiKey: '', authIndex: 'fixture-auth', proxyUrl: ' direct ' }],
          formHeaders: [{ key: 'X-Probe', value: 'fixture' }],
        },
        messages
      )
    );
    expect(await hook.runOpenAIKey(0)).toBe(true);
    const [request, options] = requestSpy.mock.calls[0];
    expect(JSON.parse(request.data!)).toEqual({
      model: testModel?.trim() || 'reasoner',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
      ...(completion ? { max_completion_tokens: 5 } : { max_tokens: 5 }),
    });
    expect(request.authIndex).toBe('fixture-auth');
    expect(request.proxy_url).toBe('direct');
    expect(request.header).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer $TOKEN$',
      'X-Probe': 'fixture',
    });
    expect(options).toEqual({ timeout: 30_000 });
  });

  test('batch tests retain explicit authorization and use the selected model flag', async () => {
    requestSpy = spyOn(apiCallApi, 'request').mockResolvedValue(success);
    const hook = captureHook(() =>
      useConnectivityTest(
        {
          ...args,
          brand: 'openaiCompatibility',
          models,
          apiKeyEntries: [
            { apiKey: 'fixture-key', proxyUrl: 'direct' },
            { apiKey: '', existingApiKey: 'fixture-existing', proxyUrl: '' },
          ],
          formHeaders: [{ key: 'authorization', value: 'Bearer fixture-custom' }],
        },
        messages
      )
    );
    await hook.runOpenAIAllKeys();
    expect(requestSpy.mock.calls).toHaveLength(2);
    for (const [request] of requestSpy.mock.calls) {
      expect(request.header?.authorization).toBe('Bearer fixture-custom');
      expect(request.header?.Authorization).toBeUndefined();
      const body = JSON.parse(request.data!);
      expect(body.max_completion_tokens).toBe(5);
      expect(body).not.toHaveProperty('max_tokens');
    }
  });

  test('model token preference participates in the status reset signature', () => {
    // SSR does not run effects; guard the reset dependency with a source contract check.
    const source = readFileSync(
      'src/features/providers/sheets/forms/useConnectivityTest.ts',
      'utf8'
    );
    const signature = source.slice(
      source.indexOf('const signature = useMemo'),
      source.indexOf('const lastSignatureRef')
    );
    expect(signature).toContain('it.useMaxCompletionTokens === true');
    expect(source).toContain('if (lastSignatureRef.current === signature) return;');
  });
});
