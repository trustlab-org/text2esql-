import React from 'react';
import { EuiEmptyPrompt } from '@elastic/eui';

export interface EmptyResultsProps {
  title?: string;
  body?: string;
}

/**
 * Empty-state prompt shown when there are no results (or none yet).
 *
 * Vertical centering and the bounded min-height are intentionally NOT handled
 * here — they are owned by the {@link QueryOutputPanel} `stateContainerStyles`
 * wrapper, so all four non-table states (loading, error, empty, no-results)
 * share consistent centering inside the 320px panel body. `titleSize="s"` keeps
 * the prompt from dominating that bounded space.
 */
export const EmptyResults: React.FC<EmptyResultsProps> = ({ title, body }) => {
  return (
    <EuiEmptyPrompt
      data-test-subj="queryCopilotEmptyResults"
      iconType="search"
      titleSize="s"
      title={<h3>{title ?? 'Run a query to see results'}</h3>}
      body={<p>{body ?? 'Generated KQL results will appear here once you run a query.'}</p>}
    />
  );
};
