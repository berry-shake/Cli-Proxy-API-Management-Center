import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatCompactNumber, formatUsd, type ApiStats } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface ApiDetailsCardProps {
  apiStats: ApiStats[];
  loading: boolean;
  hasPrices: boolean;
}

type ApiSortKey = 'endpoint' | 'requests' | 'tokens' | 'cost';
type SortDir = 'asc' | 'desc';

const MOBILE_PAGE_SIZE = 5;

export function ApiDetailsCard({ apiStats, loading, hasPrices }: ApiDetailsCardProps) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [expandedApis, setExpandedApis] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<ApiSortKey>('requests');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [mobileVisibleCount, setMobileVisibleCount] = useState(MOBILE_PAGE_SIZE);

  const toggleExpand = (endpoint: string) => {
    setExpandedApis((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(endpoint)) {
        newSet.delete(endpoint);
      } else {
        newSet.add(endpoint);
      }
      return newSet;
    });
  };

  const handleSort = (key: ApiSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'endpoint' ? 'asc' : 'desc');
    }
  };

  const sorted = useMemo(() => {
    const list = [...apiStats];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sortKey) {
        case 'endpoint': return dir * a.endpoint.localeCompare(b.endpoint);
        case 'requests': return dir * (a.totalRequests - b.totalRequests);
        case 'tokens': return dir * (a.totalTokens - b.totalTokens);
        case 'cost': return dir * (a.totalCost - b.totalCost);
        default: return 0;
      }
    });
    return list;
  }, [apiStats, sortKey, sortDir]);

  useEffect(() => {
    setMobileVisibleCount(MOBILE_PAGE_SIZE);
  }, [isMobile, sorted.length]);

  const visibleSorted = useMemo(
    () => (isMobile ? sorted.slice(0, mobileVisibleCount) : sorted),
    [isMobile, mobileVisibleCount, sorted]
  );

  const canLoadMoreMobile = isMobile && visibleSorted.length < sorted.length;

  const arrow = (key: ApiSortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const renderMobileStat = (label: string, value: ReactNode, valueClassName?: string) => (
    <div className={styles.credentialMobileStat}>
      <div
        className={[styles.credentialMobileStatValue, valueClassName]
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </div>
      <div className={styles.credentialMobileStatLabel}>{label}</div>
    </div>
  );

  return (
    <Card
      title={t('usage_stats.api_details')}
      className={[styles.detailsFixedCard, styles.apiDetailsCard].join(' ')}
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : sorted.length > 0 ? (
        <>
          <div className={styles.apiSortBar}>
            {([
              ['endpoint', 'usage_stats.api_endpoint'],
              ['requests', 'usage_stats.requests_count'],
              ['tokens', 'usage_stats.tokens_count'],
              ...(hasPrices ? [['cost', 'usage_stats.total_cost']] : []),
            ] as [ApiSortKey, string][]).map(([key, labelKey]) => (
              <button
                key={key}
                type="button"
                aria-pressed={sortKey === key}
                className={`${styles.apiSortBtn} ${sortKey === key ? styles.apiSortBtnActive : ''}`}
                onClick={() => handleSort(key)}
              >
                {t(labelKey)}{arrow(key)}
              </button>
            ))}
          </div>

          {isMobile ? (
            <>
              <div className={styles.credentialMobileList}>
                {visibleSorted.map((api) => {
                  const isExpanded = expandedApis.has(api.endpoint);
                  const panelId = `api-models-${api.endpoint}`;
                  const modelEntries = Object.entries(api.models);

                  return (
                    <section key={api.endpoint} className={styles.credentialMobileCard}>
                      <button
                        type="button"
                        className={styles.credentialMobileHeader}
                        onClick={() => toggleExpand(api.endpoint)}
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                      >
                        <span
                          className={[
                            styles.credentialExpandIcon,
                            styles.credentialMobileExpandIcon,
                            isExpanded ? styles.credentialExpandIconExpanded : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          ▶
                        </span>
                        <div className={styles.credentialMobileHeaderContent}>
                          <div className={styles.credentialMobileNameRow}>
                            <span className={styles.credentialMobileName}>{api.endpoint}</span>
                          </div>
                        </div>
                      </button>

                      <div className={styles.credentialMobileSummary}>
                        {renderMobileStat(
                          t('usage_stats.requests_count'),
                          formatCompactNumber(api.totalRequests)
                        )}
                        {renderMobileStat(
                          t('usage_stats.tokens_count'),
                          formatCompactNumber(api.totalTokens)
                        )}
                        {hasPrices &&
                          renderMobileStat(
                            t('usage_stats.total_cost'),
                            api.totalCost > 0 ? formatUsd(api.totalCost) : '--'
                          )}
                      </div>

                      <div className={styles.credentialMobileBreakdown}>
                        <span className={styles.statSuccess}>
                          ✓ {api.successCount.toLocaleString()}
                        </span>
                        <span className={styles.statFailure}>
                          ✗ {api.failureCount.toLocaleString()}
                        </span>
                      </div>

                      {isExpanded && modelEntries.length > 0 && (
                        <div id={panelId} className={styles.credentialMobileModels}>
                          {modelEntries.map(([model, stats]) => (
                            <div
                              key={`${api.endpoint}:${model}`}
                              className={styles.credentialMobileModelItem}
                            >
                              <div className={styles.credentialMobileModelHeader}>
                                <div className={styles.credentialMobileModelName}>{model}</div>
                              </div>
                              <div className={styles.credentialMobileSummaryCompact}>
                                {renderMobileStat(
                                  t('usage_stats.requests_count'),
                                  formatCompactNumber(stats.requests)
                                )}
                                {renderMobileStat(
                                  t('usage_stats.tokens_count'),
                                  formatCompactNumber(stats.tokens)
                                )}
                                {hasPrices &&
                                  renderMobileStat(
                                    t('usage_stats.total_cost'),
                                    stats.cost > 0 ? formatUsd(stats.cost) : '--'
                                  )}
                              </div>
                              <div className={styles.credentialMobileBreakdown}>
                                <span className={styles.statSuccess}>
                                  ✓ {stats.successCount.toLocaleString()}
                                </span>
                                <span className={styles.statFailure}>
                                  ✗ {stats.failureCount.toLocaleString()}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>

              {canLoadMoreMobile && (
                <div className={styles.credentialLoadMore}>
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    onClick={() => setMobileVisibleCount((prev) => prev + MOBILE_PAGE_SIZE)}
                  >
                    {t('usage_stats.credential_stats_load_more')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className={styles.detailsScroll}>
              <div className={styles.apiList}>
                {sorted.map((api, index) => {
                  const isExpanded = expandedApis.has(api.endpoint);
                  const panelId = `api-models-${index}`;

                  return (
                    <div key={api.endpoint} className={styles.apiItem}>
                      <button
                        type="button"
                        className={styles.apiHeader}
                        onClick={() => toggleExpand(api.endpoint)}
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                      >
                        <span
                          className={[
                            styles.credentialExpandIcon,
                            isExpanded ? styles.credentialExpandIconExpanded : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          ▶
                        </span>
                        <div className={styles.apiInfo}>
                          <span className={styles.apiEndpoint}>{api.endpoint}</span>
                          <div className={styles.apiStats}>
                            <span className={styles.apiBadge}>
                              <span className={styles.requestCountCell}>
                                <span>
                                  {t('usage_stats.requests_count')}: {api.totalRequests.toLocaleString()}
                                </span>
                                <span className={styles.requestBreakdown}>
                                  (<span className={styles.statSuccess}>{api.successCount.toLocaleString()}</span>{' '}
                                  <span className={styles.statFailure}>{api.failureCount.toLocaleString()}</span>)
                                </span>
                              </span>
                            </span>
                            <span className={styles.apiBadge}>
                              {t('usage_stats.tokens_count')}: {formatCompactNumber(api.totalTokens)}
                            </span>
                            {hasPrices && api.totalCost > 0 && (
                              <span className={styles.apiBadge}>
                                {t('usage_stats.total_cost')}: {formatUsd(api.totalCost)}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        <div id={panelId} className={styles.apiModels}>
                          {Object.entries(api.models).map(([model, stats]) => (
                            <div key={model} className={styles.modelRow}>
                              <span className={styles.modelName}>{model}</span>
                              <span className={styles.modelStat}>
                                <span className={styles.requestCountCell}>
                                  <span>{stats.requests.toLocaleString()}</span>
                                  <span className={styles.requestBreakdown}>
                                    (<span className={styles.statSuccess}>{stats.successCount.toLocaleString()}</span>{' '}
                                    <span className={styles.statFailure}>{stats.failureCount.toLocaleString()}</span>)
                                  </span>
                                </span>
                              </span>
                              <span className={styles.modelStat}>{formatCompactNumber(stats.tokens)}</span>
                              {hasPrices && (
                                <span className={styles.modelStat}>
                                  {stats.cost > 0 ? formatUsd(stats.cost) : '--'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
