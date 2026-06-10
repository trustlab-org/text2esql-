# MCP integration (Elasticsearch MCP Server)

How the `query_copilot` plugin talks to the Elastic Elasticsearch MCP Server,
what it does and does NOT route through it, and how to turn the live path on.

All file paths below are relative to the plugin root
(`plugins/query_copilot/`).

---

## 1. Overview & data flow

```
Analyst prompt
  → LLM (Gemini primary, Groq fallback) generates KQL
  → plugin
  → McpClientService  (StreamableHTTPClientTransport from @modelcontextprotocol/sdk)
  → Elastic MCP server container  (docker.elastic.co/mcp/elasticsearch, v0.4.6)
  → Elasticsearch 8.19
  → the MCP server's two-block text response is parsed back into our QueryExecutionResult
```

Key files:

- `server/services/mcp/mcp.client.service.ts` — the streamable-HTTP client; typed
  wrappers over the server's tools (`list_indices`, `get_mappings`, `search`) and
  all the response parsing.
- `server/services/mcp/mcp.search.provider.ts` — adapts the client to the query
  EXECUTION seam (behind `mcp.searchEnabled`).
- `server/services/mcp/mcp.mapping.provider.ts` — adapts the client to the index
  MAPPING seam (behind `mcp.enabled`; see section 2 for why this is left OFF).
- `server/routes/execution.routes.ts` — the `POST /execute` route that selects the
  MCP search provider when the flag is on, and maps MCP errors to HTTP 500.
- `server/plugin.ts` — constructs the client, wires the providers behind their
  flags, logs the boot lines, and closes the client on shutdown.
- `server/config.ts` — the `mcp.*` config keys.

---

## 2. What runs through MCP and what does NOT

This is the important part: only one of the two paths is live, and they are
independently flagged.

### SEARCH (query execution): runs LIVE via MCP, behind `mcp.searchEnabled`

The MCP `search` response is **NOT** ES-native. Instead of a single
`{ took, hits }` envelope it returns **two `text` content blocks**:

- `content[0]` — a summary string, e.g. `"Total results: N, showing M."`.
- `content[1]` — a JSON **array of bare `_source` documents**: NO `hits`
  envelope, and NO `_index` / `_id` / `_score` per document.

`McpClientService.search` handles this shape directly:

- parses the count from `block[0]` via the regex `Total results: N`;
- parses the documents from `block[1]`;
- wraps each as `{ _source: doc }` so the shared `ResultNormalizer` consumes it
  unchanged;
- `tookMs` / `timedOut` are absent from the MCP response, so they are reported as
  `0` / `false`.

**Verified live.** A match-all on `fosstlsoc-logs-*` returned
`"Total results: 10000, showing 100"` with real `postfix` documents through the
full chain — multi-document parsing and count-vs-returned were both confirmed on
real data.

**Empty results** come back as a SINGLE block — `"Total results: 0, showing 0."`
with no documents block — and parse without error to `total: 0` and an empty
rows array.

### MAPPINGS: do NOT run through MCP

`get_mappings` via v0.4.6 fails with a JSON-RPC `-32603 "error decoding response
body"` on ECS-structured indices.

**Root cause (verified by an isolated probe + a mapping diff):** the server
deserializes FLAT mappings (e.g. `my-index` with only `text` / `keyword`
fields), but FAILS on NESTED object mappings. Every `fosstlsoc-logs-*` index
nests primitive fields under `properties` (`event.*`, `source.*`, `observer.*`,
`user.*` — all primitive types, but nested). It is NOT an exotic field type, and
NOT index size: a 9-document ECS index and a 1M-document ECS index fail
identically.

**No fix available.** The image is deprecated and `:latest` resolves to the same
`0.4.6` digest.

Therefore mappings stay on the `asCurrentUser` / `field_caps` `ESMappingFetcher`
path, which handles ECS mappings correctly, and `mcp.enabled` stays `false`. The
`McpMappingProvider` exists and is wired behind `mcp.enabled` at
`server/services/query/query.pipeline.ts` (~line 245), but is deliberately left
OFF for this reason.

---

## 3. Configuration

The four `mcp.*` keys (`server/config.ts`) and their defaults:

| Key                    | Default                       | Meaning |
| ---------------------- | ----------------------------- | ------- |
| `mcp.enabled`          | `false`                       | MAPPING path. Leave OFF — broken on ECS indices (section 2). |
| `mcp.searchEnabled`    | `false`                       | SEARCH (execution) path. Set `true` to use MCP execution. |
| `mcp.serverUrl`        | `"http://localhost:8080/mcp"` | MCP server streamable-HTTP endpoint. |
| `mcp.requestTimeoutMs` | `30000`                       | Per-request timeout budget (valid range 1000–120000). |

The two flags (`enabled` and `searchEnabled`) are **independent by design** —
enabling the live search path does not enable the (broken) mapping path.

To enable the live SEARCH path, merge this under the existing `query_copilot:`
block in `config/kibana.dev.yml`:

```yaml
query_copilot:
  mcp:
    searchEnabled: true
    # enabled: false   # mapping stays on field_caps (v0.4.6 can't decode ECS mappings)
    serverUrl: "http://localhost:8080/mcp"
```

---

## 4. Security / RBAC trade-off

The MCP path runs as the MCP container's SINGLE Elasticsearch identity (its
configured `ES_USERNAME`), **NOT** the per-request `asCurrentUser` client. This
BYPASSES per-user Kibana RBAC for any query routed through MCP: the results a
user sees reflect the MCP container's privileges, not the caller's.

That is why both flags default OFF — turning them on is an explicit, deliberate
decision and a known divergence from the default RBAC-honouring paths.

Code references: the RBAC divergence notes in `mcp.search.provider.ts`, and the
branch that selects the MCP provider in `execution.routes.ts`.

---

## 5. Version rationale

ES 8.19 → the standalone container (`docker.elastic.co/mcp/elasticsearch`) is the
supported standalone option on this version.

Elastic Agent Builder exposes an MCP endpoint at
`KIBANA/api/agent_builder/mcp`, but it requires ES 9.2+, so it is the forward
path — not available on 8.19.

---

## 6. Failure mode

With a flag ON and the container DOWN, the path throws a typed
`McpConnectionError` (or `McpTimeoutError`). There is **NO silent fallback** to
`asCurrentUser`. This is intentional: it surfaces MCP outages rather than masking
them. For the search path, `execution.routes.ts` maps the error to HTTP 500.

---

## 7. Setup runbook

1. **Run the MCP server container** (detached, NO `--rm`, port 8080). The ES
   cluster uses a self-signed cert, so `ES_SSL_SKIP_VERIFY=true` is required.
   Use real values for the placeholders — do NOT commit real credentials.

   ```bash
   docker run -d --name es-mcp -p 8080:8080 \
     -e ES_URL="https://<es-host>:9200" \
     -e ES_USERNAME="<user>" -e ES_PASSWORD="<pass>" \
     -e ES_SSL_SKIP_VERIFY=true \
     docker.elastic.co/mcp/elasticsearch:0.4.6
   ```

2. **Health check:**

   ```bash
   curl -i http://localhost:8080/ping   # expect 200
   ```

3. **Enable the search path** by merging the `kibana.dev.yml` block from
   section 3.

4. **Restart Kibana** and confirm the boot log lines:

   - `queryCopilot: MCP SEARCH path ENABLED`
   - `queryCopilot: connected to MCP server`
