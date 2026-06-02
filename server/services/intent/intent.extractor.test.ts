import { IntentExtractorService } from './intent.extractor';
import type { NormalizedQuery } from './intent.normalizer';
import { INVESTIGATION_TYPES } from '../../../common/constants';
import type { InvestigationType } from '../../../common/types';

// ---------------------------------------------------------------------------
// IntentExtractorService is a deterministic, non-LLM pre-classifier.
//
// API (verified against intent.extractor.ts):
//   extract(normalizedQuery: NormalizedQuery): InvestigationIntent
//
// Classification mechanism: each InvestigationType has a declarative rule of
// keywords (scored by keywordWeight, default 1; powershell weight 2) and regex
// patterns (scored +3 each). The highest-scoring NON-general type wins; if no
// specific type scores, it falls back to 'general'. So we drive each test by
// feeding normalizedText that hits the target type's trigger terms.
//
// The extractor only reads `normalizedText`, so we build NormalizedQuery
// fixtures directly (lowercased, as the normalizer emits) rather than running
// the normalizer — keeps these tests deterministic and unit-scoped.
// ---------------------------------------------------------------------------

function nq(normalizedText: string): NormalizedQuery {
  return {
    originalText: normalizedText,
    normalizedText,
    cacheKey: 'test-cache-key',
  };
}

const extractor = new IntentExtractorService();

describe('IntentExtractorService', () => {
  describe('investigation type classification', () => {
    // Each query is crafted to deterministically out-score every other type
    // using that type's unique trigger keywords/patterns.
    const cases: Array<{ name: string; query: string; expected: InvestigationType }> = [
      {
        name: 'brute_force',
        query: 'investigate a brute force attack with password spray and account lockout',
        expected: INVESTIGATION_TYPES.BRUTE_FORCE,
      },
      {
        name: 'privilege_escalation',
        query: 'detect privilege escalation via uac bypass and token impersonation',
        expected: INVESTIGATION_TYPES.PRIVILEGE_ESCALATION,
      },
      {
        name: 'lateral_movement',
        query: 'find lateral movement using psexec and pass the hash',
        expected: INVESTIGATION_TYPES.LATERAL_MOVEMENT,
      },
      {
        name: 'suspicious_process',
        query: 'show suspicious process activity from certutil and other lolbin execution',
        expected: INVESTIGATION_TYPES.SUSPICIOUS_PROCESS,
      },
      {
        name: 'persistence',
        query: 'hunt for persistence via scheduled task and registry run key backdoor',
        expected: INVESTIGATION_TYPES.PERSISTENCE,
      },
      {
        name: 'unusual_outbound',
        query: 'detect data exfiltration with beaconing to command and control infrastructure',
        expected: INVESTIGATION_TYPES.UNUSUAL_OUTBOUND,
      },
      {
        name: 'suspicious_powershell',
        query: 'powershell with encoded command running invoke-expression and downloadstring',
        expected: INVESTIGATION_TYPES.SUSPICIOUS_POWERSHELL,
      },
      {
        name: 'auth_anomaly',
        query: 'flag impossible travel and golden ticket with anomalous login behaviour',
        expected: INVESTIGATION_TYPES.AUTH_ANOMALY,
      },
      {
        name: 'failed_login',
        query:
          'show ssh auth failure and pam failure with incorrect password, bad credentials and logon failure',
        expected: INVESTIGATION_TYPES.FAILED_LOGIN,
      },
      {
        name: 'parent_child_anomaly',
        query: 'investigate parent-child process tree with word spawning a child process from winword.exe',
        expected: INVESTIGATION_TYPES.PARENT_CHILD_ANOMALY,
      },
      {
        name: 'threat_hunting',
        query: 'threat hunting for an ioc tied to a known apt campaign using mitre att&ck ttp',
        expected: INVESTIGATION_TYPES.THREAT_HUNTING,
      },
      {
        // note: 'general' is the catch-all fallback. It is only selected when no
        // specific type scores above zero, so the query intentionally avoids all
        // specific-type triggers and uses only generic 'general' keywords.
        name: 'general',
        query: 'show me events and logs of recent activity',
        expected: INVESTIGATION_TYPES.GENERAL,
      },
    ];

    it.each(cases)('classifies "$name" queries as $expected', ({ query, expected }) => {
      const intent = extractor.extract(nq(query));
      expect(intent.type).toBe(expected);
    });

    it('produces a confidence in (0, 1] and reasoning text for a classified query', () => {
      const intent = extractor.extract(nq('investigate a brute force attack with password spray'));
      expect(intent.confidence).toBeGreaterThan(0);
      expect(intent.confidence).toBeLessThanOrEqual(1);
      expect(typeof intent.reasoning).toBe('string');
      expect(intent.reasoning.length).toBeGreaterThan(0);
    });
  });

  describe('time range extraction', () => {
    it('extracts a relative time range from "in the last 24 hours"', () => {
      const intent = extractor.extract(nq('show failed login in the last 24 hours'));
      expect(intent.timeRangeHint).not.toBeNull();
      expect(intent.timeRangeHint?.relative).toBe('last 24 hours');
      expect(typeof intent.timeRangeHint?.from).toBe('string');
      expect(typeof intent.timeRangeHint?.to).toBe('string');
      // from is earlier than to
      expect(
        new Date(intent.timeRangeHint!.from!).getTime()
      ).toBeLessThan(new Date(intent.timeRangeHint!.to!).getTime());
    });

    it('extracts a relative time range from "last 7 days"', () => {
      const intent = extractor.extract(nq('lateral movement over the past last 7 days'));
      expect(intent.timeRangeHint?.relative).toBe('last 7 days');
    });

    it('extracts an absolute from/to time range', () => {
      const intent = extractor.extract(
        nq('failed login from 2024-01-01 to 2024-01-07 on the domain controller')
      );
      expect(intent.timeRangeHint).not.toBeNull();
      expect(intent.timeRangeHint?.relative).toBeUndefined();
      expect(intent.timeRangeHint?.from).toBe('2024-01-01T00:00:00Z');
      expect(intent.timeRangeHint?.to).toBe('2024-01-07T00:00:00Z');
    });

    it('returns null timeRangeHint when no time expression is present', () => {
      const intent = extractor.extract(nq('show suspicious process activity from certutil'));
      expect(intent.timeRangeHint).toBeNull();
    });
  });

  describe('entity extraction', () => {
    it('extracts IPv4 addresses', () => {
      const intent = extractor.extract(nq('connections from 10.0.0.5 to 192.168.1.20'));
      expect(intent.entitiesExtracted.ipAddresses).toContain('10.0.0.5');
      expect(intent.entitiesExtracted.ipAddresses).toContain('192.168.1.20');
    });

    it('extracts hostnames (FQDNs) and excludes IPs', () => {
      const intent = extractor.extract(nq('logins on dc01.corp.example.com from 10.0.0.5'));
      expect(intent.entitiesExtracted.hostnames).toContain('dc01.corp.example.com');
      expect(intent.entitiesExtracted.hostnames).not.toContain('10.0.0.5');
    });

    it('extracts usernames from explicit prefixes', () => {
      const intent = extractor.extract(nq('failed login for user:jsmith and account:bob'));
      expect(intent.entitiesExtracted.usernames).toContain('jsmith');
      expect(intent.entitiesExtracted.usernames).toContain('bob');
    });

    it('extracts ports', () => {
      const intent = extractor.extract(nq('unusual outbound traffic on port 4444'));
      expect(intent.entitiesExtracted.ports).toContain(4444);
    });

    it('returns empty entity collections when none are present', () => {
      const intent = extractor.extract(nq('show me recent activity'));
      expect(intent.entitiesExtracted.ipAddresses).toHaveLength(0);
      expect(intent.entitiesExtracted.usernames).toHaveLength(0);
      expect(intent.entitiesExtracted.ports).toHaveLength(0);
    });
  });
});
