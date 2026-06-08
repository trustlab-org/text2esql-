import type { ColumnDefinition } from '../../../common/types';
import { rowsToCsv } from './ResultsToolbar';

/**
 * Unit tests for the pure {@link rowsToCsv} helper. These run in the Node jest
 * environment (no DOM), exercising only the RFC-4180 serialisation contract —
 * the React component and its clipboard/download side effects are not rendered
 * here.
 */

/** Convenience factory for a column definition with sensible defaults. */
function col(
  id: string,
  displayName: string = id,
  dataType: ColumnDefinition['dataType'] = 'string'
): ColumnDefinition {
  return { id, displayName, dataType };
}

const CRLF = '\r\n';

describe('rowsToCsv', () => {
  it('returns a header-only line (no trailing newline) when there are no rows', () => {
    const columns = [col('@timestamp', '@timestamp'), col('source.ip', 'source.ip')];

    const csv = rowsToCsv(columns, []);

    expect(csv).toBe('@timestamp,source.ip');
    expect(csv).not.toContain(CRLF);
  });

  it('uses each column displayName for the header, in column order', () => {
    const columns = [col('host.name', 'Host'), col('event.action', 'Action')];

    const csv = rowsToCsv(columns, [{ 'host.name': 'web-01', 'event.action': 'login' }]);

    const [header] = csv.split(CRLF);
    expect(header).toBe('Host,Action');
  });

  it('emits one CRLF-terminated body line per row, values in column order', () => {
    const columns = [col('a'), col('b')];
    const rows = [
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ];

    const csv = rowsToCsv(columns, rows);

    expect(csv).toBe(['a,b', '1,2', '3,4'].join(CRLF));
    // Two rows -> header + 2 lines -> exactly two CRLF separators.
    expect(csv.split(CRLF)).toHaveLength(3);
  });

  it('takes each cell from row[column.id], not header label or array position', () => {
    const columns = [col('source.ip', 'Source IP'), col('host.name', 'Host')];
    // Object key order intentionally reversed relative to column order.
    const rows = [{ 'host.name': 'web-01', 'source.ip': '10.0.0.1' }];

    const csv = rowsToCsv(columns, rows);

    expect(csv.split(CRLF)[1]).toBe('10.0.0.1,web-01');
  });

  it('quotes and doubles inner quotes for a field containing a double quote', () => {
    const columns = [col('msg', 'Message')];

    const csv = rowsToCsv(columns, [{ msg: 'say "hi"' }]);

    expect(csv.split(CRLF)[1]).toBe('"say ""hi"""');
  });

  it('quotes a field containing a comma', () => {
    const columns = [col('msg', 'Message')];

    const csv = rowsToCsv(columns, [{ msg: 'a,b,c' }]);

    expect(csv.split(CRLF)[1]).toBe('"a,b,c"');
  });

  it('quotes a field containing a carriage return or a line feed', () => {
    const columns = [col('msg', 'Message')];

    const withLf = rowsToCsv(columns, [{ msg: 'line1\nline2' }]);
    const withCr = rowsToCsv(columns, [{ msg: 'line1\rline2' }]);

    // Split on the header separator only (index 0); the quoted field keeps its
    // embedded newline, so we assert on the remainder after the first CRLF.
    expect(withLf.slice(withLf.indexOf(CRLF) + CRLF.length)).toBe('"line1\nline2"');
    expect(withCr.slice(withCr.indexOf(CRLF) + CRLF.length)).toBe('"line1\rline2"');
  });

  it('quotes a header displayName that itself needs escaping', () => {
    const columns = [col('weird', 'a,"b"')];

    const csv = rowsToCsv(columns, []);

    expect(csv).toBe('"a,""b"""');
  });

  it('leaves a plain field unquoted', () => {
    const columns = [col('status', 'Status')];

    const csv = rowsToCsv(columns, [{ status: 'success' }]);

    expect(csv.split(CRLF)[1]).toBe('success');
  });

  it('renders null, undefined, and missing fields as empty fields', () => {
    const columns = [col('a'), col('b'), col('c')];
    // `c` is entirely absent from the row object.
    const rows = [{ a: null, b: undefined }] as ReadonlyArray<Record<string, unknown>>;

    const csv = rowsToCsv(columns, rows);

    expect(csv.split(CRLF)[1]).toBe(',,');
  });

  it('stringifies numbers and booleans via cellToString', () => {
    const columns = [col('count', 'Count', 'number'), col('ok', 'OK', 'boolean')];

    const csv = rowsToCsv(columns, [{ count: 42, ok: false }]);

    expect(csv.split(CRLF)[1]).toBe('42,false');
  });

  it('serialises object cells as JSON, quoting because of the embedded comma', () => {
    const columns = [col('geo', 'Geo', 'object')];

    const csv = rowsToCsv(columns, [{ geo: { lat: 1, lon: 2 } }]);

    // JSON.stringify -> {"lat":1,"lon":2}, which contains commas and quotes and
    // is therefore wrapped + inner-quote-doubled.
    expect(csv.split(CRLF)[1]).toBe('"{""lat"":1,""lon"":2}"');
  });

  it('produces a fully consistent multi-column, multi-row document', () => {
    const columns = [
      col('@timestamp', '@timestamp', 'date'),
      col('source.ip', 'source.ip', 'ip'),
      col('event.action', 'event.action'),
    ];
    const rows = [
      { '@timestamp': '2026-05-27T14:21:08Z', 'source.ip': '10.0.0.1', 'event.action': 'login' },
      { '@timestamp': '2026-05-27T14:22:00Z', 'source.ip': '10.0.0.2', 'event.action': 'a,b' },
    ];

    const csv = rowsToCsv(columns, rows);
    const lines = csv.split(CRLF);

    expect(lines[0]).toBe('@timestamp,source.ip,event.action');
    expect(lines).toHaveLength(3);
    // rowsToCsv calls cellToString(row[id]) WITHOUT a dataType, so the date is
    // passed through verbatim rather than reformatted (no quoting needed).
    expect(lines[1]).toBe('2026-05-27T14:21:08Z,10.0.0.1,login');
    // The comma in the last cell forces quoting.
    expect(lines[2].endsWith(',"a,b"')).toBe(true);
  });
});
