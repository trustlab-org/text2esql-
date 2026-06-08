import React from 'react';
import {
  EuiBadge,
  EuiButtonIcon,
  EuiFieldSearch,
  EuiFlexGroup,
  EuiFlexItem,
  EuiText,
  useEuiTheme,
} from '@elastic/eui';

import { toolbarStyles } from './results.styles';
import { cellToString } from './cell_renderers';
import type { ColumnDefinition } from '../../../common/types';

/** Props for {@link ResultsToolbar}. */
export interface ResultsToolbarProps {
  /** Number of rows remaining after the client-side filter is applied. */
  readonly filteredCount: number;
  /** Server-side grand total of matching documents (may exceed loaded rows). */
  readonly total: number;
  /** Server-reported query duration, in milliseconds. */
  readonly tookMs: number;
  /** Whether the query timed out server-side. */
  readonly timedOut: boolean;
  /** Current value of the free-text filter input (controlled). */
  readonly filterText: string;
  /** Called with the next filter text whenever the input changes. */
  readonly onFilterChange: (next: string) => void;
  /** Column definitions for the result set, used as CSV headers and field order. */
  readonly columns: readonly ColumnDefinition[];
  /** The FILTERED rows that the copy/download actions operate on. */
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

/** RFC-4180 line terminator: carriage return + line feed. */
const CRLF = '\r\n';

/**
 * Escapes a single CSV field per RFC 4180: a field is wrapped in double quotes
 * (with any inner double quote doubled) when it contains a comma, a double
 * quote, a carriage return, or a line feed. Otherwise it is returned verbatim.
 */
function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Serialises result rows to an RFC-4180 CSV string.
 *
 * The header row is the columns' {@link ColumnDefinition.displayName} values;
 * each subsequent line is the row's values in column order, each produced by
 * {@link cellToString} of `row[column.id]`. Every field is escaped via
 * {@link escapeCsvField}, lines are joined with CRLF, and the result is
 * header-only when `rows` is empty.
 *
 * Pure and DOM-free, so it is unit-testable in a Node environment.
 *
 * @param columns - Column definitions providing header labels and field order.
 * @param rows - The rows to serialise (typically the filtered rows).
 * @returns The full CSV document as a string.
 */
export function rowsToCsv(
  columns: readonly ColumnDefinition[],
  rows: ReadonlyArray<Record<string, unknown>>
): string {
  const header = columns.map((column) => escapeCsvField(column.displayName)).join(',');
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvField(cellToString(row[column.id]))).join(',')
  );
  return [header, ...body].join(CRLF);
}

/**
 * Toolbar shown above the results table. Surfaces the visible/total row count,
 * the server query duration, a timed-out warning badge (only when the query
 * timed out), a controlled client-side free-text filter, and copy-as-JSON /
 * download-as-CSV actions over the (already-filtered) `rows`.
 */
export const ResultsToolbar: React.FC<ResultsToolbarProps> = ({
  filteredCount,
  total,
  tookMs,
  timedOut,
  filterText,
  onFilterChange,
  columns,
  rows,
}) => {
  const theme = useEuiTheme();

  /**
   * Copies the filtered rows to the clipboard as pretty-printed JSON. Guards a
   * missing `navigator.clipboard` (e.g. non-secure context or non-browser).
   */
  const handleCopyJson = (): void => {
    navigator.clipboard?.writeText(JSON.stringify(rows, null, 2));
  };

  /**
   * Builds a CSV from the filtered rows and triggers a browser download named
   * `query-results.csv` via a temporary object URL + anchor, revoking the URL
   * afterwards. No-ops gracefully where the DOM/URL APIs are unavailable.
   */
  const handleDownloadCsv = (): void => {
    const csv = rowsToCsv(columns, rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'query-results.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <EuiFlexGroup
      alignItems="center"
      gutterSize="s"
      responsive={false}
      css={toolbarStyles(theme)}
      data-test-subj="queryCopilotResultsToolbar"
    >
      <EuiFlexItem grow={false}>
        <EuiBadge color="hollow" data-test-subj="queryCopilotResultsCount">
          {`Showing ${filteredCount} of ${total}`}
        </EuiBadge>
      </EuiFlexItem>

      <EuiFlexItem grow={false}>
        <EuiText size="xs" color="subdued" data-test-subj="queryCopilotResultsTook">
          {`Took ${tookMs} ms`}
        </EuiText>
      </EuiFlexItem>

      <EuiFlexItem grow={false}>
        {timedOut ? (
          <EuiBadge color="warning" iconType="clock" data-test-subj="queryCopilotResultsTimedOut">
            Timed out
          </EuiBadge>
        ) : null}
      </EuiFlexItem>

      <EuiFlexItem grow />

      <EuiFlexItem grow={false}>
        <EuiFieldSearch
          compressed
          placeholder="Filter results"
          value={filterText}
          onChange={(event) => onFilterChange(event.target.value)}
          aria-label="Filter results"
          data-test-subj="queryCopilotResultsFilter"
        />
      </EuiFlexItem>

      <EuiFlexItem grow={false}>
        <EuiButtonIcon
          iconType="copyClipboard"
          aria-label="Copy results as JSON"
          data-test-subj="queryCopilotCopyJson"
          onClick={handleCopyJson}
        />
      </EuiFlexItem>

      <EuiFlexItem grow={false}>
        <EuiButtonIcon
          iconType="download"
          aria-label="Download results as CSV"
          data-test-subj="queryCopilotDownloadCsv"
          onClick={handleDownloadCsv}
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
