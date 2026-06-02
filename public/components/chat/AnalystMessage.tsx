import React from 'react';
import { EuiPanel, EuiFlexGroup, EuiFlexItem, EuiText, useEuiTheme } from '@elastic/eui';
import { css } from '@emotion/react';

import type { ConversationMessage } from '../../../common/types';

interface AnalystMessageProps {
  message: ConversationMessage;
}

/** Formats an ISO timestamp to a short locale time (e.g. "14:03"). */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * A right-aligned solid-blue chat bubble for analyst (user) messages, with a
 * small right-aligned timestamp beneath it.
 */
export const AnalystMessage: React.FC<AnalystMessageProps> = ({ message }) => {
  const { euiTheme } = useEuiTheme();

  const bubbleCss = css({
    backgroundColor: euiTheme.colors.primary,
    color: euiTheme.colors.emptyShade,
    borderRadius: euiTheme.border.radius.medium,
    maxWidth: '80%',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  });

  return (
    <EuiFlexGroup
      direction="column"
      gutterSize="xs"
      alignItems="flexEnd"
      responsive={false}
      data-test-subj="queryCopilotAnalystMessage"
    >
      <EuiFlexItem grow={false} css={css({ maxWidth: '80%' })}>
        <EuiPanel paddingSize="m" hasShadow={false} hasBorder={false} css={bubbleCss}>
          <EuiText size="s" color="ghost">
            {message.content}
          </EuiText>
        </EuiPanel>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiText size="xs" color="subdued" textAlign="right">
          {formatTime(message.timestamp)}
        </EuiText>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
