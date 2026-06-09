/**
 * Elasticsearch index mapping fetcher for the query copilot.
 *
 * This module resolves the field mappings for an Elasticsearch index *pattern*
 * (which may contain wildcards and/or span multiple concrete indices) so that
 * downstream query-generation logic knows which fields exist, what their types
 * are, and whether each field is searchable and/or aggregatable.
 *
 * Why the `field_caps` API (and not `indices.getMapping`)?
 * - The input is an index *pattern* — e.g. `"logs-*"` — which may match many
 *   indices. `field_caps` merges the capabilities across every matching index,
 *   giving us a single unified view.
 * - `field_caps` auto-flattens dotted field names (e.g. `"source.ip"`), which
 *   is exactly the shape we want to expose to the rest of the copilot.
 * - It reports `searchable` / `aggregatable` capabilities directly, which raw
 *   mappings do not.
 *
 * @packageDocumentation
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';

/** A single field discovered in an Elasticsearch index mapping. */
export interface ESFieldMapping {
  /** Dotted field path, e.g. `"source.ip"`. */
  readonly name: string;
  /** Elasticsearch field type, e.g. `"ip"`, `"keyword"`, `"long"`. */
  readonly type: string;
  /** Whether the field can be used in a query context. */
  readonly searchable: boolean;
  /** Whether the field can be used in an aggregation context. */
  readonly aggregatable: boolean;
}

/** The resolved field mapping for an index pattern. */
export interface ESIndexMapping {
  /** The index pattern that was resolved (echoed back verbatim). */
  readonly indexPattern: string;
  /** Discovered fields, keyed by dotted field name. Empty if resolution failed. */
  readonly fields: Map<string, ESFieldMapping>;
  /** Timestamp at which the mapping was resolved. */
  readonly fetchedAt: Date;
}

/**
 * Source of resolved Elasticsearch index mappings for the query pipeline.
 *
 * This is the seam the pipeline depends on for its "schema context" stage. Two
 * implementations exist:
 *  - {@link ESMappingFetcher} — the default, calling `field_caps` as the
 *    per-request `asCurrentUser` Elasticsearch client (RBAC honoured per user).
 *  - `McpMappingProvider` — the feature-flagged path, sourcing mappings from the
 *    MCP server's `get_mappings` tool (RBAC of the MCP container's ES identity).
 *
 * Both return the identical normalized {@link ESIndexMapping}, so downstream
 * prompt-building is agnostic to which provider produced the mapping.
 */
export interface IndexMappingProvider {
  /**
   * Resolve the field mappings for the given index pattern.
   *
   * @param indexPattern - An Elasticsearch index pattern, possibly containing
   *   wildcards (e.g. `"logs-*"`).
   * @returns A normalized {@link ESIndexMapping}.
   */
  fetchIndexMappings(indexPattern: string): Promise<ESIndexMapping>;
}

/**
 * Fetches and normalizes Elasticsearch index mappings via the `field_caps` API.
 *
 * The resulting {@link ESIndexMapping} excludes structural parents (`object` /
 * `nested` fields) and metadata fields (`_id`, `_index`, `_source`, …) since
 * those are not directly queryable values.
 */
export class ESMappingFetcher implements IndexMappingProvider {
  /**
   * @param esClient - Kibana's scoped {@link ElasticsearchClient}, used to call
   *   the `field_caps` API.
   * @param logger - A {@link Logger} used to emit a warning when mapping
   *   resolution fails.
   *
   * @remarks
   * The task specification states only that the constructor "takes Kibana's
   * `ElasticsearchClient`". We additionally inject a `Logger` because the same
   * specification requires that the fetcher "returns an empty mapping on error
   * (logs warning)" — logging requires a logger. This also matches the plugin's
   * existing service convention (e.g. `ConfigService(config, logger)`,
   * `LoggerService(logger)`), where collaborators are passed explicitly via the
   * constructor.
   */
  constructor(
    private readonly esClient: ElasticsearchClient,
    private readonly logger: Logger
  ) {}

  /**
   * Resolve the field mappings for the given index pattern.
   *
   * @param indexPattern - An Elasticsearch index pattern, possibly containing
   *   wildcards (e.g. `"logs-*"`).
   * @returns An {@link ESIndexMapping}. On success, `fields` contains every
   *   queryable field discovered across the matching indices. On failure, a
   *   warning is logged and an {@link ESIndexMapping} with an empty `fields`
   *   map is returned.
   *
   * @remarks
   * This method **never throws**. Any error raised while calling
   * `field_caps` (e.g. the cluster being unavailable) is caught, logged at the
   * `warn` level, and swallowed; an empty mapping is returned instead. This
   * keeps the copilot resilient: a missing or unreachable index pattern simply
   * yields "no known fields" rather than crashing the request.
   */
  async fetchIndexMappings(indexPattern: string): Promise<ESIndexMapping> {
    const fields = new Map<string, ESFieldMapping>();

    try {
      const response = await this.esClient.fieldCaps({
        index: indexPattern,
        fields: '*',
        ignore_unavailable: true,
        allow_no_indices: true,
        expand_wildcards: 'open',
      });

      for (const [fieldName, capsByType] of Object.entries(response.fields ?? {})) {
        const typeNames = Object.keys(capsByType);
        if (typeNames.length === 0) {
          continue;
        }

        const primaryType = ESMappingFetcher.selectPrimaryType(typeNames);
        const capability = capsByType[primaryType];
        if (!capability) {
          continue;
        }

        // Skip metadata fields (_id, _index, _source, _seq_no, …) — not user data.
        if (capability.metadata_field === true) {
          continue;
        }

        // Skip structural parents — they are containers, not queryable values.
        if (primaryType === 'object' || primaryType === 'nested') {
          continue;
        }

        fields.set(fieldName, {
          name: fieldName,
          type: primaryType,
          searchable: capability.searchable === true,
          aggregatable: capability.aggregatable === true,
        });
      }
    } catch (error) {
      this.logger.warn(
        `ESMappingFetcher: failed to fetch field caps for index pattern "${indexPattern}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // Intentionally swallow: contract is to return an empty mapping, not throw.
    }

    return { indexPattern, fields, fetchedAt: new Date() };
  }

  /**
   * Choose a single representative type for a field given all of the types
   * `field_caps` reported for it.
   *
   * A field may have multiple capability entries (one per concrete type across
   * the matched indices). We prefer a "leaf" value type — i.e. anything that is
   * not `object` or `nested` — and, among the candidates, pick the
   * alphabetically-first name so the choice is deterministic.
   *
   * @param typeNames - The type names reported for a field. The caller
   *   guarantees this is non-empty, but this helper is written defensively so
   *   that it remains correct under `strict` + `noUncheckedIndexedAccess`.
   * @returns The selected primary type name.
   */
  private static selectPrimaryType(typeNames: readonly string[]): string {
    const sorted = [...typeNames].sort();

    for (const candidate of sorted) {
      if (candidate !== 'object' && candidate !== 'nested') {
        return candidate;
      }
    }

    // Every reported type was structural (object/nested); fall back to the
    // alphabetically-first name. The `?? ''` guards the (caller-precluded)
    // empty-array case so this compiles under noUncheckedIndexedAccess.
    return sorted[0] ?? '';
  }
}
