import React, { useState } from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiPanel,
  EuiSpacer,
  EuiTitle,
  useEuiTheme,
} from '@elastic/eui';

import { useCopilot } from '../../store/copilot.context';
import { updateKql } from '../../store/copilot.actions';
import { KQLEditor } from './KQLEditor';
import { EditorToolbar } from './EditorToolbar';
import { ValidationFeedback } from './ValidationFeedback';

/**
 * Right-card editor panel: a header, the raw-Monaco KQL editor (read-only until
 * the user clicks Edit), and validation feedback. Reads/writes the current KQL
 * and validation state via CopilotContext.
 */
export const KQLEditorPanel: React.FC = () => {
  const { state, runQuery, dispatch } = useCopilot();
  const { euiTheme } = useEuiTheme();

  // Editor is read-only until the user clicks Edit.
  const [isEditing, setIsEditing] = useState(false);

  return (
    <EuiPanel paddingSize="m" data-test-subj="queryCopilotKqlEditorPanel">
      <EuiFlexGroup
        alignItems="center"
        justifyContent="spaceBetween"
        gutterSize="s"
        responsive={false}
      >
        <EuiFlexItem grow={false}>
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiIcon type="editorCodeBlock" />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiTitle size="xs">
                <h2>KQL Editor</h2>
              </EuiTitle>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EditorToolbar
            isEditing={isEditing}
            onToggleEdit={() => setIsEditing((v) => !v)}
            onRun={() => {
              void runQuery();
            }}
            // NOTE: `isGenerating` is shared between chat generation and query
            // execution — the store has no separate `isExecuting` flag, so the
            // Run button's loading state reuses it (store is out of scope).
            isRunning={state.isGenerating}
            runDisabled={state.currentKQL.trim().length === 0}
          />
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="s" />

      <div css={{ borderRadius: euiTheme.border.radius.medium, overflow: 'hidden' }}>
        <KQLEditor
          value={state.currentKQL}
          onChange={(v) => dispatch(updateKql(v))}
          readOnly={!isEditing}
          height={200}
        />
      </div>

      <EuiSpacer size="s" />

      <ValidationFeedback validationResult={state.validationResult} />
    </EuiPanel>
  );
};
