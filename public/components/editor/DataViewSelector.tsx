import React from 'react';
import {
  EuiButtonIcon,
  EuiComboBox,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIconTip,
  type EuiComboBoxOptionOption,
} from '@elastic/eui';

import { MAX_INDEX_PATTERN_LENGTH } from '../../../common';
import { useCopilot } from '../../store/copilot.context';
import { useDataViews } from '../../hooks/useDataViews';
import { setSelectedDataViews } from '../../store/copilot.actions';

/**
 * Multi-select Data View picker for the editor toolbar.
 *
 * Options come live from the server's data-views endpoint (label = data view
 * name, value = its index-pattern title); the selection is stored in
 * `state.selectedDataViews` as an ordered list of titles. Selected titles that
 * are missing from the loaded list (stale selections) still render as chips so
 * they stay visible and removable. Power users can also type an ad-hoc pattern
 * (comma lists allowed by ES) as a custom option, subject to the same
 * validation the server applies (no ":"; dot-prefixed patterns are allowed).
 */

/**
 * Validates an ad-hoc pattern typed by the user: trimmed, non-empty, and no ":"
 * anywhere. Dot-prefixed patterns (e.g. `.alerts-security*`) ARE allowed to
 * match the server guard — they are legitimate targets and Elasticsearch RBAC
 * still governs what the analyst can actually read.
 */
function isValidCustomPattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.includes(':')) {
    return false;
  }
  return pattern.split(',').every((segment) => segment.trim().length > 0);
}

export const DataViewSelector: React.FC = () => {
  const { state, dispatch } = useCopilot();
  const { dataViews, isLoading, error, refresh } = useDataViews();

  // Deduplicate the loaded data views by title; the first occurrence wins.
  const options: Array<EuiComboBoxOptionOption<string>> = [];
  const seenTitles = new Set<string>();
  for (const view of dataViews) {
    if (seenTitles.has(view.title)) {
      continue;
    }
    seenTitles.add(view.title);
    options.push({
      label: view.name !== view.title ? `${view.name} (${view.title})` : view.name,
      value: view.title,
    });
  }

  // Render every selected title as a chip, even when it is not (or no longer)
  // in the loaded list, so a stale selection stays visible and removable.
  const selectedOptions: Array<EuiComboBoxOptionOption<string>> = state.selectedDataViews.map(
    (title) => options.find((option) => option.value === title) ?? { label: title, value: title }
  );

  // The selection travels as ONE comma-joined `indexPattern` wire field, which
  // the server caps at MAX_INDEX_PATTERN_LENGTH — reject additions that would
  // exceed it here so an oversized selection fails visibly instead of 400ing.
  const fitsWireLimit = (titles: readonly string[]): boolean =>
    titles.join(',').length <= MAX_INDEX_PATTERN_LENGTH;

  const handleChange = (selected: Array<EuiComboBoxOptionOption<string>>): void => {
    const titles = selected
      .map((option) => (option.value ?? option.label).trim())
      .filter((title) => title.length > 0);
    if (!fitsWireLimit(titles) && titles.length > state.selectedDataViews.length) {
      return; // Ignore additions past the limit; removals always go through.
    }
    dispatch(setSelectedDataViews(titles));
  };

  const handleCreateOption = (searchValue: string): boolean => {
    const pattern = searchValue.trim();
    if (!isValidCustomPattern(pattern)) {
      return false;
    }
    if (!state.selectedDataViews.includes(pattern)) {
      const next = [...state.selectedDataViews, pattern];
      if (!fitsWireLimit(next)) {
        return false;
      }
      dispatch(setSelectedDataViews(next));
    }
    return true;
  };

  return (
    <EuiFlexGroup alignItems="center" gutterSize="xs" responsive={false}>
      <EuiFlexItem grow>
        <EuiComboBox<string>
          compressed
          fullWidth
          prepend="Data views"
          placeholder="Select data views…"
          isLoading={isLoading}
          options={options}
          selectedOptions={selectedOptions}
          onChange={handleChange}
          onCreateOption={handleCreateOption}
          aria-label="Data views"
          data-test-subj="queryCopilotDataViewSelector"
        />
      </EuiFlexItem>
      {error !== null && (
        <EuiFlexItem grow={false}>
          <EuiIconTip
            type="warning"
            color="warning"
            content={error}
            aria-label="Data views load error"
          />
        </EuiFlexItem>
      )}
      <EuiFlexItem grow={false}>
        <EuiButtonIcon
          iconType="refresh"
          size="xs"
          aria-label="Refresh data views"
          onClick={() => {
            void refresh();
          }}
          data-test-subj="queryCopilotDataViewRefresh"
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
