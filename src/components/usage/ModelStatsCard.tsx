import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  LATENCY_SOURCE_FIELD,
  formatCompactNumber,
  formatDurationMs,
  formatUsd,
  type ModelStatsSummary,
} from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export type ModelStat = ModelStatsSummary;

export interface ModelStatsCardProps {
  modelStats: ModelStat[];
  loading: boolean;
  hasPrices: boolean;
}

type SortKey =
  | 'model'
  | 'requests'
  | 'tokens'
  | 'cost'
  | 'successRate'
  | 'averageLatencyMs';
type SortDir = 'asc' | 'desc';

interface ModelStatWithRate extends ModelStat {
  successRate: number;
}

const MOBILE_PAGE_SIZE = 5;

export function ModelStatsCard({ modelStats, loading, hasPrices }: ModelStatsCardProps) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [sortKey, setSortKey] = useState<SortKey>('requests');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [mobileVisibleCount, setMobileVisibleCount] = useState(MOBILE_PAGE_SIZE);
  const latencyHint = t('usage_stats.latency_unit_hint', {
    field: LATENCY_SOURCE_FIELD,
    unit: t('usage_stats.duration_unit_ms'),
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'model' ? 'asc' : 'desc');
    }
  };

  const sorted = useMemo((): ModelStatWithRate[] => {
    const list: ModelStatWithRate[] = modelStats.map((s) => ({
      ...s,
      successRate: s.requests > 0 ? (s.successCount / s.requests) * 100 : 100,
    }));
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === 'model') return dir * a.model.localeCompare(b.model);
      const left = a[sortKey];
      const right = b[sortKey];
      const leftValid = typeof left === 'number' && Number.isFinite(left);
      const rightValid = typeof right === 'number' && Number.isFinite(right);

      if (!leftValid && !rightValid) return 0;
      if (!leftValid) return 1;
      if (!rightValid) return -1;
      return dir * (left - right);
    });
    return list;
  }, [modelStats, sortKey, sortDir]);

  useEffect(() => {
    setMobileVisibleCount(MOBILE_PAGE_SIZE);
  }, [isMobile, sorted.length]);

  const visibleSorted = useMemo(
    () => (isMobile ? sorted.slice(0, mobileVisibleCount) : sorted),
    [isMobile, mobileVisibleCount, sorted]
  );

  const canLoadMoreMobile = isMobile && visibleSorted.length < sorted.length;

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const ariaSort = (key: SortKey): 'none' | 'ascending' | 'descending' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const hasLatencyData = sorted.some((stat) => stat.latencySampleCount > 0);

  const getSuccessRateClassName = (successRate: number) =>
    successRate >= 95
      ? styles.statSuccess
      : successRate >= 80
        ? styles.statNeutral
        : styles.statFailure;

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
      title={t('usage_stats.models')}
      className={[styles.detailsFixedCard, styles.modelStatsCard].join(' ')}
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : sorted.length > 0 ? (
        <>
          {hasLatencyData && <div className={styles.detailsNote}>{latencyHint}</div>}
          {isMobile ? (
            <>
              <div className={styles.credentialMobileList}>
                {visibleSorted.map((stat) => (
                  <section key={stat.model} className={styles.credentialMobileCard}>
                    <div className={styles.credentialMobileNameRow}>
                      <span className={styles.credentialMobileName}>{stat.model}</span>
                    </div>

                    <div className={styles.credentialMobileSummary}>
                      {renderMobileStat(
                        t('usage_stats.requests_count'),
                        formatCompactNumber(stat.requests)
                      )}
                      {renderMobileStat(
                        t('usage_stats.tokens_count'),
                        formatCompactNumber(stat.tokens)
                      )}
                      {renderMobileStat(
                        t('usage_stats.success_rate'),
                        `${stat.successRate.toFixed(1)}%`,
                        getSuccessRateClassName(stat.successRate)
                      )}
                    </div>

                    {(hasLatencyData || hasPrices) && (
                      <div className={styles.credentialMobileSummaryCompact}>
                        {hasLatencyData &&
                          renderMobileStat(
                            t('usage_stats.avg_time'),
                            formatDurationMs(stat.averageLatencyMs)
                          )}
                        {hasPrices &&
                          renderMobileStat(
                            t('usage_stats.total_cost'),
                            stat.cost > 0 ? formatUsd(stat.cost) : '--'
                          )}
                      </div>
                    )}

                    <div className={styles.credentialMobileBreakdown}>
                      <span className={styles.statSuccess}>
                        ✓ {stat.successCount.toLocaleString()}
                      </span>
                      <span className={styles.statFailure}>
                        ✗ {stat.failureCount.toLocaleString()}
                      </span>
                    </div>
                  </section>
                ))}
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
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.sortableHeader} aria-sort={ariaSort('model')}>
                        <button
                          type="button"
                          className={styles.sortHeaderButton}
                          onClick={() => handleSort('model')}
                        >
                          {t('usage_stats.model_name')}
                          {arrow('model')}
                        </button>
                      </th>
                      <th className={styles.sortableHeader} aria-sort={ariaSort('requests')}>
                        <button
                          type="button"
                          className={styles.sortHeaderButton}
                          onClick={() => handleSort('requests')}
                        >
                          {t('usage_stats.requests_count')}
                          {arrow('requests')}
                        </button>
                      </th>
                      <th className={styles.sortableHeader} aria-sort={ariaSort('tokens')}>
                        <button
                          type="button"
                          className={styles.sortHeaderButton}
                          onClick={() => handleSort('tokens')}
                        >
                          {t('usage_stats.tokens_count')}
                          {arrow('tokens')}
                        </button>
                      </th>
                      <th className={styles.sortableHeader} aria-sort={ariaSort('averageLatencyMs')}>
                        <button
                          type="button"
                          className={styles.sortHeaderButton}
                          onClick={() => handleSort('averageLatencyMs')}
                          title={latencyHint}
                        >
                          {t('usage_stats.avg_time')}
                          {arrow('averageLatencyMs')}
                        </button>
                      </th>
                      <th className={styles.sortableHeader} aria-sort={ariaSort('successRate')}>
                        <button
                          type="button"
                          className={styles.sortHeaderButton}
                          onClick={() => handleSort('successRate')}
                        >
                          {t('usage_stats.success_rate')}
                          {arrow('successRate')}
                        </button>
                      </th>
                      {hasPrices && (
                        <th className={styles.sortableHeader} aria-sort={ariaSort('cost')}>
                          <button
                            type="button"
                            className={styles.sortHeaderButton}
                            onClick={() => handleSort('cost')}
                          >
                            {t('usage_stats.total_cost')}
                            {arrow('cost')}
                          </button>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((stat) => (
                      <tr key={stat.model}>
                        <td className={styles.modelCell}>{stat.model}</td>
                        <td>
                          <span className={styles.requestCountCell}>
                            <span>{stat.requests.toLocaleString()}</span>
                            <span className={styles.requestBreakdown}>
                              (
                              <span className={styles.statSuccess}>
                                {stat.successCount.toLocaleString()}
                              </span>{' '}
                              <span className={styles.statFailure}>
                                {stat.failureCount.toLocaleString()}
                              </span>
                              )
                            </span>
                          </span>
                        </td>
                        <td>{formatCompactNumber(stat.tokens)}</td>
                        <td className={styles.durationCell}>
                          {formatDurationMs(stat.averageLatencyMs)}
                        </td>
                        <td>
                          <span className={getSuccessRateClassName(stat.successRate)}>
                            {stat.successRate.toFixed(1)}%
                          </span>
                        </td>
                        {hasPrices && <td>{stat.cost > 0 ? formatUsd(stat.cost) : '--'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
