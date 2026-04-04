import { useCallback } from 'react';
import type { ProviderKeyConfig } from '@/types';
import { calculateConfigApiKeyAuthIndex } from '@/utils/authIndex';

type ConfigApiKeyProvider = 'claude' | 'codex';

export function useResolveAuthIndex(
  provider: ConfigApiKeyProvider,
  configs: ProviderKeyConfig[],
  form: Pick<ProviderKeyConfig, 'apiKey' | 'baseUrl' | 'proxyUrl'>,
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
