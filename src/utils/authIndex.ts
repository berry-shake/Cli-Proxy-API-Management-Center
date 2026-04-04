import type { ProviderKeyConfig } from '@/types';

export type ConfigApiKeyProvider = 'gemini' | 'claude' | 'codex';

type ProviderAuthInput = Pick<ProviderKeyConfig, 'apiKey' | 'baseUrl' | 'proxyUrl'>;

type ProviderAuthMeta = {
  kind: string;
  provider: string;
  sourcePrefix: string;
};

const CONFIG_API_KEY_PROVIDER_META: Record<ConfigApiKeyProvider, ProviderAuthMeta> = {
  gemini: {
    kind: 'gemini:apikey',
    provider: 'gemini',
    sourcePrefix: 'config:gemini',
  },
  claude: {
    kind: 'claude:apikey',
    provider: 'claude',
    sourcePrefix: 'config:claude',
  },
  codex: {
    kind: 'codex:apikey',
    provider: 'codex',
    sourcePrefix: 'config:codex',
  },
};

const textEncoder = new TextEncoder();

const normalizeOptionalString = (value: unknown) => String(value ?? '').trim();

const normalizeProviderAuthInput = (value: ProviderAuthInput) => ({
  apiKey: normalizeOptionalString(value.apiKey),
  baseUrl: normalizeOptionalString(value.baseUrl),
  proxyUrl: normalizeOptionalString(value.proxyUrl),
});

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256Bytes = async (value: string): Promise<Uint8Array> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return new Uint8Array(digest);
};

const materializeConfigListWithCurrent = (
  configs: ProviderAuthInput[],
  current: ProviderAuthInput,
  currentIndex?: number | null
) => {
  const normalizedConfigs = configs.map((item) => normalizeProviderAuthInput(item));
  const normalizedCurrent = normalizeProviderAuthInput(current);

  if (
    currentIndex === undefined ||
    currentIndex === null ||
    currentIndex < 0 ||
    currentIndex >= normalizedConfigs.length
  ) {
    return {
      targetIndex: normalizedConfigs.length,
      configs: [...normalizedConfigs, normalizedCurrent],
    };
  }

  return {
    targetIndex: currentIndex,
    configs: normalizedConfigs.map((item, index) => (index === currentIndex ? normalizedCurrent : item)),
  };
};

const buildSource = async (
  provider: ConfigApiKeyProvider,
  configs: ProviderAuthInput[],
  targetIndex: number
) => {
  const meta = CONFIG_API_KEY_PROVIDER_META[provider];
  const seenTokenCounts = new Map<string, number>();

  // Only iterate up to targetIndex — entries after it don't affect the token.
  for (let index = 0; index <= targetIndex; index += 1) {
    const item = configs[index];
    const tokenSeed = [meta.kind, item.apiKey, item.baseUrl].join('\0');
    const tokenBase = toHex(await sha256Bytes(tokenSeed)).slice(0, 12);
    const duplicateCount = seenTokenCounts.get(tokenBase) ?? 0;
    seenTokenCounts.set(tokenBase, duplicateCount + 1);

    if (index === targetIndex) {
      const token = duplicateCount === 0 ? tokenBase : `${tokenBase}-${duplicateCount}`;
      return `${meta.sourcePrefix}[${token}]`;
    }
  }

  return '';
};

export async function calculateConfigApiKeyAuthIndex(params: {
  provider: ConfigApiKeyProvider;
  configs: ProviderAuthInput[];
  current: ProviderAuthInput;
  currentIndex?: number | null;
}): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) {
    return undefined;
  }

  try {
    const { provider, configs, current, currentIndex } = params;
    const meta = CONFIG_API_KEY_PROVIDER_META[provider];
    const materialized = materializeConfigListWithCurrent(configs, current, currentIndex);
    const target = materialized.configs[materialized.targetIndex];
    const source = await buildSource(provider, materialized.configs, materialized.targetIndex);

    // Seed format must stay aligned with the backend auth_index calculation.
    // Fields are joined with \0 (null byte) to avoid collisions from values
    // that contain the delimiter characters (e.g. '=' or '|').
    const seedParts = [`provider=${meta.provider}`];
    if (target.baseUrl) seedParts.push(`base=${target.baseUrl}`);
    if (target.proxyUrl) seedParts.push(`proxy=${target.proxyUrl}`);
    if (target.apiKey) seedParts.push(`api_key=${target.apiKey}`);
    if (source) seedParts.push(`source=${source}`);

    const seed = `config:${seedParts.join('\0')}`;
    return toHex((await sha256Bytes(seed)).slice(0, 8));
  } catch (error) {
    console.warn('Failed to calculate config auth_index:', error);
    return undefined;
  }
}
