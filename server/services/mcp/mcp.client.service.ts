/**
 * MCP client service.
 *
 * Connects to the Elastic Elasticsearch MCP Server over streamable-HTTP using
 * the official `@modelcontextprotocol/sdk` and exposes typed wrappers over the
 * server's tools (`list_indices`, `get_mappings`, `search`).
 *
 * Scope note: this service is intentionally NOT wired into the pipeline, routes
 * or `plugin.ts` yet — it is a standalone, independently-testable unit.
 *
 * The import specifiers below are the SDK's published subpath entry points.
 * They typecheck via the SDK's `typesVersions` map and resolve at runtime via
 * its `exports` map under both classic node resolution and Kibana's tooling.
 *
 * @packageDocumentation
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Logger } from '@kbn/core/server';

import type { ConfigService } from '../config';
import type { ESFieldMapping, ESIndexMapping } from '../schema/es.mapping.fetcher';
import { ResultNormalizer } from '../execution/result.normalizer';
import type { QueryExecutionResult } from '../../../common/types';

import { McpConnectionError, McpTimeoutError, McpToolError } from './errors';
import { ToolName, type McpIndexSummary } from './types';

/** A `text` content block as returned by an MCP tool call. */
interface McpTextContentBlock {
  readonly type: 'text';
  readonly text: string;
}

/** The minimal shape of a `tools/call` result that this service relies on. */
interface McpCallToolResult {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly isError?: boolean;
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Heuristic: does `error` look like a network/transport-unreachable failure?
 * The streamable-HTTP transport surfaces these as `fetch failed` /
 * `ECONNREFUSED` / `ENOTFOUND` etc.
 */
function looksLikeConnectionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|fetch failed|network|socket hang up/i.test(
    message
  );
}

/** Heuristic: does `error` look like a request-timeout failure? */
function looksLikeTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout|RequestTimeout|ETIMEDOUT|AbortError|aborted/i.test(message);
}

/**
 * Strongly-typed client for the Elastic Elasticsearch MCP Server.
 *
 * Lifecycle: call {@link McpClientService.connect} once (or rely on the lazy
 * connect performed by the tool methods), issue tool calls, then
 * {@link McpClientService.close} on shutdown. The service is single-connection
 * and not safe for concurrent `connect`/`close` from multiple callers.
 */
export class McpClientService {
  private readonly configService: ConfigService;
  private readonly logger: Logger;

  /** Resolved from config; never hardcoded. */
  private readonly serverUrl: string;
  /** Per-request timeout budget (ms), resolved from config. */
  private readonly requestTimeoutMs: number;

  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private connected = false;

  /**
   * @param configService - Source of the MCP server URL and request timeout.
   * @param logger - Plugin logger used for connection lifecycle diagnostics.
   */
  constructor(configService: ConfigService, logger: Logger) {
    this.configService = configService;
    this.logger = logger;

    const mcpConfig = this.configService.getMcpConfig();
    this.serverUrl = mcpConfig.serverUrl;
    this.requestTimeoutMs = mcpConfig.requestTimeoutMs;
  }

  /**
   * Establish the streamable-HTTP connection to the MCP server.
   *
   * Idempotent: a no-op if already connected. Connection failures are mapped to
   * {@link McpConnectionError} (network/unreachable) or {@link McpTimeoutError}
   * (timed out); both are retryable.
   *
   * @throws {McpConnectionError} when the server is unreachable.
   * @throws {McpTimeoutError} when the connection handshake times out.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.logger.debug(`McpClientService: connecting to ${this.serverUrl}`);

    // NOTE: the transport ctor's first argument MUST be a URL object, not a string.
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl));
    const client = new Client({ name: 'queryCopilot', version: '1.0.0' }, { capabilities: {} });

    try {
      await client.connect(transport);
    } catch (error) {
      // Best-effort cleanup of the half-open transport before mapping the error.
      await transport.close().catch(() => undefined);

      if (looksLikeTimeout(error)) {
        throw new McpTimeoutError('connection handshake timed out', {
          timeoutMs: this.requestTimeoutMs,
          cause: error,
        });
      }
      throw new McpConnectionError(
        error instanceof Error ? error.message : String(error),
        { cause: error }
      );
    }

    this.client = client;
    this.transport = transport;
    this.connected = true;
    this.logger.debug('McpClientService: connected');
  }

  /**
   * Close the MCP connection and reset internal state.
   *
   * Non-throwing: any error raised while closing is logged and swallowed so
   * shutdown paths stay clean.
   */
  async close(): Promise<void> {
    try {
      await this.client?.close();
      await this.transport?.close();
    } catch (error) {
      this.logger.warn(
        `McpClientService: error while closing MCP client: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      this.client = undefined;
      this.transport = undefined;
      this.connected = false;
    }
  }

  /**
   * Lazily connect if not already connected, so tool methods are usable after a
   * single explicit {@link McpClientService.connect} *or* with no prior call.
   */
  private async ensureConnected(): Promise<Client> {
    if (!this.connected || !this.client) {
      await this.connect();
    }
    // After a successful connect() the client field is always set.
    if (!this.client) {
      throw new McpConnectionError('MCP client is not available after connect');
    }
    return this.client;
  }

  /**
   * Invoke a single MCP tool and return the parsed JSON payload from its first
   * `text` content block.
   *
   * The Elastic Elasticsearch MCP server returns tool output as JSON encoded in
   * a text content block, so we parse `content[0].text` as JSON.
   *
   * @throws {McpToolError} when the result has `isError: true`, or when no
   *   parseable text content block is present.
   * @throws {McpTimeoutError} / {@link McpConnectionError} when the underlying
   *   SDK call fails for those reasons.
   */
  private async callTool(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.ensureConnected();

    let result: McpCallToolResult;
    try {
      // 2nd arg (result schema) is intentionally `undefined` — callTool returns
      // an already-parsed object. 3rd arg carries the per-request timeout.
      result = (await client.callTool({ name, arguments: args }, undefined, {
        timeout: this.requestTimeoutMs,
      })) as McpCallToolResult;
    } catch (error) {
      if (looksLikeTimeout(error)) {
        throw new McpTimeoutError(`tool "${name}" timed out`, {
          timeoutMs: this.requestTimeoutMs,
          cause: error,
        });
      }
      if (looksLikeConnectionFailure(error)) {
        throw new McpConnectionError(
          error instanceof Error ? error.message : String(error),
          { cause: error }
        );
      }
      // Anything else is a tool-level / JSON-RPC protocol failure. The SDK
      // rejects `callTool` with an Error carrying a numeric JSON-RPC `code`
      // (e.g. -32602 "Invalid params") and the server's human-readable text in
      // `error.message`. Surface it as a typed McpToolError, preserving the
      // server's message verbatim, rather than letting a raw error escape.
      throw new McpToolError(name, error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }

    if (result.isError === true) {
      throw new McpToolError(name, this.extractText(result) ?? 'tool reported an error');
    }

    const text = this.extractText(result);
    if (text === undefined) {
      throw new McpToolError(name, 'tool returned no text content block');
    }

    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new McpToolError(name, 'tool output was not valid JSON', { cause: error });
    }
  }

  /** Returns the text of the first `text` content block, if any. */
  private extractText(result: McpCallToolResult): string | undefined {
    const block = result.content.find(
      (c): c is McpTextContentBlock => c.type === 'text' && typeof c.text === 'string'
    );
    return block?.text;
  }

  /**
   * List the indices visible to the connected cluster via the `list_indices`
   * tool.
   *
   * The Elastic Elasticsearch MCP server's `list_indices` REQUIRES an
   * `index_pattern` argument (VERIFIED against the live server v0.4.6 — it is
   * NOT a no-arg call). The caller's `indexPattern` is forwarded as
   * `index_pattern`. The output shape varies between server versions, so each
   * summary is mapped defensively (tolerating `name`/`index` and
   * `docsCount`/`docs.count`/`docs_count` variants).
   *
   * @param indexPattern - An Elasticsearch index pattern (e.g. `"logs-*"`).
   * @returns A read-only array of {@link McpIndexSummary}.
   */
  async listIndices(indexPattern: string): Promise<readonly McpIndexSummary[]> {
    const parsed = await this.callTool(ToolName.ListIndices, { index_pattern: indexPattern });

    // Tolerate both a bare array and an `{ indices: [...] }` wrapper.
    const rows: unknown[] = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.indices)
      ? parsed.indices
      : [];

    const summaries: McpIndexSummary[] = [];
    for (const row of rows) {
      if (!isRecord(row)) {
        continue;
      }
      const name = this.pickString(row, ['name', 'index', 'index_name']);
      if (name === undefined) {
        continue;
      }
      summaries.push({
        name,
        health: this.pickString(row, ['health']),
        status: this.pickString(row, ['status']),
        docsCount: this.pickNumber(row, ['docsCount', 'docs.count', 'docs_count', 'docsCount']),
      });
    }
    return summaries;
  }

  /**
   * Fetch the field mappings for an index pattern via the `get_mappings` tool.
   *
   * @param indexPattern - An Elasticsearch index pattern (e.g. `"logs-*"`).
   * @returns An {@link ESIndexMapping} with `properties` flattened into dotted
   *   field paths.
   *
   * @remarks
   * The exact `get_mappings` output shape for the Elastic Elasticsearch MCP
   * server v0.4.6 should be confirmed against the running server — parsing here
   * is deliberately defensive. We accept either a bare ES `getMapping`-style
   * response (`{ "<index>": { mappings: { properties } } }`) or a flat
   * `{ properties }`/`{ mappings: { properties } }` object, flatten nested
   * `properties` into dotted paths, and default `searchable`/`aggregatable` to
   * `true` (the MCP mapping output does not report field capabilities).
   *
   * The tool argument name `index` is VERIFIED against the live Elastic
   * Elasticsearch MCP server v0.4.6 as `{ index }`.
   */
  async getMappings(indexPattern: string): Promise<ESIndexMapping> {
    const parsed = await this.callTool(ToolName.GetMappings, { index: indexPattern });

    const fields = new Map<string, ESFieldMapping>();
    const properties = this.locateProperties(parsed);
    if (properties) {
      this.flattenProperties(properties, '', fields);
    }

    return { indexPattern, fields, fetchedAt: new Date() };
  }

  /**
   * Execute a Query DSL search against an index pattern via the `search` tool
   * and normalise the hits into a tabular {@link QueryExecutionResult}.
   *
   * @param indexPattern - The index pattern to search.
   * @param queryDsl - A raw Elasticsearch Query DSL query body.
   *
   * @remarks
   * The tool argument names are VERIFIED against the live Elastic Elasticsearch
   * MCP server v0.4.6 as `{ index, query_body }` (note the snake_case
   * `query_body`, which carries the full ES Query DSL body — `query`, `size`,
   * `from`, `sort`, etc.). The server also accepts an optional `fields: string[]`
   * to restrict the returned source fields; we intentionally do not send it.
   * Mapping of the response is best-effort and tolerant of missing fields.
   */
  async search(
    indexPattern: string,
    queryDsl: Record<string, unknown>
  ): Promise<QueryExecutionResult> {
    const parsed = await this.callTool(ToolName.Search, {
      index: indexPattern,
      query_body: queryDsl,
    });

    const body = isRecord(parsed) ? parsed : {};
    const hits = isRecord(body.hits) ? body.hits : {};

    const total = this.normalizeTotal(hits.total);
    const tookMs = typeof body.took === 'number' ? body.took : 0;
    const timedOut = body.timed_out === true;

    const rawHits = Array.isArray(hits.hits) ? hits.hits : [];
    const normalizer = new ResultNormalizer();
    // ResultNormalizer expects estypes.SearchHit objects; the MCP payload is
    // structurally compatible (it forwards ES's hit objects verbatim).
    const { columns, rows } = normalizer.normalizeHits(
      rawHits as Parameters<ResultNormalizer['normalizeHits']>[0]
    );

    return { columns, rows, total, tookMs, timedOut };
  }

  /**
   * Lightweight liveness probe against the server's `/ping` endpoint (derived
   * from the configured base URL). Uses global `fetch` with an
   * {@link AbortController} timeout rather than the MCP client.
   *
   * @returns `true` on any 2xx response; `false` on any error. Never throws.
   */
  async health(): Promise<boolean> {
    const pingUrl = new URL('/ping', this.serverUrl).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(pingUrl, { signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Private parsing helpers ────────────────────────────────────────────────

  /** Normalise ES `hits.total` (a number, or `{ value: number }`) to a number. */
  private normalizeTotal(total: unknown): number {
    if (typeof total === 'number') {
      return total;
    }
    if (isRecord(total) && typeof total.value === 'number') {
      return total.value;
    }
    return 0;
  }

  /**
   * Locate the ES `properties` object inside a defensively-parsed mapping
   * payload, accepting several common envelope shapes.
   */
  private locateProperties(parsed: unknown): Record<string, unknown> | undefined {
    if (!isRecord(parsed)) {
      return undefined;
    }
    // Shape A: { properties: {...} }
    if (isRecord(parsed.properties)) {
      return parsed.properties;
    }
    // Shape B: { mappings: { properties: {...} } }
    if (isRecord(parsed.mappings) && isRecord(parsed.mappings.properties)) {
      return parsed.mappings.properties;
    }
    // Shape C: { "<index>": { mappings: { properties: {...} } } } — take the
    // first index entry that carries mappings.
    for (const value of Object.values(parsed)) {
      if (isRecord(value) && isRecord(value.mappings) && isRecord(value.mappings.properties)) {
        return value.mappings.properties;
      }
    }
    return undefined;
  }

  /**
   * Recursively flatten an ES `properties` object into dotted field paths.
   * Leaf fields (those with a `type`) are added to `out`; nested
   * `properties`/`fields` (multi-fields) are recursed into.
   */
  private flattenProperties(
    properties: Record<string, unknown>,
    prefix: string,
    out: Map<string, ESFieldMapping>
  ): void {
    for (const [key, value] of Object.entries(properties)) {
      if (!isRecord(value)) {
        continue;
      }
      const path = prefix ? `${prefix}.${key}` : key;

      if (isRecord(value.properties)) {
        // An object/nested parent — recurse, don't emit the parent itself.
        this.flattenProperties(value.properties, path, out);
        continue;
      }

      if (typeof value.type === 'string') {
        out.set(path, {
          name: path,
          type: value.type,
          // The MCP mapping output does not report field capabilities; default
          // to permissive values so downstream query generation isn't starved.
          searchable: true,
          aggregatable: true,
        });
      }
    }
  }

  /** First defined string value among `keys` in `row`. */
  private pickString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === 'string') {
        return value;
      }
    }
    return undefined;
  }

  /** First defined numeric value among `keys` in `row` (coerces numeric strings). */
  private pickNumber(row: Record<string, unknown>, keys: readonly string[]): number | undefined {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return Number(value);
      }
    }
    return undefined;
  }
}
