import React from 'react';
import {
  EuiPanel,
  EuiFlexGroup,
  EuiFlexItem,
  EuiTitle,
  EuiIcon,
  EuiHorizontalRule,
  EuiSpacer,
} from '@elastic/eui';
import { css } from '@emotion/react';

import { useCopilot } from '../../store/copilot.context';
import { MessageThread } from './MessageThread';
import { ChatInput } from './ChatInput';

/**
 * Left-card chat panel: a header, the scrollable message thread, and the
 * single-line chat input pinned at the bottom. Reads the conversation and
 * generating state from CopilotContext and dispatches new queries via
 * `sendQuery`.
 */
export const ChatPanel: React.FC = () => {
  const { state, sendQuery } = useCopilot();

  return (
    <EuiPanel
      paddingSize="m"
      hasShadow={false}
      hasBorder
      data-test-subj="queryCopilotChatPanel"
      css={css({ display: 'flex', flexDirection: 'column', height: '100%' })}
    >
      <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiIcon type="discuss" />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiTitle size="xs">
            <h2>Query Copilot</h2>
          </EuiTitle>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiHorizontalRule margin="s" />

      <MessageThread messages={state.conversation} isGenerating={state.isGenerating} />

      <EuiSpacer size="s" />

      <ChatInput
        onSend={(text) => {
          void sendQuery(text);
        }}
        isGenerating={state.isGenerating}
      />
    </EuiPanel>
  );
};
