import type { ApiKeyEntry } from '@/types';
import type { ApiKeyEntryInput } from '../../types';

interface SavedProbeConfig {
  baseUrl?: string;
  proxyUrl?: string;
  apiKey?: string;
  authIndex?: string;
  apiKeyEntries?: ApiKeyEntry[];
}

interface ProbeDraft {
  baseUrl: string;
  proxyUrl?: string;
  apiKey: string;
  apiKeyEntries?: ApiKeyEntryInput[];
}

/** Only a persisted, unchanged identity can address the backend credential manager. */
export function resolveProviderProbeAuth(draft: ProbeDraft, saved?: SavedProbeConfig) {
  const sameBase = saved !== undefined && draft.baseUrl.trim() === (saved.baseUrl ?? '').trim();
  // An omitted request proxy falls back to the matched credential's saved proxy.
  const clearedProxy = Boolean(saved?.proxyUrl?.trim() && !draft.proxyUrl?.trim());
  const fallbackApiKey = saved?.apiKey ?? '';
  const effectiveKey = draft.apiKey.trim() || fallbackApiKey.trim();
  const apiKeyEntries = draft.apiKeyEntries?.map((entry) => {
    const original =
      entry.sourceIndex === undefined
        ? undefined
        : saved?.apiKeyEntries?.find((item) => item.sourceIndex === entry.sourceIndex);
    const key = entry.apiKey.trim() || entry.existingApiKey?.trim() || '';
    const sameKey =
      original !== undefined &&
      entry.existingApiKey?.trim() === original.apiKey.trim() &&
      key === original.apiKey.trim();
    const clearedEntryProxy = Boolean(original?.proxyUrl?.trim() && !entry.proxyUrl.trim());
    return {
      ...entry,
      authIndex: sameBase && sameKey && !clearedEntryProxy ? original.authIndex : undefined,
    };
  });
  const sameIdentity =
    draft.apiKeyEntries !== undefined
      ? saved?.apiKeyEntries?.length === 0 &&
        !draft.apiKeyEntries.some((entry) => entry.apiKey.trim() || entry.existingApiKey?.trim())
      : effectiveKey === fallbackApiKey.trim();

  return {
    fallbackApiKey,
    authIndex: sameBase && sameIdentity && !clearedProxy ? saved?.authIndex : undefined,
    apiKeyEntries,
  };
}
