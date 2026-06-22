import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiBasicTable,
  EuiButton,
  EuiCallOut,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import type { EuiBasicTableColumn } from '@elastic/eui';

import type {
  TokenEstimateEntry,
  TokenEstimateProviderSpec,
} from '../../../common/types';
import { useServices, ApiError } from '../../services';
import { providerDisplayName } from '../statusbar/provider_display';
import { useCredentials } from '../../hooks/useCredentials';
import { useCopilot } from '../../store/copilot.context';

/** Placeholder query used when the conversation has no analyst message yet. */
const EXAMPLE_QUERY = 'show me all failed login attempts';

/** Row shape rendered by the estimate table (an entry tagged with its role). */
interface EstimateRow extends TokenEstimateEntry {
  readonly role: 'Primary' | 'Fallback';
}

type EstimateStatus = 'idle' | 'loading' | 'done' | 'error';

/**
 * Per-provider token/cost comparison shown below the keys form in the settings
 * flyout. Reads the configured primary (+ optional fallback) from
 * {@link useCredentials} and the most recent analyst query from copilot state,
 * then calls the pure token-estimate endpoint.
 */
export const TokenEstimatePanel: React.FC = () => {
  const { queryApi } = useServices();
  const { credentials } = useCredentials();
  const { state } = useCopilot();

  const [status, setStatus] = useState<EstimateStatus>('idle');
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const query = useMemo<string>(() => {
    const lastUser = [...state.conversation].reverse().find((m) => m.role === 'user');
    const content = lastUser?.content.trim();
    return content && content.length > 0 ? content : EXAMPLE_QUERY;
  }, [state.conversation]);

  // The provider specs (with role) to estimate: primary first, then fallback.
  const specs = useMemo<Array<{ role: 'Primary' | 'Fallback'; spec: TokenEstimateProviderSpec }>>(
    () => {
      if (!credentials) {
        return [];
      }
      const out: Array<{ role: 'Primary' | 'Fallback'; spec: TokenEstimateProviderSpec }> = [
        {
          role: 'Primary',
          spec: {
            provider: credentials.primary.provider,
            ...(credentials.primary.model ? { model: credentials.primary.model } : {}),
          },
        },
      ];
      if (credentials.fallback) {
        out.push({
          role: 'Fallback',
          spec: {
            provider: credentials.fallback.provider,
            ...(credentials.fallback.model ? { model: credentials.fallback.model } : {}),
          },
        });
      }
      return out;
    },
    [credentials]
  );

  const runEstimate = useCallback(async (): Promise<void> => {
    if (specs.length === 0) {
      setErrorMsg('Add a provider in the keys form above to estimate token usage.');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setErrorMsg(null);
    try {
      const { estimates } = await queryApi.estimateTokens(
        query,
        specs.map((s) => s.spec)
      );
      // Re-attach the role by index (the server preserves request order).
      const mapped: EstimateRow[] = estimates.map((entry, i) => ({
        ...entry,
        role: specs[i]?.role ?? 'Primary',
      }));
      setRows(mapped);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e instanceof ApiError ? e.message : 'Token estimate failed.');
      setStatus('error');
    }
  }, [queryApi, query, specs]);

  // Estimate once on first open when a usable provider is configured.
  useEffect(() => {
    if (status === 'idle' && specs.length > 0) {
      void runEstimate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: Array<EuiBasicTableColumn<EstimateRow>> = [
    { field: 'role', name: 'Role' },
    {
      field: 'provider',
      name: 'Provider',
      render: (provider: EstimateRow['provider']) => providerDisplayName(provider),
    },
    { field: 'model', name: 'Model' },
    {
      name: 'Est. prompt tokens',
      render: (row: EstimateRow) => row.tokenEstimate.promptTokens,
    },
    {
      name: 'Est. total tokens',
      render: (row: EstimateRow) => row.tokenEstimate.totalTokens,
    },
    {
      name: 'Est. cost (USD)',
      render: (row: EstimateRow) => `$${row.costEstimate.totalCostUsd.toFixed(4)}`,
    },
  ];

  return (
    <div data-test-subj="queryCopilotTokenEstimatePanel">
      <EuiTitle size="s">
        <h3>Estimated token usage &amp; cost</h3>
      </EuiTitle>
      <EuiText size="xs" color="subdued">
        Pre-flight estimate (no LLM call) for the query: &ldquo;{query}&rdquo;
      </EuiText>
      <EuiSpacer size="m" />

      <EuiButton
        iconType="calculator"
        onClick={() => void runEstimate()}
        isLoading={status === 'loading'}
        disabled={status === 'loading'}
        data-test-subj="queryCopilotEstimateTokensButton"
      >
        Estimate tokens
      </EuiButton>

      {status === 'error' && (
        <>
          <EuiSpacer size="m" />
          <EuiCallOut color="danger" iconType="alert" title={errorMsg} size="s" />
        </>
      )}

      {status === 'done' && (
        <>
          <EuiSpacer size="m" />
          <EuiBasicTable
            items={rows}
            columns={columns}
            data-test-subj="queryCopilotTokenEstimateTable"
          />
        </>
      )}
    </div>
  );
};
