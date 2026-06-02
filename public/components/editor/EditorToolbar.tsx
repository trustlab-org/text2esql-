import React from 'react';
import { EuiButton, EuiButtonEmpty, EuiFlexGroup, EuiFlexItem } from '@elastic/eui';

export interface EditorToolbarProps {
  isEditing: boolean;
  onToggleEdit: () => void;
  onRun: () => void;
  isRunning: boolean;
  runDisabled?: boolean;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  isEditing,
  onToggleEdit,
  onRun,
  isRunning,
  runDisabled,
}) => {
  return (
    <EuiFlexGroup
      alignItems="center"
      gutterSize="s"
      justifyContent="flexEnd"
      responsive={false}
    >
      <EuiFlexItem grow={false}>
        <EuiButtonEmpty
          size="s"
          iconType="pencil"
          onClick={onToggleEdit}
          aria-pressed={isEditing}
          data-test-subj="queryCopilotEditorEditToggle"
        >
          {isEditing ? 'Done' : 'Edit'}
        </EuiButtonEmpty>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiButton
          fill
          color="primary"
          size="s"
          iconType="play"
          onClick={onRun}
          isLoading={isRunning}
          disabled={Boolean(runDisabled) || isRunning}
          data-test-subj="queryCopilotEditorRunButton"
        >
          Run Query
        </EuiButton>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
