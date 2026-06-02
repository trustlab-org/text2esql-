import React, { useMemo, useState } from 'react';
import {
  Criteria,
  EuiBasicTable,
  EuiBasicTableColumn,
  EuiCode,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import type { ColumnDataType, ColumnDefinition } from '../../../common/types';

export interface ResultsTableProps {
  rows: ReadonlyArray<Record<string, unknown>>;
  columns?: readonly ColumnDefinition[];
}

type Row = Record<string, unknown>;

/** Internal, render-ready column descriptor. */
interface TableField {
  readonly id: string;
  readonly name: string;
  readonly dataType?: ColumnDataType;
}

/** Matches an IPv4 dotted-quad address. */
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
/** Loose IPv6 matcher (hex groups, allows `::` compression). */
const IPV6_RE = /^(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/;
/** ISO-8601-looking timestamp (e.g. `2026-05-27T14:21:08Z`). */
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

/** Zero-pads a number to 2 digits. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formats a value as an ABSOLUTE local timestamp `YYYY-MM-DD HH:MM:SS` to match
 * the mockup. Falls back to the raw string when the date is unparseable.
 */
function formatTimestamp(value: unknown): string {
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

/** Produces a short relative description like "5 minutes ago" / "in 3 days". */
function formatRelative(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const future = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const units: ReadonlyArray<readonly [number, string]> = [
    [1000, 'second'],
    [60 * 1000, 'minute'],
    [60 * 60 * 1000, 'hour'],
    [24 * 60 * 60 * 1000, 'day'],
    [30 * 24 * 60 * 60 * 1000, 'month'],
    [365 * 24 * 60 * 60 * 1000, 'year'],
  ];
  // Walk from largest unit down to find the biggest that fits.
  let chosen = units[0];
  for (const unit of units) {
    if (abs >= unit[0]) {
      chosen = unit;
    }
  }
  const count = Math.max(1, Math.round(abs / chosen[0]));
  const label = `${count} ${chosen[1]}${count === 1 ? '' : 's'}`;
  return future ? `in ${label}` : `${label} ago`;
}

/** True when the field name or value reads as a timestamp. */
function isTimestampField(field: string, value: unknown): boolean {
  if (field === '@timestamp') return true;
  if (field.endsWith('timestamp') || field.endsWith('.time') || field.endsWith('@timestamp')) {
    return true;
  }
  return typeof value === 'string' && ISO_RE.test(value);
}

/** True when the stringified value looks like an IPv4 or IPv6 address. */
function isIpAddress(value: unknown): boolean {
  const str = String(value);
  return IPV4_RE.test(str) || IPV6_RE.test(str);
}

/**
 * Renders a single cell, choosing a representation based on field/value. When
 * a `dataType` is supplied (from the server's column definitions) it drives the
 * choice, otherwise the field-name/value heuristics are used as a fallback.
 */
function renderCell(field: string, value: unknown, dataType?: ColumnDataType): React.ReactNode {
  if (value === null || value === undefined) {
    return (
      <EuiText size="s" color="subdued">
        —
      </EuiText>
    );
  }

  const isTimestamp = dataType ? dataType === 'date' : isTimestampField(field, value);
  const isIp = dataType ? dataType === 'ip' : isIpAddress(value);

  if (isTimestamp) {
    // The task asks for a "relative" timestamp, but the mockup shows an
    // ABSOLUTE `YYYY-MM-DD HH:MM:SS`. We satisfy both: render absolute text
    // (matching the mockup) and expose the relative description in a tooltip.
    const date = new Date(value as string);
    const absolute = formatTimestamp(value);
    if (Number.isNaN(date.getTime())) {
      return <span>{absolute}</span>;
    }
    return (
      <EuiToolTip content={formatRelative(date)}>
        <span>{absolute}</span>
      </EuiToolTip>
    );
  }

  if (isIp) {
    return <EuiCode>{String(value)}</EuiCode>;
  }

  return <span>{String(value)}</span>;
}

/** Compares two cell values; missing values always sort last. */
function compareValues(a: unknown, b: unknown): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

/**
 * Renders query results in an {@link EuiBasicTable}. Columns are dynamic
 * (from the `columns` prop, else the keys of the first row). Sort and
 * pagination are managed locally and applied to a copy of `rows` before the
 * current page slice is handed to the table as `items`.
 */
export const ResultsTable: React.FC<ResultsTableProps> = ({ rows, columns }) => {
  const fields = useMemo<TableField[]>(
    () =>
      columns && columns.length > 0
        ? columns.map((c) => ({ id: c.id, name: c.displayName, dataType: c.dataType }))
        : rows[0]
        ? Object.keys(rows[0]).map((k) => ({ id: k, name: k, dataType: undefined }))
        : [],
    [columns, rows]
  );

  const fieldIds = useMemo<string[]>(() => fields.map((f) => f.id), [fields]);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  // Default sort: `@timestamp` desc; fall back to the first column if absent.
  const [sortField, setSortField] = useState<string>(() =>
    fieldIds.includes('@timestamp') ? '@timestamp' : fieldIds[0] ?? '@timestamp'
  );
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const sortedRows = useMemo<Row[]>(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const cmp = compareValues(a[sortField], b[sortField]);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortField, sortDirection]);

  const pageItems = useMemo<Row[]>(
    () => sortedRows.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize),
    [sortedRows, pageIndex, pageSize]
  );

  const tableColumns = useMemo<Array<EuiBasicTableColumn<Row>>>(
    () =>
      fields.map((f) => ({
        field: f.id,
        name: f.name,
        sortable: true,
        truncateText: true,
        width: f.id === '@timestamp' ? '160px' : undefined,
        render: (value: unknown) => renderCell(f.id, value, f.dataType),
      })),
    [fields]
  );

  const pagination = {
    pageIndex,
    pageSize,
    totalItemCount: rows.length,
    pageSizeOptions: [10, 25, 50, 100],
  };

  const sorting = {
    sort: { field: sortField, direction: sortDirection },
  };

  const onChange = ({ page, sort }: Criteria<Row>) => {
    if (page) {
      setPageIndex(page.index);
      setPageSize(page.size);
    }
    if (sort) {
      setSortField(sort.field as string);
      setSortDirection(sort.direction);
    }
  };

  return (
    <EuiBasicTable<Row>
      data-test-subj="queryCopilotResultsTable"
      items={pageItems}
      columns={tableColumns}
      pagination={pagination}
      sorting={sorting}
      onChange={onChange}
    />
  );
};
