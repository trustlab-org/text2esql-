import React, { useState } from 'react';
import { EuiFieldText, EuiButtonIcon, EuiText, useEuiTheme, transparentize } from '@elastic/eui';
import { css } from '@emotion/react';

import { useTokenEstimate } from '../../hooks/useTokenEstimate';
import { useCopilot } from '../../store/copilot.context';

interface ChatInputProps {
  onSend: (text: string) => void;
  isGenerating: boolean;
  disabled?: boolean;
}

/** Edge length of the composer controls (text field + send button). */
const CONTROL_SIZE = 40;

/**
 * Single-line chat input with a solid primary send button.
 *
 * NOTE: per the UI reference this is a single-line EuiFieldText (not a
 * multiline EuiTextArea). Enter sends the message; Shift+Enter is a no-op here
 * (a true newline would require EuiTextArea, intentionally not used to match
 * the single-line mockup).
 *
 * The field and send button live inside one cohesive "composer" bar: a rounded,
 * token-bordered container on the empty-shade background that shows the primary
 * focus ring via `&:focus-within`. The EuiFieldText is rendered visually
 * borderless/transparent so the composer border is the only visible frame, and
 * the send button is a solid primary square matching the control height. While
 * generating the button stays in place (via EuiButtonIcon's `isLoading`, which
 * swaps the icon for a centered spinner but keeps the same square footprint) so
 * the bar height never shifts.
 */
export const ChatInput: React.FC<ChatInputProps> = ({ onSend, isGenerating, disabled }) => {
  const { euiTheme } = useEuiTheme();
  const [value, setValue] = useState('');
  const { state } = useCopilot();
  const { estimate } = useTokenEstimate(value);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isGenerating) {
      return;
    }
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating && value.trim()) {
        handleSend();
      }
    }
  };

  const composerCss = css({
    display: 'flex',
    alignItems: 'center',
    gap: euiTheme.size.xs,
    padding: euiTheme.size.xs,
    backgroundColor: euiTheme.colors.emptyShade,
    border: `${euiTheme.border.width.thin} solid ${euiTheme.border.color}`,
    borderRadius: euiTheme.border.radius.medium,
    transition: `border-color ${euiTheme.animation.fast}, box-shadow ${euiTheme.animation.fast}`,
    '&:focus-within': {
      borderColor: euiTheme.colors.primary,
      boxShadow: `0 0 0 1px ${transparentize(euiTheme.colors.primary, 0.3)}`,
    },
  });

  // Make the field blend into the composer: strip its own frame (border, box
  // shadow, background) so the composer container is the only visible border.
  // EUI applies the field background/shadow via a CSS var + `box-shadow`, so we
  // override both here (no `!important` needed — this selector wins on
  // specificity for the rendered element).
  const fieldCss = css({
    backgroundColor: 'transparent',
    boxShadow: 'none',
    height: CONTROL_SIZE,
    // Grow to fill the bar and allow shrinking below content width so the
    // square send button is never squeezed.
    flex: 1,
    minWidth: 0,
  });

  const sendButtonCss = css({
    // Lock to a true square: `flexShrink: 0` stops flexbox from shaving width
    // off the button on narrower panels (which would make it non-square).
    flexShrink: 0,
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    borderRadius: euiTheme.border.radius.medium,
  });

  const isSendDisabled = isGenerating || Boolean(disabled) || !value.trim();

  // One-line summary under the composer. The line always renders (no layout
  // jumps) and switches content: a live pre-flight estimate while typing, the
  // last request's usage when the input is empty, or the plain Enter hint.
  const hasText = value.trim().length > 0;
  let hintLine: React.ReactNode = 'Press Enter to send';
  if (hasText && estimate !== null) {
    const t = estimate.tokenEstimate;
    hintLine = (
      <span data-test-subj="queryCopilotTokenEstimateLine">
        {`Estimated — Input: ${t.promptTokens} · Output: ~${t.completionTokens} · Total: ~${t.totalTokens} tokens`}
      </span>
    );
  } else if (!hasText && state.tokenUsage !== null) {
    const usage = state.tokenUsage;
    const label = usage.isActual ? 'actual' : 'estimated';
    const cost =
      state.estimatedCost !== null ? ` · $${state.estimatedCost.totalCostUsd.toFixed(4)}` : '';
    hintLine = (
      <span data-test-subj="queryCopilotTokenUsageLine">
        {`Last request (${label}) — Prompt: ${usage.promptTokens} · Completion: ${usage.completionTokens} · Total: ${usage.totalTokens} tokens${cost}`}
      </span>
    );
  }

  return (
    <>
      <div css={composerCss} data-test-subj="queryCopilotChatInput">
        <EuiFieldText
          fullWidth
          controlOnly
          css={fieldCss}
          placeholder="Ask anything about your logs..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating || disabled}
          aria-label="Ask anything about your logs"
        />
        <EuiButtonIcon
          display="fill"
          color="primary"
          iconType="play"
          aria-label="Send message"
          onClick={handleSend}
          isDisabled={isSendDisabled}
          isLoading={isGenerating}
          css={sendButtonCss}
          data-test-subj="queryCopilotChatInputSendButton"
        />
      </div>
      <EuiText size="xs" color="subdued" css={css({ marginTop: euiTheme.size.xs })}>
        {hintLine}
      </EuiText>
    </>
  );
};
