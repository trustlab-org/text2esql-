import React, { useMemo } from 'react';
import {
  EuiBasicTable,
  EuiFlexGroup,
  EuiFlexItem,
  EuiProgress,
  EuiText,
  useEuiTheme,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import type { ProviderBenchmarkResult } from '../../../common/types';
import { providerDisplayName } from '../statusbar/provider_display';

/** Tolerance for floating-point comparison of cost values. */
const COST_EPSILON = 1e-9;

export interface ProviderComparisonTableProps {
  providers: readonly ProviderBenchmarkResult[];
}

/** Per-column best values; best = MIN for latency/p95/tokens/cost, MAX for quality. */
export interface ColumnBests {
  latency: number | null;
  p95: number | null;
  tokens: number | null;
  cost: number | null;
  quality: number | null;
}

/**
 * Computes the best value for each numeric column across all providers. Best is
 * the minimum for latency/p95/tokens/cost (lower is better) and the maximum for
 * quality (higher is better). Returns all-null when `providers` is empty. Pure,
 * so it can be unit-tested in a node environment.
 */
export function computeColumnBests(providers: readonly ProviderBenchmarkResult[]): ColumnBests {
  if (providers.length === 0) {
    return { latency: null, p95: null, tokens: null, cost: null, quality: null };
  }
  return {
    latency: Math.min(...providers.map((p) => p.avgLatencyMs)),
    p95: Math.min(...providers.map((p) => p.p95LatencyMs)),
    tokens: Math.min(...providers.map((p) => p.avgTokens)),
    cost: Math.min(...providers.map((p) => p.avgCost)),
    quality: Math.max(...providers.map((p) => p.avgQualityScore)),
  };
}

/**
 * Side-by-side comparison of per-provider benchmark aggregates. The best value
 * in each numeric column is highlighted (ties all highlight). Quality is shown
 * as a progress bar with an adjacent percentage label.
 */
export const ProviderComparisonTable: React.FC<ProviderComparisonTableProps> = ({ providers }) => {
  const { euiTheme } = useEuiTheme();
  const bests = useMemo(() => computeColumnBests(providers), [providers]);

  const highlightCss = {
    backgroundColor: `${euiTheme.colors.success}22`,
    color: euiTheme.colors.successText,
    fontWeight: euiTheme.font.weight.bold,
    padding: '2px 6px',
    borderRadius: euiTheme.border.radius.small,
  };

  const renderBest = (text: string, isBest: boolean) =>
    isBest ? <span css={highlightCss}>{text}</span> : <span>{text}</span>;

  const columns: Array<EuiBasicTableColumn<ProviderBenchmarkResult>> = [
    {
      field: 'provider',
      name: 'Provider',
      render: (_provider: ProviderBenchmarkResult['provider'], item: ProviderBenchmarkResult) =>
        providerDisplayName(item.provider),
    },
    {
      field: 'avgLatencyMs',
      name: 'Avg Latency',
      render: (value: number) =>
        renderBest(`${Math.round(value)} ms`, bests.latency !== null && value === bests.latency),
    },
    {
      field: 'p95LatencyMs',
      name: 'P95 Latency',
      render: (value: number) =>
        renderBest(`${Math.round(value)} ms`, bests.p95 !== null && value === bests.p95),
    },
    {
      field: 'avgTokens',
      name: 'Avg Tokens',
      render: (value: number) =>
        renderBest(`${Math.round(value)}`, bests.tokens !== null && value === bests.tokens),
    },
    {
      field: 'avgCost',
      name: 'Avg Cost',
      render: (value: number) =>
        renderBest(
          `$${value.toFixed(4)}`,
          bests.cost !== null && Math.abs(value - bests.cost) < COST_EPSILON
        ),
    },
    {
      field: 'avgQualityScore',
      name: 'Quality Score',
      render: (value: number) => {
        const pct = Math.round(value * 100);
        const isBest = bests.quality !== null && value === bests.quality;
        return (
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            <EuiFlexItem>
              <EuiProgress value={pct} max={100} size="m" color="success" />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiText size="s">{renderBest(`${pct}%`, isBest)}</EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        );
      },
    },
  ];

  return (
    <EuiBasicTable<ProviderBenchmarkResult>
      items={[...providers]}
      columns={columns}
      data-test-subj="queryCopilotProviderComparisonTable"
    />
  );
};
