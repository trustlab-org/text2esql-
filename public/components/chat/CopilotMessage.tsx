import React from 'react';
import { EuiPanel, EuiFlexGroup, EuiFlexItem, EuiText, EuiBadge, useEuiTheme } from '@elastic/eui';
import { css } from '@emotion/react';

import type { ConversationMessage } from '../../../common/types';

interface CopilotMessageProps {
  message: ConversationMessage;
  queryUpdated?: boolean;
}

/** Formats an ISO timestamp to a short locale time (e.g. "14:03"). */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * A left-aligned gray chat bubble for copilot (assistant) messages, with an
 * optional "Query updated" badge and a small left-aligned timestamp beneath it.
 */
export const CopilotMessage: React.FC<CopilotMessageProps> = ({ message, queryUpdated }) => {
  const { euiTheme } = useEuiTheme();

  const bubbleCss = css({
    backgroundColor: euiTheme.colors.lightestShade,
    borderRadius: euiTheme.border.radius.medium,
    maxWidth: '80%',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  });

  return (
    <EuiFlexGroup
      direction="column"
      gutterSize="xs"
      alignItems="flexStart"
      responsive={false}
      data-test-subj="queryCopilotCopilotMessage"
    >
      <EuiFlexItem grow={false} css={css({ maxWidth: '80%' })}>
        <EuiPanel paddingSize="m" hasShadow={false} hasBorder={false} css={bubbleCss}>
          <EuiText size="s">{message.content}</EuiText>
        </EuiPanel>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
          {queryUpdated ? (
            <EuiFlexItem grow={false}>
              <EuiBadge color="success">Query updated</EuiBadge>
            </EuiFlexItem>
          ) : null}
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              {formatTime(message.timestamp)}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
