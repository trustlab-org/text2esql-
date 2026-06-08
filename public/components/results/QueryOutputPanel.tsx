import React from 'react';
import {
  EuiBadge,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  useEuiTheme,
} from '@elastic/eui';

import { useCopilot } from '../../store/copilot.context';
import { EmptyResults } from './EmptyResults';
import { ResultsTable } from './ResultsTable';
import { panelBodyStyles, stateContainerStyles } from './results.styles';

/**
 * Right-card output panel: a header (console icon + "Query Output" title, with a
 * grand-total row-count badge when results are present) above a min-height body.
 *
 * The body selects one of five branches by precedence: a loading spinner, an
 * error callout, the "run a query" empty state, the "no results found" empty
 * state, or the {@link ResultsTable}. The four non-table branches are centered
 * inside a bounded {@link stateContainerStyles} wrapper so they fill the card
 * instead of rendering as a thin sliver; the table branch fills the body.
 *
 * The header badge shows the canonical SERVER total ("N results"), while the
 * toolbar inside the table shows the client-side "Showing X of Y" filtered
 * count — distinct meanings, so there is no duplication.
 */
export const QueryOutputPanel: React.FC = () => {
  const theme = useEuiTheme();
  const { state } = useCopilot();
  const { queryResults, error, isGenerating } = state;

  const hasRows = !!queryResults && queryResults.rows.length > 0;

  let body: React.ReactNode;
  if (isGenerating && !queryResults) {
    // NOTE: `isGenerating` is the shared chat/execution flag (the store has no
    // separate `isExecuting`); we treat an in-flight run with no results yet as
    // "running query".
    body = (
      <div css={stateContainerStyles(theme)}>
        <EuiFlexGroup justifyContent="center" alignItems="center" gutterSize="s" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiLoadingSpinner size="l" />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s" color="subdued">
              Running query…
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
      </div>
    );
  } else if (error && (!queryResults || queryResults.rows.length === 0)) {
    // NOTE: `state.error` is SHARED — set by both chat-generation and
    // query-execution failures, and `runQuery` does not clear it at start. So
    // we treat it as "the last error" and only surface it when there are no
    // fresh results to show.
    body = (
      <div css={stateContainerStyles(theme)}>
        <EuiCallOut color="danger" iconType="alert" title="Query execution failed">
          <p>
            {error.message}
            {error.requestId ? ` (request ${error.requestId})` : ''}
          </p>
        </EuiCallOut>
      </div>
    );
  } else if (!queryResults) {
    body = (
      <div css={stateContainerStyles(theme)}>
        <EmptyResults />
      </div>
    );
  } else if (queryResults.rows.length === 0) {
    body = (
      <div css={stateContainerStyles(theme)}>
        <EmptyResults
          title="No results found"
          body="Your query ran successfully but returned no matching documents."
        />
      </div>
    );
  } else {
    body = (
      <ResultsTable
        rows={queryResults.rows}
        columns={queryResults.columns}
        total={queryResults.total}
        tookMs={queryResults.tookMs}
        timedOut={queryResults.timedOut}
      />
    );
  }

  return (
    <EuiPanel paddingSize="m" data-test-subj="queryCopilotQueryOutputPanel">
      <EuiFlexGroup
        alignItems="center"
        justifyContent="spaceBetween"
        gutterSize="s"
        responsive={false}
      >
        <EuiFlexItem grow={false}>
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiIcon type="console" />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiTitle size="xs">
                <h2>Query Output</h2>
              </EuiTitle>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          {hasRows && queryResults ? (
            <EuiBadge color="hollow" data-test-subj="queryCopilotResultsHeaderBadge">
              {`${queryResults.total} results`}
            </EuiBadge>
          ) : null}
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="s" />

      <div css={panelBodyStyles(theme)} data-test-subj="queryCopilotQueryOutputBody">
        {body}
      </div>
    </EuiPanel>
  );
};
