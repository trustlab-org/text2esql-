import React from 'react';
import { EuiButton, EuiCallOut, EuiSpacer } from '@elastic/eui';

import { useCopilot, hasUsablePrimary } from '../../store/copilot.context';

/**
 * Warning banner shown at the top of the chat area when the user has no usable
 * primary LLM key configured (status is null, or the primary has no stored key
 * and is not Ollama). Offers a shortcut into the settings flyout where the key
 * is entered. Renders nothing once a usable primary key exists.
 */
interface NoKeyBannerProps {
  readonly onOpenSettings: () => void;
}

export const NoKeyBanner: React.FC<NoKeyBannerProps> = ({ onOpenSettings }) => {
  const { state } = useCopilot();

  if (hasUsablePrimary(state.credentialsStatus)) {
    return null;
  }

  return (
    <div data-test-subj="queryCopilotNoKeyBanner">
      <EuiCallOut
        color="warning"
        iconType="key"
        title="No LLM API key configured"
        size="s"
      >
        Add your own API key to start generating queries.
        <EuiSpacer size="s" />
        <EuiButton
          size="s"
          color="warning"
          onClick={onOpenSettings}
          data-test-subj="queryCopilotNoKeyOpenSettings"
        >
          Open Settings
        </EuiButton>
      </EuiCallOut>
      <EuiSpacer size="m" />
    </div>
  );
};
