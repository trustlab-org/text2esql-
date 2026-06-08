import React, { useMemo, useState } from 'react';
import {
  Criteria,
  EuiBasicTable,
  EuiBasicTableColumn,
  EuiButtonIcon,
  EuiDescriptionList,
  useEuiTheme,
} from '@elastic/eui';

import { renderCell, compareValues, cellToString } from './cell_renderers';
import {
  tableScrollStyles,
  tableStyles,
  numericCellStyles,
  expandedRowStyles,
} from './results.styles';
import { ResultsToolbar } from './ResultsToolbar';
import type { ColumnDataType, ColumnDefinition } from '../../../common/types';

/** Props for {@link ResultsTable}. */
export interface ResultsTableProps {
  /** The result rows to render. */
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  /** Column definitions; when omitted, derived from the first row's keys. */
  readonly columns?: readonly ColumnDefinition[];
  /** Server-side grand total of matching documents (surfaced in the toolbar). */
  readonly total: number;
  /** Server-reported query duration, in milliseconds. */
  readonly tookMs: number;
  /** Whether the query timed out server-side. */
  readonly timedOut: boolean;
}

/** A result row, plus the synthetic stable id injected for table identity. */
type Row = Record<string, unknown>;
/** A {@link Row} carrying the synthetic `rowId` used as the table item id. */
type IndexedRow = Row & { readonly rowId: string };

/** The synthetic id field; excluded from the visible columns and detail list. */
const ROW_ID_FIELD = 'rowId';

/** Per-`dataType` fixed column widths (px) so columns are not squished. */
const COLUMN_WIDTH: Record<ColumnDataType, string> = {
  date: '180px',
  ip: '150px',
  number: '110px',
  boolean: '90px',
  object: '120px',
  string: '160px',
};

/**
 * Renders query results in an {@link EuiBasicTable}.
 *
 * Columns are dynamic: taken from the `columns` prop, or derived from the keys
 * of the first row (typed as `string`). Each column has a fixed, type-aware
 * width and renders its cell via {@link renderCell} — there is no blanket
 * `truncateText`, and the whole table sits inside a horizontal-scroll container
 * so values are never clamped to a few characters.
 *
 * A leading expander column toggles a single expanded row at a time; the
 * expanded panel shows the full record as a compact key/value list. Sorting and
 * pagination are managed locally and applied to a copy of the rows. A
 * client-side free-text filter (owned here, surfaced through {@link ResultsToolbar})
 * keeps rows whose any stringified cell contains the query.
 *
 * @param props - See {@link ResultsTableProps}.
 * @returns The toolbar + scrollable results table.
 */
export const ResultsTable: React.FC<ResultsTableProps> = ({
  rows,
  columns,
  total,
  tookMs,
  timedOut,
}) => {
  const theme = useEuiTheme();

  // Column definitions: explicit `columns`, else synthesised from the first
  // row's keys (all typed as `string`).
  const fieldDefs = useMemo<ColumnDefinition[]>(
    () =>
      columns && columns.length > 0
        ? columns.map((c) => ({ id: c.id, displayName: c.displayName, dataType: c.dataType }))
        : rows[0]
        ? Object.keys(rows[0]).map((k) => ({
            id: k,
            displayName: k,
            dataType: 'string' as ColumnDataType,
          }))
        : [],
    [columns, rows]
  );

  const fieldIds = useMemo<string[]>(() => fieldDefs.map((f) => f.id), [fieldDefs]);

  // Stable per-row identity for itemId + expansion, derived from the index.
  const indexedRows = useMemo<IndexedRow[]>(
    () => rows.map((row, index) => ({ ...row, [ROW_ID_FIELD]: String(index) })),
    [rows]
  );

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  // Default sort: `@timestamp` desc; fall back to the first column if absent.
  const [sortField, setSortField] = useState<string>(() =>
    fieldIds.includes('@timestamp') ? '@timestamp' : fieldIds[0] ?? '@timestamp'
  );
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterText, setFilterText] = useState('');
  // Single-row expansion: the `rowId` of the expanded row, or null.
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Pipeline: filter -> sort -> page.
  const filteredRows = useMemo<IndexedRow[]>(() => {
    if (filterText === '') {
      return indexedRows;
    }
    const needle = filterText.toLowerCase();
    return indexedRows.filter((row) =>
      fieldIds.some((id) => cellToString(row[id]).toLowerCase().includes(needle))
    );
  }, [indexedRows, fieldIds, filterText]);

  const sortedRows = useMemo<IndexedRow[]>(() => {
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const cmp = compareValues(a[sortField], b[sortField]);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredRows, sortField, sortDirection]);

  const pageItems = useMemo<IndexedRow[]>(
    () => sortedRows.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize),
    [sortedRows, pageIndex, pageSize]
  );

  const tableColumns = useMemo<Array<EuiBasicTableColumn<IndexedRow>>>(() => {
    const expander: EuiBasicTableColumn<IndexedRow> = {
      name: '',
      width: '40px',
      isExpander: true,
      align: 'center',
      render: (row: IndexedRow) => {
        const id = row[ROW_ID_FIELD];
        const isExpanded = id === expandedRowId;
        return (
          <EuiButtonIcon
            iconType={isExpanded ? 'arrowDown' : 'arrowRight'}
            aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
            data-test-subj="queryCopilotExpandRow"
            onClick={() => setExpandedRowId(isExpanded ? null : id)}
          />
        );
      },
    };

    const dataColumns = fieldDefs.map<EuiBasicTableColumn<IndexedRow>>((f) => {
      const dataType = f.dataType;
      const isNumber = dataType === 'number';
      return {
        field: f.id,
        name: f.displayName,
        sortable: true,
        truncateText: false,
        width: COLUMN_WIDTH[dataType],
        ...(isNumber ? { align: 'right' as const } : {}),
        render: (value: unknown) =>
          isNumber ? (
            <span css={numericCellStyles(theme)}>{renderCell(f.id, value, dataType)}</span>
          ) : (
            renderCell(f.id, value, dataType)
          ),
      };
    });

    return [expander, ...dataColumns];
  }, [fieldDefs, expandedRowId, theme]);

  // Expanded-row detail: the FULL record as a compact key/value list.
  const itemIdToExpandedRowMap = useMemo<Record<string, React.ReactNode>>(() => {
    if (expandedRowId === null) {
      return {};
    }
    const target = indexedRows.find((row) => row[ROW_ID_FIELD] === expandedRowId);
    if (!target) {
      return {};
    }
    const listItems = fieldDefs.map((f) => ({
      title: f.displayName,
      description: cellToString(target[f.id]) || '—',
    }));
    return {
      [expandedRowId]: (
        <div css={expandedRowStyles(theme)} data-test-subj="queryCopilotRowDetail">
          <EuiDescriptionList type="column" compressed listItems={listItems} />
        </div>
      ),
    };
  }, [expandedRowId, indexedRows, fieldDefs, theme]);

  const pagination = {
    pageIndex,
    pageSize,
    totalItemCount: filteredRows.length,
    pageSizeOptions: [10, 25, 50, 100],
  };

  const sorting = {
    sort: { field: sortField, direction: sortDirection },
  };

  const onChange = ({ page, sort }: Criteria<IndexedRow>) => {
    if (page) {
      setPageIndex(page.index);
      setPageSize(page.size);
    }
    if (sort) {
      setSortField(sort.field as string);
      setSortDirection(sort.direction);
    }
  };

  // Strip the synthetic id before handing rows to the toolbar's copy/CSV.
  const toolbarRows = useMemo<Row[]>(
    () =>
      filteredRows.map(({ [ROW_ID_FIELD]: _omit, ...rest }) => rest),
    [filteredRows]
  );

  return (
    <>
      <ResultsToolbar
        filteredCount={filteredRows.length}
        total={total}
        tookMs={tookMs}
        timedOut={timedOut}
        filterText={filterText}
        onFilterChange={(next) => {
          setFilterText(next);
          setPageIndex(0);
        }}
        columns={fieldDefs}
        rows={toolbarRows}
      />
      <div css={tableScrollStyles(theme)}>
        <EuiBasicTable<IndexedRow>
          css={tableStyles(theme)}
          data-test-subj="queryCopilotResultsTable"
          itemId={ROW_ID_FIELD}
          items={pageItems}
          columns={tableColumns}
          // Expandable rows are driven entirely by itemId + itemIdToExpandedRowMap
          // in this EUI version; EuiBasicTable exposes no `isExpandable` prop of
          // its own (it sets that flag on each EuiTableRow internally).
          itemIdToExpandedRowMap={itemIdToExpandedRowMap}
          pagination={pagination}
          sorting={sorting}
          onChange={onChange}
        />
      </div>
    </>
  );
};
