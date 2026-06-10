/**
 * LIVE smoke test for the MCP `search` path.
 *
 * Unlike `mcp.client.service.test.ts` (which mocks the `@modelcontextprotocol/sdk`
 * transport), this test exercises the REAL {@link McpClientService} against a
 * RUNNING Elastic Elasticsearch MCP Server container on `localhost:8080`, talking
 * to a real Elasticsearch 8.19 cluster. The kbn jest runner compiles TS, so the
 * production service is imported directly.
 *
 * It is deliberately non-fatal when no container is present: `beforeAll` probes
 * `http://localhost:8080/ping` and, if unreachable, every `it(...)` no-ops with a
 * warning. A normal `jest` / CI run WITHOUT a container therefore SKIPS rather
 * than fails. To run it for real, follow `docs/mcp-integration.md` section 7
 * (start the container, then run this suite).
 *
 * It asserts the two VERIFIED live response shapes of the MCP `search` tool:
 *  - Test A (populated): a two-block response — `"Total results: N, showing M."`
 *    plus a JSON array of bare `_source` docs — parses to a positive `total` and
 *    a non-empty `rows` array.
 *  - Test B (empty): a SINGLE-block `"Total results: 0, showing 0."` response
 *    parses cleanly (does NOT throw) to `total: 0` and an empty `rows` array.
 *
 * @packageDocumentation
 */

import type { Logger } from '@kbn/core/server';

import type { ConfigService } from '../config';
import { McpClientService } from './mcp.client.service';

/** Where the MCP server container is expected to be listening. */
const MCP_SERVER_URL = 'http://localhost:8080/mcp';
/** Liveness probe endpoint derived from the same host:port. */
const MCP_PING_URL = 'http://localhost:8080/ping';
/** Per-request timeout handed to the service (matches the config default). */
const REQUEST_TIMEOUT_MS = 30000;
/** Short timeout for the one-shot `/ping` reachability probe in `beforeAll`. */
const PROBE_TIMEOUT_MS = 3000;
/**
 * Jest hook/test timeout. Comfortably larger than {@link PROBE_TIMEOUT_MS} so the
 * no-container path (probe times out → tests no-op) never trips jest's default
 * 5s per-test timeout, and large enough to allow a real live `search` round-trip.
 */
const JEST_TIMEOUT_MS = 60000;
/** Index pattern verified to carry real ECS `postfix` documents. */
const INDEX_PATTERN = 'fosstlsoc-logs-*';

/**
 * A no-op {@link Logger}. Cast through `unknown` because we only need the four
 * leaf log methods the service calls, not the full Kibana Logger surface.
 */
function makeLogger(): Logger {
  const noop = (): void => undefined;
  return { debug: noop, info: noop, warn: noop, error: noop } as unknown as Logger;
}

/**
 * A stub {@link ConfigService} exposing only `getMcpConfig`, which is all the
 * service reads. `searchEnabled: true` reflects the live-search configuration;
 * `enabled: false` keeps the (broken-on-ECS) mapping flag off.
 */
function makeConfigService(): ConfigService {
  return {
    getMcpConfig: () => ({
      serverUrl: MCP_SERVER_URL,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      enabled: false,
      searchEnabled: true,
    }),
  } as unknown as ConfigService;
}

/** Set in `beforeAll`: `true` only when the container answered `/ping`. */
let containerUp = false;
let service: McpClientService;

describe('McpClientService.search (LIVE smoke)', () => {
  beforeAll(async () => {
    service = new McpClientService(makeConfigService(), makeLogger());

    // Reachability gate: a plain `/ping` with a generous timeout. If `/ping`
    // answers, treat the container as up and let the tests run. We deliberately
    // do NOT pre-flight a real search here — if the container is reachable but a
    // search fails, that's a genuine signal the tests should surface by FAILING,
    // not something to mask with a skip. Skip means "container down", nothing more.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    timer.unref();
    try {
      const response = await fetch(MCP_PING_URL, { signal: controller.signal });
      containerUp = response.ok;
    } catch {
      containerUp = false;
    } finally {
      clearTimeout(timer);
    }
  }, JEST_TIMEOUT_MS);

  afterAll(async () => {
    await service?.close().catch(() => undefined);
  });

  /**
   * Test A — populated result: a match-all returns a two-block response that
   * parses to a positive count and a non-empty document array.
   */
  it('parses a populated two-block response into total > 0 and non-empty rows', async () => {
    if (!containerUp) {
      // eslint-disable-next-line no-console
      console.warn('[mcp smoke] container not reachable at :8080 — skipping');
      return;
    }

    const result = await service.search(INDEX_PATTERN, {
      query: { match_all: {} },
      size: 100,
    });

    // `total` comes from the "Total results: N" summary block.
    expect(result.total).toBeGreaterThan(0);
    // `rows` comes from the second block's JSON array of bare _source docs.
    expect(result.rows.length).toBeGreaterThan(0);
  }, JEST_TIMEOUT_MS);

  /**
   * Test B — empty single-block result: a query matching nothing comes back as a
   * single `"Total results: 0, showing 0."` block and must parse cleanly without
   * throwing.
   */
  it('parses an empty single-block response to total 0 and zero rows without throwing', async () => {
    if (!containerUp) {
      // eslint-disable-next-line no-console
      console.warn('[mcp smoke] container not reachable at :8080 — skipping');
      return;
    }

    const result = await service.search(INDEX_PATTERN, {
      query: { term: { 'this_field_does_not_exist_zzz.keyword': 'no-such-value-zzz' } },
      size: 1,
    });

    expect(result.total).toBe(0);
    expect(result.rows.length).toBe(0);
  }, JEST_TIMEOUT_MS);
});
