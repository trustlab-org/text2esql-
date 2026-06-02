/** Absolute or ES-date-math time window applied to a query. */
export interface TimeRange {
  readonly from: string; // ISO 8601 or ES date math (e.g. "now-24h")
  readonly to: string; // ISO 8601 or "now"
}

/** Inferred display/render type for a result column. */
export type ColumnDataType = 'date' | 'ip' | 'number' | 'boolean' | 'string' | 'object';

/** A single column in a query result table. */
export interface ColumnDefinition {
  readonly id: string; // field path, e.g. "source.ip" or "@timestamp"
  readonly displayName: string; // human label (defaults to id)
  readonly dataType: ColumnDataType;
}

/** Normalised result of executing a query against Elasticsearch. */
export interface QueryExecutionResult {
  readonly columns: readonly ColumnDefinition[];
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly total: number;
  readonly tookMs: number;
  readonly timedOut: boolean;
}

/** Inputs to QueryExecutorService.execute(). */
export interface QueryExecutionParams {
  readonly kql: string;
  readonly indexPattern: string;
  readonly timeRange?: TimeRange;
  readonly maxResults?: number; // default 100
}
