/**
 * MCP-backed {@link IndexMappingProvider}.
 *
 * Adapts {@link McpClientService} to the pipeline's {@link IndexMappingProvider}
 * seam so that index-mapping lookups can be served by the MCP server's
 * `get_mappings` tool when the `queryCopilot.mcp.enabled` feature flag is on.
 *
 * @packageDocumentation
 */

import type { ESIndexMapping, IndexMappingProvider } from '../schema/es.mapping.fetcher';
import type { McpClientService } from './mcp.client.service';

/**
 * Resolves Elasticsearch index mappings via the MCP server's `get_mappings`
 * tool, exposing them through the pipeline's {@link IndexMappingProvider}
 * contract.
 *
 * @remarks
 * **(a) RBAC DIVERGENCE.** Unlike {@link ESMappingFetcher} — which calls
 * `field_caps` as the per-request `asCurrentUser` Elasticsearch client and so
 * honours the requesting Kibana user's permissions — this provider authenticates
 * as the MCP container's own Elasticsearch identity (the credential the MCP
 * server process runs with, "Aryan"). The mapping a user sees through this path
 * therefore reflects the MCP container's privileges, NOT the caller's. This is an
 * intentional consequence of routing mappings through the MCP server.
 *
 * **(b) Identical shape.** {@link McpClientService.getMappings} performs all
 * normalization internally and returns the very same {@link ESIndexMapping} shape
 * that {@link ESMappingFetcher.fetchIndexMappings} returns. No further
 * normalization is applied here, so downstream prompt-building is agnostic to
 * which provider produced the mapping.
 *
 * **(c) No silent fallback.** When the MCP server is unreachable,
 * {@link McpClientService.getMappings} throws a typed `McpConnectionError` /
 * `McpTimeoutError`. This adapter propagates that error unchanged — there is
 * intentionally NO fallback to the `asCurrentUser` path, so an MCP outage surfaces
 * loudly rather than being silently masked.
 */
export class McpMappingProvider implements IndexMappingProvider {
  /**
   * @param mcpClient - The MCP client used to invoke the `get_mappings` tool.
   */
  constructor(private readonly mcpClient: McpClientService) {}

  /**
   * Resolve the field mappings for the given index pattern via the MCP server.
   *
   * @param indexPattern - An Elasticsearch index pattern, possibly containing
   *   wildcards (e.g. `"logs-*"`).
   * @returns A normalized {@link ESIndexMapping} (normalization happens in
   *   {@link McpClientService.getMappings}).
   * @throws {McpConnectionError} when the MCP server is unreachable.
   * @throws {McpTimeoutError} when the `get_mappings` call times out.
   * @throws {McpToolError} when the tool reports an error or returns unparseable output.
   */
  fetchIndexMappings(indexPattern: string): Promise<ESIndexMapping> {
    return this.mcpClient.getMappings(indexPattern);
  }
}
