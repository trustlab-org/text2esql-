import React from 'react';
import { EuiBadge } from '@elastic/eui';

import { useCopilot } from '../../store/copilot.context';

/**
 * Shows the CUMULATIVE estimated USD cost of the whole session, accumulated in
 * the reducer on every successful generation. Renders nothing until at least
 * one request has completed.
 */
export const CostBadge: React.FC = () => {
  const { state } = useCopilot();
  if (state.sessionTokenUsage.requests === 0) {
    return null;
  }
  return (
    <EuiBadge color="hollow" data-test-subj="queryCopilotCostBadge">
      {`$${state.sessionCostUsd.toFixed(4)} session`}
    </EuiBadge>
  );
};
