import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { USAGE_STATS_STALE_TIME_MS, useNotificationStore, useUsageStatsStore } from '@/stores';
import { usageApi } from '@/services/api/usage';
import {
  fetchRemoteModelPrices,
  matchRemoteModelPrices,
  MODEL_PRICE_REMOTE_URL,
} from '@/services/api/modelPrices';
import { downloadBlob } from '@/utils/download';
import {
  loadModelPriceSyncMeta,
  loadModelPrices,
  saveModelPrices,
  type ModelPrice,
  type ModelPriceSyncMeta,
} from '@/utils/usage';

export interface SyncModelPricesOptions {
  silent?: boolean;
}

export interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UseUsageDataReturn {
  usage: UsagePayload | null;
  loading: boolean;
  error: string;
  lastRefreshedAt: Date | null;
  modelPrices: Record<string, ModelPrice>;
  modelPriceSyncMeta: ModelPriceSyncMeta | null;
  setModelPrices: (prices: Record<string, ModelPrice>) => void;
  syncModelPrices: (modelNames: string[], options?: SyncModelPricesOptions) => Promise<void>;
  syncingModelPrices: boolean;
  loadUsage: () => Promise<void>;
  handleExport: () => Promise<void>;
  handleImport: () => void;
  handleImportChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  exporting: boolean;
  importing: boolean;
}

export function useUsageData(): UseUsageDataReturn {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const usageSnapshot = useUsageStatsStore((state) => state.usage);
  const loading = useUsageStatsStore((state) => state.loading);
  const storeError = useUsageStatsStore((state) => state.error);
  const lastRefreshedAtTs = useUsageStatsStore((state) => state.lastRefreshedAt);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  const [modelPrices, setModelPricesState] = useState<Record<string, ModelPrice>>(() =>
    loadModelPrices()
  );
  const [modelPriceSyncMeta, setModelPriceSyncMeta] = useState<ModelPriceSyncMeta | null>(() =>
    loadModelPriceSyncMeta()
  );
  const modelPricesRef = useRef(modelPrices);
  const [syncingModelPrices, setSyncingModelPrices] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const loadUsage = useCallback(async () => {
    await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  useEffect(() => {
    void loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS }).catch(() => {});
  }, [loadUsageStats]);

  useEffect(() => {
    modelPricesRef.current = modelPrices;
  }, [modelPrices]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await usageApi.exportUsage();
      const exportedAt =
        typeof data?.exported_at === 'string' ? new Date(data.exported_at) : new Date();
      const safeTimestamp = Number.isNaN(exportedAt.getTime())
        ? new Date().toISOString()
        : exportedAt.toISOString();
      const filename = `usage-export-${safeTimestamp.replace(/[:.]/g, '-')}.json`;
      downloadBlob({
        filename,
        blob: new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' }),
      });
      showNotification(t('usage_stats.export_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        showNotification(t('usage_stats.import_invalid'), 'error');
        return;
      }

      const result = await usageApi.importUsage(payload);
      showNotification(
        t('usage_stats.import_success', {
          added: result?.added ?? 0,
          skipped: result?.skipped ?? 0,
          total: result?.total_requests ?? 0,
          failed: result?.failed_requests ?? 0,
        }),
        'success'
      );
      try {
        await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        showNotification(
          `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.upload_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setImporting(false);
    }
  };

  const handleSetModelPrices = useCallback((prices: Record<string, ModelPrice>) => {
    const syncMeta: ModelPriceSyncMeta = {
      source: 'manual',
      syncedAt: new Date().toISOString(),
    };

    modelPricesRef.current = prices;
    setModelPricesState(prices);
    setModelPriceSyncMeta(syncMeta);
    saveModelPrices(prices, syncMeta);
  }, []);

  const syncModelPrices = useCallback(
    async (modelNames: string[], options: SyncModelPricesOptions = {}) => {
      if (syncingModelPrices || modelNames.length === 0) {
        return;
      }

      setSyncingModelPrices(true);
      try {
        const remoteResult = await fetchRemoteModelPrices();
        const matchedPrices = matchRemoteModelPrices(modelNames, remoteResult.prices);
        const matchedCount = Object.keys(matchedPrices).length;

        if (!matchedCount) {
          if (!options.silent) {
            showNotification(t('usage_stats.model_price_sync_empty'), 'error');
          }
          return;
        }

        const nextPrices = { ...modelPricesRef.current, ...matchedPrices };
        const syncMeta: ModelPriceSyncMeta = {
          source: 'remote',
          syncedAt: new Date().toISOString(),
          remoteUrl: remoteResult.sourceUrl || MODEL_PRICE_REMOTE_URL,
          remoteUrls: remoteResult.sourceUrls,
          primaryUrl: remoteResult.primaryUrl,
          fallbackUrl: remoteResult.fallbackUrl,
          importedCount: remoteResult.importedCount,
          matchedCount,
        };

        modelPricesRef.current = nextPrices;
        setModelPricesState(nextPrices);
        setModelPriceSyncMeta(syncMeta);
        saveModelPrices(nextPrices, syncMeta);

        if (!options.silent) {
          showNotification(
            t('usage_stats.model_price_sync_success', { count: matchedCount }),
            'success'
          );
        }
      } catch (err: unknown) {
        if (!options.silent) {
          const message = err instanceof Error ? err.message : '';
          showNotification(
            `${t('usage_stats.model_price_sync_failed')}${message ? `: ${message}` : ''}`,
            'error'
          );
        }
      } finally {
        setSyncingModelPrices(false);
      }
    },
    [showNotification, syncingModelPrices, t]
  );

  const usage = usageSnapshot as UsagePayload | null;
  const error = storeError || '';
  const lastRefreshedAt = lastRefreshedAtTs ? new Date(lastRefreshedAtTs) : null;

  return {
    usage,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    modelPriceSyncMeta,
    setModelPrices: handleSetModelPrices,
    syncModelPrices,
    syncingModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing,
  };
}
