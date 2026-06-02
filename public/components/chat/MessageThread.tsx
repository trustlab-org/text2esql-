/*
 * NOTE on the no-EuiComment decision:
 * The UI reference shows plain aligned chat bubbles with NO avatars, timeline
 * gutter, or per-message headers. EUI's EuiComment / EuiCommentList always
 * renders a left-aligned timeline with an avatar gutter and a header, and it
 * cannot be right-aligned, so it does not match the mockup. We therefore build
 * custom bubble components (AnalystMessage / CopilotMessage) from EUI
 * primitives (EuiPanel/EuiText/EuiBadge + the `css` prop) instead.
 *
 * Role mapping (the shared ConversationMessage.role is unchanged):
 *   'user'      -> AnalystMessage (right-aligned, solid blue)
 *   'assistant' -> CopilotMessage (left-aligned, gray)
 *   'system'    -> centered subdued note
 */
import React, { useEffect, useRef } from 'react';
import { EuiFlexGroup, EuiFlexItem, EuiPanel, EuiText, useEuiTheme } from '@elastic/eui';
import { css, keyframes } from '@emotion/react';

import type { ConversationMessage } from '../../../common/types';
import { AnalystMessage } from './AnalystMessage';
import { CopilotMessage } from './CopilotMessage';

interface MessageThreadProps {
  messages: readonly ConversationMessage[];
  isGenerating: boolean;
}

const bounce = keyframes`
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
`;

/** Left-aligned gray bubble with three animated dots, shown while generating. */
const TypingIndicator: React.FC = () => {
  const { euiTheme } = useEuiTheme();

  const bubbleCss = css({
    backgroundColor: euiTheme.colors.lightestShade,
    borderRadius: euiTheme.border.radius.medium,
    maxWidth: '80%',
  });

  const dotCss = (delay: string) =>
    css({
      display: 'inline-block',
      width: 6,
      height: 6,
      margin: '0 2px',
      borderRadius: '50%',
      backgroundColor: euiTheme.colors.darkShade,
      animation: `${bounce} 1.2s infinite ease-in-out`,
      animationDelay: delay,
    });

  return (
    <EuiFlexGroup
      justifyContent="flexStart"
      responsive={false}
      data-test-subj="queryCopilotTypingIndicator"
    >
      <EuiFlexItem grow={false}>
        <EuiPanel paddingSize="m" hasShadow={false} hasBorder={false} css={bubbleCss}>
          <span css={dotCss('0s')} />
          <span css={dotCss('0.2s')} />
          <span css={dotCss('0.4s')} />
        </EuiPanel>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

/**
 * Scrollable, vertically-stacked list of chat messages. Auto-scrolls to the
 * bottom whenever a new message arrives or the generating state changes.
 */
export const MessageThread: React.FC<MessageThreadProps> = ({ messages, isGenerating }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isGenerating]);

  return (
    <div
      css={css({ overflowY: 'auto', flex: 1, minHeight: 0 })}
      data-test-subj="queryCopilotMessageThread"
    >
      <EuiFlexGroup direction="column" gutterSize="s" responsive={false}>
        {messages.map((message) => {
          if (message.role === 'user') {
            return (
              <EuiFlexItem grow={false} key={message.id}>
                <AnalystMessage message={message} />
              </EuiFlexItem>
            );
          }
          if (message.role === 'assistant') {
            return (
              <EuiFlexItem grow={false} key={message.id}>
                <CopilotMessage message={message} queryUpdated={Boolean(message.queryDraftId)} />
              </EuiFlexItem>
            );
          }
          return (
            <EuiFlexItem grow={false} key={message.id}>
              <EuiText size="xs" color="subdued" textAlign="center">
                {message.content}
              </EuiText>
            </EuiFlexItem>
          );
        })}
        {isGenerating ? (
          <EuiFlexItem grow={false}>
            <TypingIndicator />
          </EuiFlexItem>
        ) : null}
      </EuiFlexGroup>
      <div ref={bottomRef} />
    </div>
  );
};
