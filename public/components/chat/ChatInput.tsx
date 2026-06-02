import React, { useState } from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiFieldText,
  EuiButtonIcon,
  EuiLoadingSpinner,
} from '@elastic/eui';

interface ChatInputProps {
  onSend: (text: string) => void;
  isGenerating: boolean;
  disabled?: boolean;
}

/**
 * Single-line chat input with a solid primary send button.
 *
 * NOTE: per the UI reference this is a single-line EuiFieldText (not a
 * multiline EuiTextArea). Enter sends the message; Shift+Enter is a no-op here
 * (a true newline would require EuiTextArea, intentionally not used to match
 * the single-line mockup).
 */
export const ChatInput: React.FC<ChatInputProps> = ({ onSend, isGenerating, disabled }) => {
  const [value, setValue] = useState('');

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

  return (
    <EuiFlexGroup
      gutterSize="s"
      alignItems="center"
      responsive={false}
      data-test-subj="queryCopilotChatInput"
    >
      <EuiFlexItem>
        <EuiFieldText
          fullWidth
          placeholder="Ask anything about your logs..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating || disabled}
          aria-label="Ask anything about your logs"
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        {isGenerating ? (
          <EuiLoadingSpinner size="m" />
        ) : (
          <EuiButtonIcon
            display="fill"
            color="primary"
            iconType="play"
            aria-label="Send message"
            onClick={handleSend}
            isDisabled={isGenerating || disabled || !value.trim()}
            data-test-subj="queryCopilotChatInputSendButton"
          />
        )}
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
