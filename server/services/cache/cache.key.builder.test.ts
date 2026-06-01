import { CacheKeyBuilder } from './cache.key.builder';

describe('CacheKeyBuilder', () => {
  const b = new CacheKeyBuilder();

  it('produces a key with the expected format', () => {
    expect(b.buildKey('queryhash123', 'logs-*')).toMatch(
      /^qc:v1:[a-f0-9]{64}:queryhash123$/
    );
  });

  it('is deterministic for identical inputs', () => {
    const first = b.buildKey('queryhash123', 'logs-*');
    const second = b.buildKey('queryhash123', 'logs-*');
    expect(first).toBe(second);
  });

  it('produces different keys for different index patterns', () => {
    const keyA = b.buildKey('q', 'logs-a');
    const keyB = b.buildKey('q', 'logs-b');
    expect(keyA).not.toBe(keyB);
    expect(keyA.endsWith(':q')).toBe(true);
    expect(keyB.endsWith(':q')).toBe(true);
  });

  it('produces different keys for different query hashes', () => {
    expect(b.buildKey('q1', 'logs-*')).not.toBe(b.buildKey('q2', 'logs-*'));
  });

  it('hashes the index-pattern segment rather than embedding the raw pattern', () => {
    expect(b.buildKey('queryhash123', 'logs-*')).not.toContain('logs-*');
  });

  it("always starts with the 'qc:v1:' prefix", () => {
    expect(b.buildKey('queryhash123', 'logs-*').startsWith('qc:v1:')).toBe(true);
  });
});
