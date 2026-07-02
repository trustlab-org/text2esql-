import React from 'react';
import { EuiBadge, EuiToolTip } from '@elastic/eui';

import { useCopilot } from '../../store/copilot.context';

/**
 * Shows the CUMULATIVE token usage of the whole session, accumulated in the
 * reducer on every successful generation (so it updates after every request
 * without a refresh). Renders nothing until at least one request has completed.
 */
export const TokensBadge: React.FC = () => {
  const { state } = useCopilot();
  const usage = state.sessionTokenUsage;
  if (usage.requests === 0) {
    return null;
  }
  return (
    <EuiToolTip
      content={`Prompt ${usage.promptTokens} · Completion ${usage.completionTokens} · ${usage.requests} requests`}
    >
      <EuiBadge color="hollow" data-test-subj="queryCopilotTokensBadge">
        {`Session tokens: ${usage.totalTokens}`}
      </EuiBadge>
    </EuiToolTip>
  );
};
