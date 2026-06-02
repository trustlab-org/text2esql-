import React from 'react';
import { EuiFlexGroup, EuiFlexItem, EuiPanel, EuiText } from '@elastic/eui';
import { css } from '@emotion/react';

import { TopStatusBar } from '../components/layout/TopStatusBar';
import { SplitLayout } from '../components/layout/SplitLayout';
import { ChatPanel } from '../components/chat/ChatPanel';

/**
 * Application shell. Composes the top status bar above a two-panel split
 * layout: a chat panel on the left and the KQL editor + output on the right.
 * The panel contents are placeholders that later tasks replace with the real
 * chat and editor implementations.
 */
export const AppShell: React.FC = () => {
  return (
    <EuiFlexGroup
      direction="column"
      gutterSize="none"
      responsive={false}
      data-test-subj="queryCopilotAppShell"
      css={css({ height: '100vh' })}
    >
      <EuiFlexItem grow={false}>
        <TopStatusBar />
      </EuiFlexItem>
      <EuiFlexItem grow css={css({ minHeight: 0 })}>
        <SplitLayout left={<ChatPanel />} right={<KQLEditorPanel />} />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

// Placeholder — replaced in a later task (7.x)
const KQLEditorPanel: React.FC = () => (
  <EuiPanel
    hasShadow={false}
    color="transparent"
    data-test-subj="queryCopilotEditorPanelPlaceholder"
  >
    <EuiText color="subdued">KQL editor &amp; output</EuiText>
  </EuiPanel>
);
