import { useCallback } from 'react';
import { calculateConfigApiKeyAuthIndex } from '@/utils/authIndex';
import type { ConfigApiKeyProvider } from '@/utils/authIndex';

type AuthFields = { apiKey: string; baseUrl?: string; proxyUrl?: string };

export function useResolveAuthIndex(
  provider: ConfigApiKeyProvider,
  configs: AuthFields[],
  form: AuthFields,
  editIndex: number | null
) {
  return useCallback(
    () =>
      calculateConfigApiKeyAuthIndex({
        provider,
        configs,
        current: {
          apiKey: form.apiKey,
          baseUrl: form.baseUrl,
          proxyUrl: form.proxyUrl,
        },
        currentIndex: editIndex,
      }),
    [provider, configs, editIndex, form.apiKey, form.baseUrl, form.proxyUrl]
  );
}
