/**
 * Normalizes raw Elasticsearch search hits into a flat, tabular shape suitable
 * for rendering in the results table.
 *
 * The normalizer is pure and deterministic: given the same hits it always
 * produces the same columns (in first-seen order, `@timestamp` first) and rows.
 */

import type { estypes } from '@elastic/elasticsearch';
import type { ColumnDataType, ColumnDefinition } from '../../../common/types';

/** Matches an IPv4 dotted-quad address. */
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
/** Loose IPv6 matcher (hex groups, allows `::` compression). */
const IPV6_RE =
  /^(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/;
/** ISO-8601-looking timestamp (e.g. `2026-05-27T14:21:08Z`). */
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

/** Outcome of normalizing a set of hits. */
export interface NormalizedHits {
  readonly columns: ColumnDefinition[];
  readonly rows: Array<Record<string, unknown>>;
}

/** True for a plain (recursable) object — not null, not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Flattens a plain object into dot-notation paths; arrays/primitives are leaves. */
function flatten(
  source: Record<string, unknown>,
  prefix: string,
  out: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      flatten(value, path, out);
    } else {
      out[path] = value;
    }
  }
}

/** Transforms ES search hits into flat columns + rows. */
export class ResultNormalizer {
  /**
   * @param hits the raw search hits
   * @param maxFields the maximum number of columns to keep (default 20)
   */
  normalizeHits(
    hits: Array<estypes.SearchHit<Record<string, unknown>>>,
    maxFields = 20
  ): NormalizedHits {
    // Flatten every hit's _source and collect the union of field paths in
    // first-seen order.
    const flattenedRows: Array<Record<string, unknown>> = [];
    const fieldOrder: string[] = [];
    const seen = new Set<string>();

    for (const hit of hits) {
      const flat: Record<string, unknown> = {};
      const source = hit._source;
      if (isPlainObject(source)) {
        flatten(source, '', flat);
      }
      flattenedRows.push(flat);
      for (const path of Object.keys(flat)) {
        if (!seen.has(path)) {
          seen.add(path);
          fieldOrder.push(path);
        }
      }
    }

    // Always surface `@timestamp` first when present in any hit.
    let orderedFields = fieldOrder;
    if (seen.has('@timestamp')) {
      orderedFields = ['@timestamp', ...fieldOrder.filter((f) => f !== '@timestamp')];
    }

    // Cap the column list.
    const selectedFields = orderedFields.slice(0, maxFields);

    // Build column definitions with inferred data types.
    const columns: ColumnDefinition[] = selectedFields.map((id) => ({
      id,
      displayName: id,
      dataType: this.inferDataType(id, flattenedRows),
    }));

    // Build rows containing only the selected columns.
    const rows: Array<Record<string, unknown>> = flattenedRows.map((flat) => {
      const row: Record<string, unknown> = {};
      for (const id of selectedFields) {
        row[id] = flat[id];
      }
      return row;
    });

    return { columns, rows };
  }

  /** Infers a column's render type from its field name and a sampled value. */
  private inferDataType(
    id: string,
    flattenedRows: Array<Record<string, unknown>>
  ): ColumnDataType {
    const sample = this.firstDefinedValue(id, flattenedRows);

    // Object/array leaves take precedence — they cannot be rendered as scalars.
    if (Array.isArray(sample) || isPlainObject(sample)) {
      return 'object';
    }

    if (
      id === '@timestamp' ||
      id.endsWith('timestamp') ||
      id.endsWith('.time') ||
      (typeof sample === 'string' && ISO_RE.test(sample))
    ) {
      return 'date';
    }

    if (id.includes('ip') || (typeof sample === 'string' && this.looksLikeIp(sample))) {
      return 'ip';
    }

    if (typeof sample === 'number') {
      return 'number';
    }

    if (typeof sample === 'boolean') {
      return 'boolean';
    }

    return 'string';
  }

  /** Returns the first non-undefined value for `id` across all rows. */
  private firstDefinedValue(
    id: string,
    flattenedRows: Array<Record<string, unknown>>
  ): unknown {
    for (const row of flattenedRows) {
      const value = row[id];
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  }

  /** True when the string looks like an IPv4 or IPv6 address. */
  private looksLikeIp(value: string): boolean {
    return IPV4_RE.test(value) || IPV6_RE.test(value);
  }
}
