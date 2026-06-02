import type { estypes } from '@elastic/elasticsearch';
import { ResultNormalizer } from './result.normalizer';

type Hit = estypes.SearchHit<Record<string, unknown>>;

/** Builds a minimal SearchHit from a `_source` object. */
function hit(source: Record<string, unknown> | null): Hit {
  return { _index: 'logs-1', _id: '1', _source: source ?? undefined } as Hit;
}

describe('ResultNormalizer', () => {
  const normalizer = new ResultNormalizer();

  it('flattens nested plain objects into dot-notation paths', () => {
    const { columns, rows } = normalizer.normalizeHits([
      hit({ source: { ip: '10.0.0.1', port: 443 }, message: 'ok' }),
    ]);

    const ids = columns.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['source.ip', 'source.port', 'message']));
    expect(rows[0]['source.ip']).toBe('10.0.0.1');
    expect(rows[0]['source.port']).toBe(443);
    expect(rows[0].message).toBe('ok');
  });

  it('treats arrays and primitives as leaf values', () => {
    const { rows } = normalizer.normalizeHits([
      hit({ tags: ['a', 'b'], count: 3, ok: true, nothing: null }),
    ]);
    expect(rows[0].tags).toEqual(['a', 'b']);
    expect(rows[0].count).toBe(3);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].nothing).toBeNull();
  });

  it('always puts @timestamp first when present', () => {
    const { columns } = normalizer.normalizeHits([
      hit({ message: 'a', '@timestamp': '2026-05-27T14:21:08Z' }),
    ]);
    expect(columns[0].id).toBe('@timestamp');
  });

  it('collects the union of fields across hits in first-seen order', () => {
    const { columns } = normalizer.normalizeHits([
      hit({ a: 1, b: 2 }),
      hit({ b: 3, c: 4 }),
    ]);
    expect(columns.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('caps the column list at maxFields', () => {
    const source: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) {
      source[`f${i}`] = i;
    }
    const { columns } = normalizer.normalizeHits([hit(source)], 20);
    expect(columns).toHaveLength(20);
  });

  it('guards against missing _source', () => {
    const { columns, rows } = normalizer.normalizeHits([hit(null)]);
    expect(columns).toEqual([]);
    expect(rows[0]).toEqual({});
  });

  it('infers data types from field name and sampled value', () => {
    const { columns } = normalizer.normalizeHits([
      hit({
        '@timestamp': '2026-05-27T14:21:08Z',
        'source.ip': '192.168.1.1',
        bytes: 42,
        enabled: true,
        labels: ['a', 'b'],
        message: 'hello',
        'event.time': '2026-05-27T14:21:08Z',
      }),
    ]);
    const byId = Object.fromEntries(columns.map((c) => [c.id, c.dataType]));
    expect(byId['@timestamp']).toBe('date');
    expect(byId['event.time']).toBe('date');
    expect(byId['source.ip']).toBe('ip');
    expect(byId.bytes).toBe('number');
    expect(byId.enabled).toBe('boolean');
    expect(byId.labels).toBe('object');
    expect(byId.message).toBe('string');
  });
});
