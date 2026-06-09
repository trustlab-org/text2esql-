import { McpMappingProvider } from './mcp.mapping.provider';
import { McpConnectionError } from './errors';
import type { McpClientService } from './mcp.client.service';
import type { ESIndexMapping } from '../schema/es.mapping.fetcher';

function makeMapping(): ESIndexMapping {
  return {
    indexPattern: 'logs-*',
    fields: new Map([
      ['user.name', { name: 'user.name', type: 'keyword', searchable: true, aggregatable: true }],
    ]),
    fetchedAt: new Date(),
  };
}

describe('McpMappingProvider', () => {
  it('delegates fetchIndexMappings to mcpClient.getMappings and returns its result', async () => {
    const mapping = makeMapping();
    const getMappings = jest.fn().mockResolvedValue(mapping);
    const mcpClient = { getMappings } as unknown as McpClientService;

    const provider = new McpMappingProvider(mcpClient);
    const result = await provider.fetchIndexMappings('logs-*');

    expect(getMappings).toHaveBeenCalledTimes(1);
    expect(getMappings).toHaveBeenCalledWith('logs-*');
    expect(result).toBe(mapping);
  });

  it('propagates a typed McpConnectionError from getMappings unchanged (no fallback)', async () => {
    const error = new McpConnectionError('ECONNREFUSED');
    const getMappings = jest.fn().mockRejectedValue(error);
    const mcpClient = { getMappings } as unknown as McpClientService;

    const provider = new McpMappingProvider(mcpClient);

    await expect(provider.fetchIndexMappings('logs-*')).rejects.toBe(error);
  });
});
