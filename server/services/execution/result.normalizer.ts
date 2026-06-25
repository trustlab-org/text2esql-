/**
 * Normalizes raw Elasticsearch search hits into a flat, tabular shape suitable
 * for rendering in the results table.
 *
 * The normalizer is pure and deterministic: given the same hits it always
 * produces the same columns (in first-seen order, `@timestamp` first) and rows.
 */

import type { estypes } from '@elastic/elasticsearch';
import type {
  ColumnDataType,
  ColumnDefinition,
  QueryExecutionResult,
} from '../../../common/types';

/** A single ES|QL result column descriptor. */
export interface EsqlColumnInfo {
  readonly name: string;
  readonly type: string;
}

/** The subset of an ES `_query` (ES|QL) response we consume. */
export interface EsqlResponseLike {
  readonly columns: ReadonlyArray<EsqlColumnInfo>;
  readonly values: ReadonlyArray<ReadonlyArray<unknown>>;
  /** DurationValue (number ms or string) — coerced to a number. */
  readonly took?: unknown;
}

/** Maps an ES|QL column type to our render {@link ColumnDataType}. */
function mapEsqlType(type: string): ColumnDataType {
  switch (type) {
    case 'date':
    case 'datetime':
    case 'date_nanos':
      return 'date';
    case 'ip':
      return 'ip';
    case 'long':
    case 'integer':
    case 'double':
    case 'float':
    case 'half_float':
    case 'scaled_float':
    case 'unsigned_long':
    case 'short':
    case 'byte':
    case 'counter_long':
    case 'counter_integer':
    case 'counter_double':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'keyword':
    case 'text':
    case 'version':
      return 'string';
    case 'geo_point':
    case 'geo_shape':
    case 'cartesian_point':
    case 'cartesian_shape':
      return 'object';
    default:
      // Unknown/complex types render fine as text via cellToString.
      return 'string';
  }
}

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

  /**
   * Normalizes a columnar ES|QL response into the same object-row
   * {@link QueryExecutionResult} shape that {@link normalizeHits} produces, so
   * the existing results table renders it unchanged. Columns carry the explicit
   * ES|QL types; each positional `values` row is zipped into an object keyed by
   * column name.
   */
  normalizeEsql(response: EsqlResponseLike): QueryExecutionResult {
    const columns: ColumnDefinition[] = response.columns.map((c) => ({
      id: c.name,
      displayName: c.name,
      dataType: mapEsqlType(c.type),
    }));

    const rows: Array<Record<string, unknown>> = response.values.map((rowValues) =>
      Object.fromEntries(response.columns.map((c, j) => [c.name, rowValues[j]]))
    );

    return {
      columns,
      rows,
      total: response.values.length,
      tookMs: typeof response.took === 'number' ? response.took : 0,
      timedOut: false,
    };
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
