import React from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSuperDatePicker,
  type OnTimeChangeProps,
} from '@elastic/eui';

import { toIndexPattern, useCopilot } from '../../store/copilot.context';
import { useQueryExecution } from '../../hooks/useQueryExecution';
import { setTimeRange } from '../../store/copilot.actions';
import { DataViewSelector } from './DataViewSelector';

export interface EditorToolbarProps {
  isEditing: boolean;
  onToggleEdit: () => void;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ isEditing, onToggleEdit }) => {
  const { state, dispatch } = useCopilot();
  const { executeQuery, isExecuting } = useQueryExecution();

  // Comma-joined wire pattern targeting ALL selected data views.
  const indexPattern = toIndexPattern(state.selectedDataViews);

  // Commit the selected window to state and, when there is a query to run,
  // immediately re-execute it against the new range for an interactive feel.
  const handleTimeChange = ({ start, end }: OnTimeChangeProps): void => {
    dispatch(setTimeRange({ from: start, to: end }));
    if (state.currentKQL.trim().length > 0) {
      void executeQuery(
        state.currentKQL,
        indexPattern,
        { from: start, to: end },
        state.validationResult?.language
      );
    }
  };

  return (
    <EuiFlexGroup
      alignItems="center"
      gutterSize="s"
      justifyContent="flexEnd"
      responsive={false}
    >
      <EuiFlexItem grow={false} style={{ width: 360 }}>
        <DataViewSelector />
      </EuiFlexItem>
      <EuiFlexItem grow>
        <EuiSuperDatePicker
          compressed
          width="auto"
          showUpdateButton
          start={state.timeRange.from}
          end={state.timeRange.to}
          onTimeChange={handleTimeChange}
          onRefresh={({ start, end }) => {
            dispatch(setTimeRange({ from: start, to: end }));
            void executeQuery(
        state.currentKQL,
        indexPattern,
        { from: start, to: end },
        state.validationResult?.language
      );
          }}
          data-test-subj="queryCopilotTimePicker"
        />
      </EuiFlexItem>
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
          isLoading={isExecuting}
          disabled={isExecuting || state.currentKQL.trim().length === 0}
          onClick={() => {
            void executeQuery(
              state.currentKQL,
              indexPattern,
              state.timeRange,
              state.validationResult?.language
            );
          }}
          data-test-subj="queryCopilotEditorRunButton"
        >
          Run Query
        </EuiButton>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
