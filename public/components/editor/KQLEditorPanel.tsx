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
import { DataViewSelector } from './DataViewSelector';
import { ValidationFeedback } from './ValidationFeedback';

/**
 * Right-card editor panel: a header, the raw-Monaco KQL editor (read-only until
 * the user clicks Edit), and validation feedback. Reads/writes the current KQL
 * and validation state via CopilotContext.
 */
export const KQLEditorPanel: React.FC = () => {
  const { state, dispatch } = useCopilot();
  const { euiTheme } = useEuiTheme();

  // Editor is read-only until the user clicks Edit.
  const [isEditing, setIsEditing] = useState(false);

  return (
    <EuiPanel paddingSize="m" data-test-subj="queryCopilotKqlEditorPanel">
      <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiIcon type="editorCodeBlock" />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiTitle size="xs">
            <h2 css={{ whiteSpace: 'nowrap' }}>KQL Editor</h2>
          </EuiTitle>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="s" />

      {/* Full-width row of its own: multi-select chips wrap vertically here
          instead of colliding with the date picker inside the toolbar row. */}
      <DataViewSelector />

      <EuiSpacer size="s" />

      <EditorToolbar isEditing={isEditing} onToggleEdit={() => setIsEditing((v) => !v)} />

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
