import type { ModelPrice } from '@/utils/usage';

const TOKENS_PER_PRICE_UNIT = 1_000_000;

export const MODEL_PRICE_REMOTE_PRIMARY_URL =
  'https://raw.githubusercontent.com/berry-shake/Cli-Proxy-API-Management-Center/refs/heads/sync_upstream/model_prices.json';
export const MODEL_PRICE_REMOTE_FALLBACK_URL =
  'https://raw.githubusercontent.com/Wei-Shaw/model-price-repo/refs/heads/main/model_prices_and_context_window.json';
export const MODEL_PRICE_REMOTE_URL = MODEL_PRICE_REMOTE_PRIMARY_URL;
export const MODEL_PRICE_REMOTE_URLS = [
  MODEL_PRICE_REMOTE_PRIMARY_URL,
  MODEL_PRICE_REMOTE_FALLBACK_URL,
] as const;

export interface RemoteModelPricesResult {
  prices: Record<string, ModelPrice>;
  importedCount: number;
  sourceUrl: string;
  sourceUrls?: string[];
  primaryUrl?: string;
  fallbackUrl?: string;
}

type PriceScale = 'perToken' | 'perMillion';

interface PriceFieldDefinition {
  keys: string[];
  scale: PriceScale;
}

const PROMPT_PRICE_FIELDS: PriceFieldDefinition[] = [
  {
    keys: ['input_cost_per_token', 'prompt_cost_per_token', 'input_price_per_token'],
    scale: 'perToken',
  },
  {
    keys: [
      'input_cost_per_1m_tokens',
      'prompt_cost_per_1m_tokens',
      'input_price_per_1m',
      'prompt_price_per_1m',
      'input',
      'prompt',
      'input_price',
      'prompt_price',
    ],
    scale: 'perMillion',
  },
];

const COMPLETION_PRICE_FIELDS: PriceFieldDefinition[] = [
  {
    keys: ['output_cost_per_token', 'completion_cost_per_token', 'output_price_per_token'],
    scale: 'perToken',
  },
  {
    keys: [
      'output_cost_per_1m_tokens',
      'completion_cost_per_1m_tokens',
      'output_price_per_1m',
      'completion_price_per_1m',
      'output',
      'completion',
      'output_price',
      'completion_price',
    ],
    scale: 'perMillion',
  },
];

const CACHE_PRICE_FIELDS: PriceFieldDefinition[] = [
  {
    keys: [
      'cache_read_input_token_cost',
      'cache_read_cost_per_token',
      'cache_price_per_token',
      'cached_input_cost_per_token',
      'cache_hit_cost_per_token',
    ],
    scale: 'perToken',
  },
  {
    keys: [
      'cache_read_input_cost_per_1m_tokens',
      'cache_read_price_per_1m',
      'cache_price_per_1m',
      'cached_input_cost_per_1m_tokens',
      'cache_hit_price_per_1m',
      'cache_read',
      'cache_hit',
      'cache',
      'cache_price',
      'cache_read_price',
    ],
    scale: 'perMillion',
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizePrice = (value: number): number =>
  Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;

const toPerMillionPrice = (value: unknown, scale: PriceScale): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return normalizePrice(scale === 'perToken' ? numeric * TOKENS_PER_PRICE_UNIT : numeric);
};

const readFirstPrice = (
  record: Record<string, unknown>,
  definitions: PriceFieldDefinition[]
): number | null => {
  for (const definition of definitions) {
    for (const key of definition.keys) {
      const normalized = toPerMillionPrice(record[key], definition.scale);
      if (normalized !== null) {
        return normalized;
      }
    }
  }
  return null;
};

const extractModelName = (entry: Record<string, unknown>): string => {
  const candidates = [entry.model, entry.model_name, entry.name, entry.id];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
};

const unwrapRemotePayload = (payload: unknown): unknown => {
  const payloadRecord = isRecord(payload) ? payload : null;
  if (!payloadRecord) {
    return payload;
  }

  const nestedCandidates = [
    payloadRecord.models,
    payloadRecord.model_prices,
    payloadRecord.model_pricing,
    payloadRecord.pricing,
    payloadRecord.prices,
    payloadRecord.data,
  ];
  for (const candidate of nestedCandidates) {
    if (Array.isArray(candidate) || isRecord(candidate)) {
      return candidate;
    }
  }

  return payload;
};

const resolvePricingRecord = (entryRecord: Record<string, unknown>): Record<string, unknown> => {
  const nestedCandidates = [
    entryRecord.pricing,
    entryRecord.prices,
    entryRecord.price,
    entryRecord.cost,
    entryRecord.costs,
    entryRecord.token_pricing,
  ];

  for (const candidate of nestedCandidates) {
    if (isRecord(candidate)) {
      return {
        ...candidate,
        ...entryRecord,
      };
    }
  }

  return entryRecord;
};

const convertEntryToModelPrice = (entry: unknown): ModelPrice | null => {
  const entryRecord = isRecord(entry) ? entry : null;
  if (!entryRecord) {
    return null;
  }

  const pricingRecord = resolvePricingRecord(entryRecord);
  const prompt = readFirstPrice(pricingRecord, PROMPT_PRICE_FIELDS);
  const completion = readFirstPrice(pricingRecord, COMPLETION_PRICE_FIELDS);
  const cache = readFirstPrice(pricingRecord, CACHE_PRICE_FIELDS);

  if (prompt === null && completion === null && cache === null) {
    return null;
  }

  const resolvedPrompt = prompt ?? 0;
  return {
    prompt: resolvedPrompt,
    completion: completion ?? 0,
    cache: cache ?? resolvedPrompt,
  };
};

const addModelNameCandidate = (target: Set<string>, value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    return;
  }
  target.add(normalized);
};

const getModelNameCandidates = (value: string): string[] => {
  const candidates = new Set<string>();
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  addModelNameCandidate(candidates, trimmed);

  const withoutModelsPrefix = trimmed.replace(/^models\//i, '');
  addModelNameCandidate(candidates, withoutModelsPrefix);

  const slashParts = withoutModelsPrefix.split('/').filter(Boolean);
  if (slashParts.length > 1) {
    addModelNameCandidate(candidates, slashParts.slice(1).join('/'));
    addModelNameCandidate(candidates, slashParts[slashParts.length - 1]);
  }

  const withoutLatestSuffix = withoutModelsPrefix.replace(/-latest$/i, '');
  if (withoutLatestSuffix !== withoutModelsPrefix) {
    addModelNameCandidate(candidates, withoutLatestSuffix);
  }

  return Array.from(candidates);
};

const buildRemoteAliasLookup = (remotePrices: Record<string, ModelPrice>): Map<string, string> => {
  const lookup = new Map<string, string>();

  Object.keys(remotePrices).forEach((remoteName) => {
    getModelNameCandidates(remoteName).forEach((candidate) => {
      const existing = lookup.get(candidate);
      if (
        !existing ||
        remoteName.length < existing.length ||
        (remoteName.length === existing.length && remoteName.localeCompare(existing) < 0)
      ) {
        lookup.set(candidate, remoteName);
      }
    });
  });

  return lookup;
};

export function convertRemoteModelPrices(payload: unknown): Record<string, ModelPrice> {
  const unwrappedPayload = unwrapRemotePayload(payload);
  const result: Record<string, ModelPrice> = {};

  if (Array.isArray(unwrappedPayload)) {
    unwrappedPayload.forEach((entry) => {
      const entryRecord = isRecord(entry) ? entry : null;
      if (!entryRecord) {
        return;
      }

      const modelName = extractModelName(entryRecord);
      const price = convertEntryToModelPrice(entryRecord);
      if (!modelName || !price) {
        return;
      }

      result[modelName] = price;
    });
    return result;
  }

  if (!isRecord(unwrappedPayload)) {
    return result;
  }

  Object.entries(unwrappedPayload).forEach(([modelName, entry]) => {
    const price = convertEntryToModelPrice(entry);
    if (!modelName || !price) {
      return;
    }

    result[modelName] = price;
  });

  return result;
}

export function matchRemoteModelPrices(
  modelNames: string[],
  remotePrices: Record<string, ModelPrice>
): Record<string, ModelPrice> {
  if (!modelNames.length || !Object.keys(remotePrices).length) {
    return {};
  }

  const exactCaseInsensitiveLookup = new Map<string, string>(
    Object.keys(remotePrices).map((modelName) => [modelName.toLowerCase(), modelName])
  );
  const aliasLookup = buildRemoteAliasLookup(remotePrices);

  return modelNames.reduce<Record<string, ModelPrice>>((accumulator, rawModelName) => {
    const modelName = rawModelName.trim();
    if (!modelName) {
      return accumulator;
    }

    let remoteModelName = remotePrices[modelName] ? modelName : undefined;
    if (!remoteModelName) {
      remoteModelName = exactCaseInsensitiveLookup.get(modelName.toLowerCase());
    }

    if (!remoteModelName) {
      remoteModelName = getModelNameCandidates(modelName)
        .map((candidate) => aliasLookup.get(candidate))
        .find(Boolean);
    }

    if (remoteModelName) {
      accumulator[modelName] = remotePrices[remoteModelName];
    }

    return accumulator;
  }, {});
}

async function fetchRemoteModelPricesFromUrl(
  sourceUrl: string,
  signal?: AbortSignal
): Promise<RemoteModelPricesResult> {
  const response = await fetch(sourceUrl, {
    method: 'GET',
    signal,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  const prices = convertRemoteModelPrices(payload);
  const importedCount = Object.keys(prices).length;

  if (!importedCount) {
    throw new Error('No pricing entries found in remote payload');
  }

  return {
    prices,
    importedCount,
    sourceUrl,
    sourceUrls: [sourceUrl],
  };
}

export async function fetchRemoteModelPrices(
  signal?: AbortSignal
): Promise<RemoteModelPricesResult> {
  const primaryResult = await fetchRemoteModelPricesFromUrl(
    MODEL_PRICE_REMOTE_PRIMARY_URL,
    signal
  ).catch(() => null);
  const fallbackResult = await fetchRemoteModelPricesFromUrl(
    MODEL_PRICE_REMOTE_FALLBACK_URL,
    signal
  ).catch(() => null);

  if (!primaryResult && !fallbackResult) {
    throw new Error('Failed to fetch remote model prices');
  }

  const mergedPrices = {
    ...(fallbackResult?.prices ?? {}),
    ...(primaryResult?.prices ?? {}),
  };

  return {
    prices: mergedPrices,
    importedCount: Object.keys(mergedPrices).length,
    sourceUrl: primaryResult?.sourceUrl || fallbackResult?.sourceUrl || MODEL_PRICE_REMOTE_URL,
    sourceUrls: [
      ...(primaryResult?.sourceUrl ? [primaryResult.sourceUrl] : []),
      ...(fallbackResult?.sourceUrl ? [fallbackResult.sourceUrl] : []),
    ],
    primaryUrl: primaryResult?.sourceUrl,
    fallbackUrl: fallbackResult?.sourceUrl,
  };
}
