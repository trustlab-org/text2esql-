import React, { useCallback, useState } from 'react';
import {
  EuiButton,
  EuiCallOut,
  EuiProgress,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import type { BenchmarkReport } from '../../../common/types';
import { useServices, ApiError } from '../../services';
import { providerDisplayName } from '../statusbar/provider_display';
import { ProviderComparisonTable } from './ProviderComparisonTable';

type BenchmarkStatus = 'idle' | 'running' | 'done' | 'error';

/**
 * Admin-facing panel that triggers a full cross-provider benchmark run and
 * renders the comparison report. A 403 (missing `queryCopilotAdmin` privilege)
 * surfaces here as the error state, like any other request failure.
 */
export const BenchmarkPanel: React.FC = () => {
  const { benchmarkApi } = useServices();
  const [status, setStatus] = useState<BenchmarkStatus>('idle');
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runBenchmark = useCallback(async () => {
    setStatus('running');
    setErrorMsg(null);
    try {
      const r = await benchmarkApi.runBenchmark();
      setReport(r);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e instanceof ApiError ? e.message : 'Benchmark failed.');
      setStatus('error');
    }
  }, [benchmarkApi]);

  const summaryLine = (r: BenchmarkReport): string => {
    const { summary } = r;
    const parts: string[] = [];
    if (summary.bestProviderByQuality) {
      parts.push(`Best quality: ${providerDisplayName(summary.bestProviderByQuality)}`);
    }
    if (summary.bestProviderByLatency) {
      parts.push(`Fastest: ${providerDisplayName(summary.bestProviderByLatency)}`);
    }
    if (summary.bestProviderByCost) {
      parts.push(`Cheapest: ${providerDisplayName(summary.bestProviderByCost)}`);
    }
    return parts.join('  •  ');
  };

  return (
    <div data-test-subj="queryCopilotBenchmarkPanel">
      <EuiTitle size="s">
        <h3>Provider Benchmark</h3>
      </EuiTitle>
      <EuiText size="xs" color="subdued">
        Runs the full query-generation pipeline across every configured provider. This can take
        60+ seconds.
      </EuiText>
      <EuiSpacer size="m" />

      <EuiButton
        fill
        iconType="play"
        onClick={runBenchmark}
        isLoading={status === 'running'}
        disabled={status === 'running'}
        data-test-subj="queryCopilotRunBenchmarkButton"
      >
        Run Benchmark
      </EuiButton>

      {status === 'running' && (
        <>
          <EuiSpacer size="m" />
          <EuiCallOut color="primary" title="Benchmark in progress">
            <EuiProgress size="s" />
            <EuiSpacer size="s" />
            <EuiText size="s" color="subdued">
              Running benchmark across providers… this can take 60+ seconds.
            </EuiText>
          </EuiCallOut>
        </>
      )}

      {status === 'error' && (
        <>
          <EuiSpacer size="m" />
          <EuiCallOut color="danger" iconType="alert" title="Benchmark failed">
            {errorMsg}
          </EuiCallOut>
        </>
      )}

      {status === 'done' && report && (
        <>
          <EuiSpacer size="m" />
          {report.providers.length === 0 ? (
            <EuiCallOut color="warning" title="No providers were benchmarked." />
          ) : (
            <>
              <EuiText size="s">{summaryLine(report)}</EuiText>
              <EuiSpacer size="s" />
              <ProviderComparisonTable providers={report.providers} />
            </>
          )}
        </>
      )}
    </div>
  );
};
