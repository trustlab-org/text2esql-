/**
 * Unit tests for the PURE helpers in {@link ./cell_renderers}: formatters,
 * type-guards, the sort comparator, and the semantic badge map. The React
 * `renderCell` entry point is intentionally not exercised here (it composes the
 * pure pieces, which are covered directly).
 */

import {
  badgeForField,
  cellToString,
  compareValues,
  formatNumber,
  formatRelative,
  formatTimestamp,
  isIpAddress,
  isObjectValue,
  isTimestampField,
  objectKeyCount,
  pad2,
  CELL_TOOLTIP_THRESHOLD,
  type BadgeSpec,
} from './cell_renderers';

describe('pad2', () => {
  it('pads single digits to width 2', () => {
    expect(pad2(0)).toBe('00');
    expect(pad2(5)).toBe('05');
    expect(pad2(9)).toBe('09');
  });

  it('leaves two-or-more digit numbers unchanged', () => {
    expect(pad2(10)).toBe('10');
    expect(pad2(59)).toBe('59');
    expect(pad2(123)).toBe('123');
  });
});

describe('formatTimestamp', () => {
  it('formats a parseable date as local YYYY-MM-DD HH:MM:SS', () => {
    // Construct via local-time components so the assertion is timezone-stable.
    const d = new Date(2026, 4, 27, 14, 21, 8); // 2026-05-27 14:21:08 local
    expect(formatTimestamp(d.toISOString())).toBe('2026-05-27 14:21:08');
  });

  it('zero-pads month, day, and time components', () => {
    const d = new Date(2026, 0, 3, 4, 5, 6); // 2026-01-03 04:05:06 local
    expect(formatTimestamp(d.getTime())).toBe('2026-01-03 04:05:06');
  });

  it('returns String(value) for unparseable input', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
    expect(formatTimestamp(undefined)).toBe('undefined');
    // NB: `new Date(null)` coerces to the epoch (not Invalid Date), so `null`
    // is intentionally NOT in this "unparseable" set — see the epoch case below.
  });

  it('treats null as the epoch, mirroring `new Date(null)`', () => {
    const epoch = new Date(0); // local epoch
    expect(formatTimestamp(null)).toBe(
      `${epoch.getFullYear()}-${pad2(epoch.getMonth() + 1)}-${pad2(epoch.getDate())} ` +
        `${pad2(epoch.getHours())}:${pad2(epoch.getMinutes())}:${pad2(epoch.getSeconds())}`
    );
  });
});

describe('formatRelative', () => {
  const NOW = new Date('2026-06-08T12:00:00.000Z').getTime();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('describes past dates with an "ago" suffix', () => {
    expect(formatRelative(new Date(NOW - 5 * 60 * 1000))).toBe('5 minutes ago');
    expect(formatRelative(new Date(NOW - 2 * 60 * 60 * 1000))).toBe('2 hours ago');
  });

  it('describes future dates with an "in" prefix', () => {
    expect(formatRelative(new Date(NOW + 3 * 24 * 60 * 60 * 1000))).toBe('in 3 days');
  });

  it('uses singular units for a count of one', () => {
    expect(formatRelative(new Date(NOW - 1 * 60 * 1000))).toBe('1 minute ago');
    expect(formatRelative(new Date(NOW + 1 * 24 * 60 * 60 * 1000))).toBe('in 1 day');
  });

  it('chooses the largest unit that fits', () => {
    expect(formatRelative(new Date(NOW - 90 * 1000))).toBe('2 minutes ago'); // rounds
    expect(formatRelative(new Date(NOW - 365 * 24 * 60 * 60 * 1000))).toBe('1 year ago');
  });

  it('floors sub-second deltas to "1 second ago"', () => {
    expect(formatRelative(new Date(NOW - 200))).toBe('1 second ago');
  });
});

describe('formatNumber', () => {
  it('inserts locale thousands separators', () => {
    // toLocaleString() is locale-dependent; assert via the same primitive so
    // the test is environment-stable while still exercising the grouping path.
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
    expect(formatNumber(1000)).toBe((1000).toLocaleString());
  });

  it('leaves small numbers ungrouped', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(42)).toBe('42');
  });

  it('returns String(value) for non-finite numbers', () => {
    expect(formatNumber(NaN)).toBe('NaN');
    expect(formatNumber(Infinity)).toBe('Infinity');
    expect(formatNumber(-Infinity)).toBe('-Infinity');
  });
});

describe('isTimestampField', () => {
  it('is true for the @timestamp field regardless of value', () => {
    expect(isTimestampField('@timestamp', 'whatever')).toBe(true);
    expect(isTimestampField('@timestamp', 12345)).toBe(true);
  });

  it('is true for names ending with "timestamp" or ".time"', () => {
    expect(isTimestampField('event.timestamp', null)).toBe(true);
    expect(isTimestampField('process.start.time', null)).toBe(true);
  });

  it('is true for ISO-looking string values', () => {
    expect(isTimestampField('created', '2026-05-27T14:21:08Z')).toBe(true);
    expect(isTimestampField('created', '2026-05-27 14:21:08')).toBe(true);
  });

  it('is false for non-timestamp fields with non-ISO values', () => {
    expect(isTimestampField('host.name', 'web-01')).toBe(false);
    expect(isTimestampField('count', 5)).toBe(false);
    expect(isTimestampField('note', '2026-05-27')).toBe(false); // no time part
  });
});

describe('isIpAddress', () => {
  it('matches IPv4 dotted-quad addresses', () => {
    expect(isIpAddress('192.168.1.1')).toBe(true);
    expect(isIpAddress('10.0.0.255')).toBe(true);
    expect(isIpAddress('0.0.0.0')).toBe(true);
  });

  it('matches full and leading-"::" IPv6 addresses', () => {
    expect(isIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
    expect(isIpAddress('fe80:0:0:0:0:0:0:1')).toBe(true);
    expect(isIpAddress('::1')).toBe(true);
  });

  it('does NOT match mid-string "::" compression (loose-matcher limitation)', () => {
    // The ported IPv6 matcher is intentionally loose: it only handles fully
    // expanded groups or a leading `::`, not interior compression. Documenting
    // the known boundary so the behaviour is not silently "fixed".
    expect(isIpAddress('fe80::1')).toBe(false);
    expect(isIpAddress('2001:db8::8a2e:370:7334')).toBe(false);
  });

  it('rejects non-IP strings and out-of-range octets', () => {
    expect(isIpAddress('999.999.999.999')).toBe(false);
    expect(isIpAddress('not.an.ip.addr')).toBe(false);
    expect(isIpAddress('web-server-01')).toBe(false);
  });

  it('stringifies the value before matching', () => {
    expect(isIpAddress(192)).toBe(false);
  });
});

describe('isObjectValue', () => {
  it('is true for plain objects and arrays', () => {
    expect(isObjectValue({})).toBe(true);
    expect(isObjectValue({ a: 1 })).toBe(true);
    expect(isObjectValue([])).toBe(true);
    expect(isObjectValue([1, 2, 3])).toBe(true);
  });

  it('is false for null and primitives', () => {
    expect(isObjectValue(null)).toBe(false);
    expect(isObjectValue(undefined)).toBe(false);
    expect(isObjectValue('str')).toBe(false);
    expect(isObjectValue(7)).toBe(false);
    expect(isObjectValue(true)).toBe(false);
  });
});

describe('objectKeyCount', () => {
  it('returns array length for arrays', () => {
    expect(objectKeyCount([])).toBe(0);
    expect(objectKeyCount([1, 2, 3])).toBe(3);
  });

  it('returns own-key count for plain objects', () => {
    expect(objectKeyCount({})).toBe(0);
    expect(objectKeyCount({ a: 1, b: 2 })).toBe(2);
  });

  it('returns 0 for non-objects', () => {
    expect(objectKeyCount(null)).toBe(0);
    expect(objectKeyCount('str')).toBe(0);
    expect(objectKeyCount(42)).toBe(0);
  });
});

describe('cellToString', () => {
  it('returns the empty string for null and undefined', () => {
    expect(cellToString(null)).toBe('');
    expect(cellToString(undefined)).toBe('');
  });

  it('JSON-stringifies objects and arrays', () => {
    expect(cellToString({ a: 1 })).toBe('{"a":1}');
    expect(cellToString([1, 'two'])).toBe('[1,"two"]');
  });

  it('stringifies primitives', () => {
    expect(cellToString('hello')).toBe('hello');
    expect(cellToString(42)).toBe('42');
    expect(cellToString(false)).toBe('false');
  });
});

describe('compareValues', () => {
  it('sorts null/undefined last regardless of direction', () => {
    expect(compareValues(null, 5)).toBe(1);
    expect(compareValues(5, null)).toBe(-1);
    expect(compareValues(undefined, 'a')).toBe(1);
    expect(compareValues('a', undefined)).toBe(-1);
  });

  it('treats two missing values as equal', () => {
    expect(compareValues(null, undefined)).toBe(0);
    expect(compareValues(undefined, undefined)).toBe(0);
  });

  it('compares numbers numerically', () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues(10, 2)).toBeGreaterThan(0);
    expect(compareValues(5, 5)).toBe(0);
  });

  it('compares non-numbers via localeCompare', () => {
    expect(compareValues('apple', 'banana')).toBeLessThan(0);
    expect(compareValues('banana', 'apple')).toBeGreaterThan(0);
  });
});

describe('badgeForField', () => {
  /** Asserts the resolved badge equals the expected color/label. */
  const expectBadge = (actual: BadgeSpec | null, color: string, label: string): void => {
    expect(actual).not.toBeNull();
    expect(actual?.color).toBe(color);
    expect(actual?.label).toBe(label);
  };

  describe('booleans (rule 1)', () => {
    it('maps true to success and false to default via value', () => {
      expectBadge(badgeForField('enabled', true), 'success', 'true');
      expectBadge(badgeForField('enabled', false), 'default', 'false');
    });

    it('maps via the boolean dataType', () => {
      expectBadge(badgeForField('flag', true, 'boolean'), 'success', 'true');
      expectBadge(badgeForField('flag', false, 'boolean'), 'default', 'false');
    });

    it('takes precedence over outcome/level field names', () => {
      expectBadge(badgeForField('event.outcome', true), 'success', 'true');
    });
  });

  describe('outcome (rule 2)', () => {
    it('maps ok/success to success', () => {
      expectBadge(badgeForField('event.outcome', 'ok'), 'success', 'ok');
      expectBadge(badgeForField('event.outcome', 'success'), 'success', 'success');
    });

    it('maps failure/error to danger', () => {
      expectBadge(badgeForField('event.outcome', 'failure'), 'danger', 'failure');
      expectBadge(badgeForField('event.outcome', 'error'), 'danger', 'error');
    });

    it('maps anything else to warning', () => {
      expectBadge(badgeForField('event.outcome', 'unknown'), 'warning', 'unknown');
    });

    it('matches *.outcome suffixes and is case-insensitive', () => {
      expectBadge(badgeForField('transaction.outcome', 'OK'), 'success', 'OK');
      expectBadge(badgeForField('transaction.outcome', 'Failure'), 'danger', 'Failure');
    });
  });

  describe('level / severity (rule 3)', () => {
    it('maps CRITICAL/FATAL/ERROR to danger', () => {
      expectBadge(badgeForField('log.level', 'CRITICAL'), 'danger', 'CRITICAL');
      expectBadge(badgeForField('log.level', 'FATAL'), 'danger', 'FATAL');
      expectBadge(badgeForField('log.level', 'ERROR'), 'danger', 'ERROR');
    });

    it('maps WARN/WARNING to warning', () => {
      expectBadge(badgeForField('log.level', 'WARN'), 'warning', 'WARN');
      expectBadge(badgeForField('log.level', 'WARNING'), 'warning', 'WARNING');
    });

    it('maps INFO/NOTICE to primary', () => {
      expectBadge(badgeForField('log.level', 'INFO'), 'primary', 'INFO');
      expectBadge(badgeForField('log.level', 'NOTICE'), 'primary', 'NOTICE');
    });

    it('maps DEBUG/TRACE to default', () => {
      expectBadge(badgeForField('log.level', 'DEBUG'), 'default', 'DEBUG');
      expectBadge(badgeForField('log.level', 'TRACE'), 'default', 'TRACE');
    });

    it('maps unrecognised levels to hollow', () => {
      expectBadge(badgeForField('log.level', 'custom'), 'hollow', 'custom');
    });

    it('matches *.level and *severity suffixes, case-insensitively', () => {
      expectBadge(badgeForField('app.level', 'error'), 'danger', 'error');
      expectBadge(badgeForField('event.severity', 'warn'), 'warning', 'warn');
    });
  });

  describe('action / category (rule 4)', () => {
    it('maps event.action and event.category to hollow', () => {
      expectBadge(badgeForField('event.action', 'login'), 'hollow', 'login');
      expectBadge(badgeForField('event.category', 'authentication'), 'hollow', 'authentication');
    });

    it('matches *.action and *.category suffixes', () => {
      expectBadge(badgeForField('user.action', 'click'), 'hollow', 'click');
      expectBadge(badgeForField('threat.category', 'malware'), 'hollow', 'malware');
    });
  });

  describe('no badge (rule 5)', () => {
    it('returns null for generic fields', () => {
      expect(badgeForField('host.name', 'web-01')).toBeNull();
      expect(badgeForField('source.ip', '10.0.0.1')).toBeNull();
      expect(badgeForField('message', 'hello')).toBeNull();
    });
  });
});

describe('CELL_TOOLTIP_THRESHOLD', () => {
  it('is the pinned value of 50', () => {
    expect(CELL_TOOLTIP_THRESHOLD).toBe(50);
  });
});
