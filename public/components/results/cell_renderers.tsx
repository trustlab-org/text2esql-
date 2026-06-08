/**
 * Pure formatters, type-guards, a semantic badge map, and the {@link renderCell}
 * entry point used by the Query Output results table.
 *
 * Everything that does not need React is exported individually so it can be
 * unit-tested in isolation. The IPv4 / IPv6 / ISO matchers are intentionally
 * kept module-private (they are an implementation detail of the type-guards).
 *
 * @packageDocumentation
 */

import React from 'react';
import { EuiBadge, EuiCode, EuiText, EuiToolTip } from '@elastic/eui';
import type { ColumnDataType } from '../../../common/types';
import { truncatedCellStyles } from './results.styles';

/* -------------------------------------------------------------------------- */
/* Module-private matchers (NOT exported).                                     */
/* -------------------------------------------------------------------------- */

/** Matches an IPv4 dotted-quad address. */
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
/** Loose IPv6 matcher (hex groups, allows `::` compression). */
const IPV6_RE =
  /^(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/;
/** ISO-8601-looking timestamp (e.g. `2026-05-27T14:21:08Z`). */
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

/* -------------------------------------------------------------------------- */
/* Pure formatters.                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Zero-pads a number to 2 digits.
 *
 * @param n - The number to pad.
 * @returns The number as a string, left-padded with `0` to width 2.
 */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formats a value as an ABSOLUTE local timestamp `YYYY-MM-DD HH:MM:SS` to match
 * the mockup.
 *
 * @param value - A value parseable by the `Date` constructor (ISO string, epoch
 *   millis, `Date`, etc.).
 * @returns The absolute local timestamp, or `String(value)` when the value
 *   cannot be parsed into a valid date.
 */
export function formatTimestamp(value: unknown): string {
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

/**
 * Produces a short relative description of a date, anchored to "now".
 *
 * @param date - The date to describe.
 * @returns A phrase such as `"5 minutes ago"` (past) or `"in 3 days"` (future).
 *   The unit is the largest one that fits, and the count is pluralised.
 */
export function formatRelative(date: Date): string {
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
  // Walk from the smallest unit upward, keeping the largest unit that fits.
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

/**
 * Formats a number with locale-aware thousands separators.
 *
 * @param value - The number to format.
 * @returns The grouped number string, or `String(value)` when the value is not
 *   finite (`NaN`, `Infinity`, `-Infinity`).
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return value.toLocaleString();
}

/* -------------------------------------------------------------------------- */
/* Type-guards / classifiers.                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Determines whether a field reads as a timestamp.
 *
 * @param field - The field/column name.
 * @param value - The cell value.
 * @returns `true` when the field is `@timestamp`, ends with `timestamp` or
 *   `.time`, or the value is an ISO-8601-looking string.
 */
export function isTimestampField(field: string, value: unknown): boolean {
  if (field === '@timestamp') return true;
  if (field.endsWith('timestamp') || field.endsWith('.time') || field.endsWith('@timestamp')) {
    return true;
  }
  return typeof value === 'string' && ISO_RE.test(value);
}

/**
 * Determines whether the stringified value looks like an IP address.
 *
 * @param value - The cell value.
 * @returns `true` when the value matches the IPv4 or (loose) IPv6 pattern.
 */
export function isIpAddress(value: unknown): boolean {
  const str = String(value);
  return IPV4_RE.test(str) || IPV6_RE.test(str);
}

/**
 * Determines whether a value is a non-null object (arrays included).
 *
 * @param value - The cell value.
 * @returns `true` when `typeof value === 'object'` and the value is not `null`.
 */
export function isObjectValue(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

/**
 * Counts the entries a value exposes when rendered as an object badge.
 *
 * @param value - The cell value.
 * @returns The array length for arrays, the own-enumerable key count for plain
 *   objects, and `0` for everything else.
 */
export function objectKeyCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (isObjectValue(value)) {
    return Object.keys(value as Record<string, unknown>).length;
  }
  return 0;
}

/**
 * Converts a cell value to a plain string for display, filtering, or export.
 *
 * @param value - The cell value.
 * @returns A JSON string for objects/arrays, the empty string for
 *   `null`/`undefined`, and `String(value)` for everything else.
 */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Compares two cell values for sorting.
 *
 * @param a - The first value.
 * @param b - The second value.
 * @returns A negative number when `a` sorts first, positive when `b` sorts
 *   first, `0` when equal. `null`/`undefined` always sort last. Numbers are
 *   compared numerically; everything else via `localeCompare`.
 */
export function compareValues(a: unknown, b: unknown): number {
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

/* -------------------------------------------------------------------------- */
/* Semantic badge map.                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The subset of EUI badge palette colors used by the results table.
 *
 * @remarks `default` is EUI's neutral named badge color; it is used to
 * de-emphasise low-signal values (boolean `false`, `DEBUG`/`TRACE` levels).
 */
export type BadgeColor = 'success' | 'danger' | 'warning' | 'primary' | 'hollow' | 'default';

/** A resolved badge: the palette color plus the text to display. */
export interface BadgeSpec {
  /** The EUI badge color. */
  readonly color: BadgeColor;
  /** The label text rendered inside the badge. */
  readonly label: string;
}

/**
 * Resolves the semantic badge for a field/value, if any.
 *
 * Resolution order (first match wins):
 * 1. Booleans (`dataType === 'boolean'` or a boolean value) →
 *    `true` = `success`, `false` = `default`.
 * 2. `event.outcome` / `*.outcome` → `ok`/`success` = `success`,
 *    `failure`/`error` = `danger`, otherwise `warning` (case-insensitive).
 * 3. `log.level` / `*.level` / `*severity` → `CRITICAL`/`FATAL`/`ERROR` =
 *    `danger`, `WARN`/`WARNING` = `warning`, `INFO`/`NOTICE` = `primary`,
 *    `DEBUG`/`TRACE` = `default`, otherwise `hollow` (case-insensitive).
 * 4. `event.action` / `event.category` / `*.action` / `*.category` → `hollow`.
 * 5. Otherwise `null`.
 *
 * @param field - The field/column name.
 * @param value - The cell value.
 * @param dataType - Optional server-supplied column data type.
 * @returns The badge spec, or `null` when the field/value is not badge-worthy.
 */
export function badgeForField(
  field: string,
  value: unknown,
  dataType?: ColumnDataType
): BadgeSpec | null {
  // 1. Booleans.
  if (dataType === 'boolean' || typeof value === 'boolean') {
    return { color: value ? 'success' : 'default', label: String(value) };
  }

  const lowerField = field.toLowerCase();
  const token = cellToString(value).toLowerCase();

  // 2. Outcome.
  if (field === 'event.outcome' || lowerField.endsWith('.outcome')) {
    if (token === 'ok' || token === 'success') return { color: 'success', label: String(value) };
    if (token === 'failure' || token === 'error') return { color: 'danger', label: String(value) };
    return { color: 'warning', label: String(value) };
  }

  // 3. Level / severity.
  if (
    field === 'log.level' ||
    lowerField.endsWith('.level') ||
    lowerField.endsWith('severity')
  ) {
    if (token === 'critical' || token === 'fatal' || token === 'error') {
      return { color: 'danger', label: String(value) };
    }
    if (token === 'warn' || token === 'warning') {
      return { color: 'warning', label: String(value) };
    }
    if (token === 'info' || token === 'notice') {
      return { color: 'primary', label: String(value) };
    }
    if (token === 'debug' || token === 'trace') {
      return { color: 'default', label: String(value) };
    }
    return { color: 'hollow', label: String(value) };
  }

  // 4. Action / category.
  if (
    field === 'event.action' ||
    field === 'event.category' ||
    lowerField.endsWith('.action') ||
    lowerField.endsWith('.category')
  ) {
    return { color: 'hollow', label: String(value) };
  }

  // 5. No semantic badge.
  return null;
}

/* -------------------------------------------------------------------------- */
/* React render entry point.                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Maximum string length, in characters, that renders inline without a tooltip.
 * Longer strings are truncated with an ellipsis and reveal the full value on
 * hover.
 */
export const CELL_TOOLTIP_THRESHOLD = 50;

/**
 * Renders a single results-table cell, choosing a representation based on the
 * field, value, and (when available) the server-supplied `dataType`. When a
 * `dataType` is supplied it wins over the field-name/value heuristics.
 *
 * Precedence:
 * 1. `null`/`undefined` → subdued em-dash placeholder.
 * 2. Semantic badge (boolean / outcome / level / action) — evaluated BEFORE the
 *    date and IP branches so those wins are preserved.
 * 3. Date → absolute timestamp with a relative-time tooltip.
 * 4. IP → monospaced {@link EuiCode}.
 * 5. Number → plain span of the grouped number (alignment/monospace is applied
 *    by the column, not here).
 * 6. Object/array → hollow `Object - N keys` badge.
 * 7. String → plain span, or an overflow-truncated span with a full-value
 *    tooltip when longer than {@link CELL_TOOLTIP_THRESHOLD}.
 *
 * @param field - The field/column name.
 * @param value - The cell value.
 * @param dataType - Optional server-supplied column data type.
 * @returns The React node for the cell.
 */
export function renderCell(
  field: string,
  value: unknown,
  dataType?: ColumnDataType
): React.ReactNode {
  // 1. Missing values.
  if (value === null || value === undefined) {
    return (
      <EuiText size="s" color="subdued">
        —
      </EuiText>
    );
  }

  // 2. Semantic badges win over date/ip so boolean/outcome/level/action win.
  const badge = badgeForField(field, value, dataType);
  if (badge) {
    return <EuiBadge color={badge.color}>{badge.label}</EuiBadge>;
  }

  // 3. Dates.
  if (dataType === 'date' || (!dataType && isTimestampField(field, value))) {
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

  // 4. IP addresses.
  if (dataType === 'ip' || (!dataType && isIpAddress(value))) {
    return <EuiCode>{String(value)}</EuiCode>;
  }

  // 5. Numbers (alignment + monospace are applied by the column).
  if (dataType === 'number' || (!dataType && typeof value === 'number')) {
    return <span>{formatNumber(value as number)}</span>;
  }

  // 6. Objects / arrays.
  if (dataType === 'object' || (!dataType && isObjectValue(value))) {
    const count = objectKeyCount(value);
    return <EuiBadge color="hollow">{`Object - ${count} keys`}</EuiBadge>;
  }

  // 7. Strings.
  const str = cellToString(value);
  if (str.length > CELL_TOOLTIP_THRESHOLD) {
    return (
      <EuiToolTip content={str}>
        <span css={truncatedCellStyles}>{str}</span>
      </EuiToolTip>
    );
  }
  return <span>{str}</span>;
}
