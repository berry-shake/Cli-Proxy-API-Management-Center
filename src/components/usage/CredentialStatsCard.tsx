import { Fragment, type ReactNode, useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import {
  calculateCost,
  collectUsageDetails,
  buildCandidateUsageSourceIds,
  formatCompactNumber,
  formatUsd,
  type ModelPrice,
  normalizeAuthIndex
} from '@/utils/usage';
import { authFilesApi } from '@/services/api/authFiles';
import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

export interface CredentialStatsCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  isMobile: boolean;
  modelPrices: Record<string, ModelPrice>;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
}

interface CredentialRow {
  key: string;
  displayName: string;
  type: string;
  success: number;
  failure: number;
  total: number;
  cost: number;
  successRate: number;
  models: CredentialModelRow[];
}

interface CredentialModelRow {
  model: string;
  success: number;
  failure: number;
  total: number;
  cost: number;
  successRate: number;
}

interface CredentialModelBucket {
  success: number;
  failure: number;
  cost: number;
}

interface InternalCredentialRow {
  key: string;
  displayName: string;
  type: string;
  success: number;
  failure: number;
  total: number;
  cost: number;
  successRate: number;
  modelsMap: Record<string, CredentialModelBucket>;
}

interface CredentialBucket {
  success: number;
  failure: number;
  cost: number;
  models: Record<string, CredentialModelBucket>;
}

export function CredentialStatsCard({
  usage,
  loading,
  isMobile,
  modelPrices,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
}: CredentialStatsCardProps) {
  const { t } = useTranslation();
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const hasPrices = Object.keys(modelPrices).length > 0;
  const cardClassName = [styles.detailsFixedCard, styles.credentialStatsCard].join(' ');
  const scrollClassName = [styles.detailsScroll, styles.credentialStatsScroll].join(' ');

  const toggleExpand = (rowKey: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  };

  // Fetch auth files for auth_index-based matching
  useEffect(() => {
    let cancelled = false;
    authFilesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        if (!Array.isArray(files)) return;
        const map = new Map<string, CredentialInfo>();
        files.forEach((file) => {
          const rawAuthIndex = file['auth_index'] ?? file.authIndex;
          const key = normalizeAuthIndex(rawAuthIndex);
          if (key) {
            map.set(key, {
              name: file.name || key,
              type: (file.type || file.provider || '').toString(),
            });
          }
        });
        setAuthFileMap(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Aggregate rows: all from bySource only (no separate byAuthIndex rows to avoid duplicates).
  // Auth files are used purely for name resolution of unmatched source IDs.
  const rows = useMemo((): CredentialRow[] => {
    if (!usage) return [];
    const details = collectUsageDetails(usage);
    const bySource: Record<string, CredentialBucket> = {};
    const result: InternalCredentialRow[] = [];
    const consumedSourceIds = new Set<string>();
    const authIndexToRowIndex = new Map<string, number>();
    const sourceToAuthIndex = new Map<string, string>();
    const sourceToAuthFile = new Map<string, CredentialInfo>();
    const fallbackByAuthIndex = new Map<string, CredentialBucket>();
    const createModelBucket = (): CredentialModelBucket => ({ success: 0, failure: 0, cost: 0 });
    const createCredentialBucket = (): CredentialBucket => ({
      success: 0,
      failure: 0,
      cost: 0,
      models: {}
    });
    const normalizeModelName = (value: unknown) => {
      const name = typeof value === 'string' ? value.trim() : '';
      return name || '-';
    };
    const addModelBucket = (
      target: Record<string, CredentialModelBucket>,
      modelName: string,
      isFailed: boolean,
      cost: number
    ) => {
      const modelBucket = target[modelName] ?? createModelBucket();
      if (isFailed) {
        modelBucket.failure += 1;
      } else {
        modelBucket.success += 1;
      }
      modelBucket.cost += cost;
      target[modelName] = modelBucket;
    };
    const addDetailToBucket = (bucket: CredentialBucket, isFailed: boolean, cost: number, modelName: string) => {
      if (isFailed) {
        bucket.failure += 1;
      } else {
        bucket.success += 1;
      }
      bucket.cost += cost;
      addModelBucket(bucket.models, modelName, isFailed, cost);
    };
    const mergeModelMaps = (
      target: Record<string, CredentialModelBucket>,
      source: Record<string, CredentialModelBucket>
    ) => {
      Object.entries(source).forEach(([modelName, modelBucket]) => {
        const existing = target[modelName] ?? createModelBucket();
        existing.success += modelBucket.success;
        existing.failure += modelBucket.failure;
        existing.cost += modelBucket.cost;
        target[modelName] = existing;
      });
    };
    const createRowFromBucket = (
      key: string,
      displayName: string,
      type: string,
      bucket: CredentialBucket
    ): InternalCredentialRow => {
      const total = bucket.success + bucket.failure;
      return {
        key,
        displayName,
        type,
        success: bucket.success,
        failure: bucket.failure,
        total,
        cost: bucket.cost,
        successRate: total > 0 ? (bucket.success / total) * 100 : 100,
        modelsMap: Object.fromEntries(
          Object.entries(bucket.models).map(([modelName, modelBucket]) => [
            modelName,
            { ...modelBucket }
          ])
        )
      };
    };
    const toModelRows = (modelsMap: Record<string, CredentialModelBucket>): CredentialModelRow[] =>
      Object.entries(modelsMap)
        .map(([model, bucket]) => {
          const total = bucket.success + bucket.failure;
          return {
            model,
            success: bucket.success,
            failure: bucket.failure,
            total,
            cost: bucket.cost,
            successRate: total > 0 ? (bucket.success / total) * 100 : 100
          };
        })
        .sort((a, b) => b.total - a.total || b.cost - a.cost || a.model.localeCompare(b.model));

    details.forEach((detail) => {
      const authIdx = normalizeAuthIndex(detail.auth_index);
      const source = detail.source;
      const isFailed = detail.failed === true;
      const cost = calculateCost(detail, modelPrices);
      const modelName = normalizeModelName(detail.__modelName);

      if (!source) {
        if (!authIdx) return;
        const fallback = fallbackByAuthIndex.get(authIdx) ?? createCredentialBucket();
        addDetailToBucket(fallback, isFailed, cost, modelName);
        fallbackByAuthIndex.set(authIdx, fallback);
        return;
      }

      const bucket = bySource[source] ?? createCredentialBucket();
      addDetailToBucket(bucket, isFailed, cost, modelName);
      bySource[source] = bucket;

      if (authIdx && !sourceToAuthIndex.has(source)) {
        sourceToAuthIndex.set(source, authIdx);
      }
      if (authIdx && !sourceToAuthFile.has(source)) {
        const mapped = authFileMap.get(authIdx);
        if (mapped) sourceToAuthFile.set(source, mapped);
      }
    });

    const mergeBucketToRow = (index: number, bucket: CredentialBucket) => {
      const target = result[index];
      if (!target) return;
      target.success += bucket.success;
      target.failure += bucket.failure;
      target.total = target.success + target.failure;
      target.cost += bucket.cost;
      target.successRate = target.total > 0 ? (target.success / target.total) * 100 : 100;
      mergeModelMaps(target.modelsMap, bucket.models);
    };

    // Aggregate all candidate source IDs for one provider config into a single row
    const addConfigRow = (
      apiKey: string,
      prefix: string | undefined,
      name: string,
      type: string,
      rowKey: string,
    ) => {
      const candidates = buildCandidateUsageSourceIds({ apiKey, prefix });
      const mergedBucket = createCredentialBucket();
      candidates.forEach((id) => {
        const bucket = bySource[id];
        if (bucket) {
          mergedBucket.success += bucket.success;
          mergedBucket.failure += bucket.failure;
          mergedBucket.cost += bucket.cost;
          mergeModelMaps(mergedBucket.models, bucket.models);
          consumedSourceIds.add(id);
        }
      });
      const total = mergedBucket.success + mergedBucket.failure;
      if (total > 0) {
        result.push(createRowFromBucket(rowKey, name, type, mergedBucket));
      }
    };

    // Provider rows — one row per config, stats merged across all its candidate source IDs
    geminiKeys.forEach((c, i) =>
      addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Gemini #${i + 1}`, 'gemini', `gemini:${i}`));
    claudeConfigs.forEach((c, i) =>
      addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Claude #${i + 1}`, 'claude', `claude:${i}`));
    codexConfigs.forEach((c, i) =>
      addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Codex #${i + 1}`, 'codex', `codex:${i}`));
    vertexConfigs.forEach((c, i) =>
      addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Vertex #${i + 1}`, 'vertex', `vertex:${i}`));
    // OpenAI compatibility providers — one row per provider, merged across all apiKey entries (prefix counted once).
    openaiProviders.forEach((provider, providerIndex) => {
      const prefix = provider.prefix;
      const displayName = prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`;

      const candidates = new Set<string>();
      buildCandidateUsageSourceIds({ prefix }).forEach((id) => candidates.add(id));
      (provider.apiKeyEntries || []).forEach((entry) => {
        buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id));
      });

      const mergedBucket = createCredentialBucket();
      candidates.forEach((id) => {
        const bucket = bySource[id];
        if (bucket) {
          mergedBucket.success += bucket.success;
          mergedBucket.failure += bucket.failure;
          mergedBucket.cost += bucket.cost;
          mergeModelMaps(mergedBucket.models, bucket.models);
          consumedSourceIds.add(id);
        }
      });

      const total = mergedBucket.success + mergedBucket.failure;
      if (total > 0) {
        result.push(createRowFromBucket(`openai:${providerIndex}`, displayName, 'openai', mergedBucket));
      }
    });

    // Remaining unmatched bySource entries — resolve name from auth files if possible
    Object.entries(bySource).forEach(([key, bucket]) => {
      if (consumedSourceIds.has(key)) return;
      const authFile = sourceToAuthFile.get(key);
      const row = createRowFromBucket(
        key,
        authFile?.name || (key.startsWith('t:') ? key.slice(2) : key),
        authFile?.type || '',
        bucket
      );
      const rowIndex = result.push(row) - 1;
      const authIdx = sourceToAuthIndex.get(key);
      if (authIdx && !authIndexToRowIndex.has(authIdx)) {
        authIndexToRowIndex.set(authIdx, rowIndex);
      }
    });

    // Include requests that have auth_index but missing source.
    fallbackByAuthIndex.forEach((bucket, authIdx) => {
      if (bucket.success + bucket.failure === 0) return;

      const mapped = authFileMap.get(authIdx);
      let targetRowIndex = authIndexToRowIndex.get(authIdx);
      if (targetRowIndex === undefined && mapped) {
        const matchedIndex = result.findIndex(
          (row) => row.displayName === mapped.name && row.type === mapped.type
        );
        if (matchedIndex >= 0) {
          targetRowIndex = matchedIndex;
          authIndexToRowIndex.set(authIdx, matchedIndex);
        }
      }

      if (targetRowIndex !== undefined) {
        mergeBucketToRow(targetRowIndex, bucket);
        return;
      }

      const rowIndex = result.push(
        createRowFromBucket(`auth:${authIdx}`, mapped?.name || authIdx, mapped?.type || '', bucket)
      ) - 1;
      authIndexToRowIndex.set(authIdx, rowIndex);
    });

    return result
      .map((row) => ({
        key: row.key,
        displayName: row.displayName,
        type: row.type,
        success: row.success,
        failure: row.failure,
        total: row.total,
        cost: row.cost,
        successRate: row.successRate,
        models: toModelRows(row.modelsMap)
      }))
      .sort((a, b) => b.total - a.total || b.cost - a.cost || a.displayName.localeCompare(b.displayName));
  }, [usage, modelPrices, geminiKeys, claudeConfigs, codexConfigs, vertexConfigs, openaiProviders, authFileMap]);

  const getSuccessRateClassName = (successRate: number) => (
    successRate >= 95
      ? styles.statSuccess
      : successRate >= 80
        ? styles.statNeutral
        : styles.statFailure
  );

  const renderRequestCount = (total: number, success: number, failure: number, stacked = false) => (
    <span
      className={[
        styles.requestCountCell,
        stacked ? styles.requestCountCellStacked : ''
      ].filter(Boolean).join(' ')}
    >
      <span>{formatCompactNumber(total)}</span>
      <span className={styles.requestBreakdown}>
        (<span className={styles.statSuccess}>{success.toLocaleString()}</span>{' '}
        <span className={styles.statFailure}>{failure.toLocaleString()}</span>)
      </span>
    </span>
  );

  const renderMobileMetric = (label: string, value: ReactNode, wide = false) => (
    <div
      className={[
        styles.credentialMobileMetric,
        wide ? styles.credentialMobileMetricWide : ''
      ].filter(Boolean).join(' ')}
    >
      <span className={styles.credentialMobileMetricLabel}>{label}</span>
      <div className={styles.credentialMobileMetricValue}>{value}</div>
    </div>
  );

  const renderMobileCompactMetric = (label: string, value: ReactNode, wide = false) => (
    <div
      className={[
        styles.credentialMobileCompactMetric,
        wide ? styles.credentialMobileCompactMetricWide : ''
      ].filter(Boolean).join(' ')}
    >
      <span className={styles.credentialMobileCompactMetricLabel}>{label}</span>
      <div className={styles.credentialMobileCompactMetricValue}>{value}</div>
    </div>
  );

  return (
    <Card title={t('usage_stats.credential_stats')} className={cardClassName}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length > 0 ? (
        <div className={scrollClassName}>
          {isMobile ? (
            <div className={styles.credentialMobileList}>
              {rows.map((row) => {
                const isExpanded = expandedRows.has(row.key);
                const detailRowId = `credential-models-${row.key}`;

                return (
                  <section key={row.key} className={styles.credentialMobileCard}>
                    <button
                      type="button"
                      className={styles.credentialMobileHeader}
                      onClick={() => toggleExpand(row.key)}
                      aria-expanded={isExpanded}
                      aria-controls={detailRowId}
                    >
                      <div className={styles.credentialMobileHeaderContent}>
                        <div className={styles.credentialMobileNameRow}>
                          <span className={styles.credentialMobileName}>{row.displayName}</span>
                          {row.type && <span className={styles.credentialType}>{row.type}</span>}
                        </div>
                      </div>
                      <span
                        className={[
                          styles.credentialExpandIcon,
                          styles.credentialMobileExpandIcon,
                          isExpanded ? styles.credentialExpandIconExpanded : ''
                        ].filter(Boolean).join(' ')}
                      >
                        ▶
                      </span>
                    </button>

                    <div className={styles.credentialMobileStats}>
                      {renderMobileMetric(
                        t('usage_stats.requests_count'),
                        renderRequestCount(row.total, row.success, row.failure, true)
                      )}
                      {renderMobileMetric(
                        t('usage_stats.success_rate'),
                        <span className={getSuccessRateClassName(row.successRate)}>
                          {row.successRate.toFixed(1)}%
                        </span>,
                      )}
                      {hasPrices && renderMobileMetric(
                        t('usage_stats.total_cost'),
                        row.cost > 0 ? formatUsd(row.cost) : '--'
                      )}
                    </div>

                    {isExpanded && (
                      <div id={detailRowId} className={styles.credentialMobileModels}>
                        {row.models.map((modelRow) => (
                          <div key={`${row.key}:${modelRow.model}`} className={styles.credentialMobileModelItem}>
                            <div className={styles.credentialMobileModelName}>{modelRow.model}</div>
                            <div className={styles.credentialMobileModelStats}>
                              {renderMobileCompactMetric(
                                t('usage_stats.requests_count'),
                                renderRequestCount(modelRow.total, modelRow.success, modelRow.failure, true)
                              )}
                              {renderMobileCompactMetric(
                                t('usage_stats.success_rate'),
                                <span className={getSuccessRateClassName(modelRow.successRate)}>
                                  {modelRow.successRate.toFixed(1)}%
                                </span>,
                              )}
                              {hasPrices && renderMobileCompactMetric(
                                t('usage_stats.total_cost'),
                                modelRow.cost > 0 ? formatUsd(modelRow.cost) : '--'
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('usage_stats.credential_name')}</th>
                    <th>{t('usage_stats.requests_count')}</th>
                    <th>{t('usage_stats.success_rate')}</th>
                    {hasPrices && <th>{t('usage_stats.total_cost')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isExpanded = expandedRows.has(row.key);
                    const detailRowId = `credential-models-${row.key}`;

                    return (
                      <Fragment key={row.key}>
                        <tr>
                          <td className={styles.modelCell}>
                            <button
                              type="button"
                              className={styles.credentialToggleButton}
                              onClick={() => toggleExpand(row.key)}
                              aria-expanded={isExpanded}
                              aria-controls={detailRowId}
                            >
                              <span className={`${styles.credentialExpandIcon} ${isExpanded ? styles.credentialExpandIconExpanded : ''}`}>
                                ▶
                              </span>
                              <span>{row.displayName}</span>
                              {row.type && (
                                <span className={styles.credentialType}>{row.type}</span>
                              )}
                            </button>
                          </td>
                          <td>{renderRequestCount(row.total, row.success, row.failure)}</td>
                          <td>
                            <span className={getSuccessRateClassName(row.successRate)}>
                              {row.successRate.toFixed(1)}%
                            </span>
                          </td>
                          {hasPrices && <td>{row.cost > 0 ? formatUsd(row.cost) : '--'}</td>}
                        </tr>
                        {isExpanded && (
                          <tr id={detailRowId}>
                            <td colSpan={hasPrices ? 4 : 3} className={styles.credentialExpandDetail}>
                              <div className={styles.credentialExpandTableWrapper}>
                                <table className={styles.table}>
                                  <thead>
                                    <tr>
                                      <th>{t('usage_stats.model_name')}</th>
                                      <th>{t('usage_stats.requests_count')}</th>
                                      <th>{t('usage_stats.success_rate')}</th>
                                      {hasPrices && <th>{t('usage_stats.total_cost')}</th>}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.models.map((modelRow) => (
                                      <tr key={`${row.key}:${modelRow.model}`}>
                                        <td className={styles.credentialModelCell}>{modelRow.model}</td>
                                        <td>{renderRequestCount(modelRow.total, modelRow.success, modelRow.failure)}</td>
                                        <td>
                                          <span className={getSuccessRateClassName(modelRow.successRate)}>
                                            {modelRow.successRate.toFixed(1)}%
                                          </span>
                                        </td>
                                        {hasPrices && <td>{modelRow.cost > 0 ? formatUsd(modelRow.cost) : '--'}</td>}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
