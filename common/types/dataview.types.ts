/** Summary of one Kibana Data View (index-pattern saved object). */
export interface DataViewSummary {
  readonly id: string;
  /** The index pattern string the data view targets (e.g. "logs-*"). */
  readonly title: string;
  /** Human-readable name (falls back to title when unset). */
  readonly name: string;
}

/** Response payload for GET /api/query_copilot/data-views. */
export interface DataViewsResponse {
  readonly dataViews: readonly DataViewSummary[];
}
