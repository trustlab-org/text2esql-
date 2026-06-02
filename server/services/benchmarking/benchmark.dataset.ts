import { INVESTIGATION_TYPES } from '../../../common';
import type { InvestigationType } from '../../../common';

/**
 * A single benchmark case: a natural-language SOC analyst request paired with
 * the ECS fields and KQL filters a *good* generated query is expected to use.
 *
 * - `expectedKQLContains` — ECS field NAMES that must appear somewhere in the
 *   generated KQL (e.g. `event.outcome`). Used for field-coverage scoring.
 * - `expectedFilters` — concrete filter clauses (e.g. `event.outcome : "failure"`)
 *   that should be present. Matched whitespace-insensitively by the scorer.
 */
export interface BenchmarkCase {
  readonly id: string;
  readonly investigationType: InvestigationType;
  readonly naturalLanguageQuery: string;
  /** ECS field names that MUST appear in the generated KQL. */
  readonly expectedKQLContains: readonly string[];
  readonly expectedFilters: readonly string[];
}

/**
 * Curated, ECS-accurate SOC benchmark cases used to evaluate provider quality.
 *
 * Per-investigation-type minimums (all satisfied below):
 *   brute_force ×3 · privilege_escalation ×2 · lateral_movement ×2 ·
 *   suspicious_process ×3 · auth_anomaly ×3 · unusual_outbound ×2 ·
 *   suspicious_powershell ×2 · general ×3.
 */
export const BENCHMARK_DATASET: readonly BenchmarkCase[] = [
  // ----- brute_force (3) -----
  {
    id: 'bf-01',
    investigationType: INVESTIGATION_TYPES.BRUTE_FORCE,
    naturalLanguageQuery: 'Show failed SSH logins from external IPs in the last hour',
    expectedKQLContains: ['event.category', 'event.outcome', 'source.ip', 'user.name'],
    expectedFilters: ['event.outcome : "failure"', 'event.category : "authentication"'],
  },
  {
    id: 'bf-02',
    investigationType: INVESTIGATION_TYPES.BRUTE_FORCE,
    naturalLanguageQuery:
      'Find accounts with many failed authentication attempts from a single source address',
    expectedKQLContains: ['event.outcome', 'source.ip', 'user.name', 'event.action'],
    expectedFilters: ['event.outcome : "failure"'],
  },
  {
    id: 'bf-03',
    investigationType: INVESTIGATION_TYPES.BRUTE_FORCE,
    naturalLanguageQuery: 'List repeated failed RDP login attempts against Windows hosts',
    expectedKQLContains: ['event.category', 'event.outcome', 'source.ip', 'host.name'],
    expectedFilters: ['event.category : "authentication"', 'event.outcome : "failure"'],
  },

  // ----- privilege_escalation (2) -----
  {
    id: 'priv-01',
    investigationType: INVESTIGATION_TYPES.PRIVILEGE_ESCALATION,
    naturalLanguageQuery: 'Show users added to administrator or privileged groups today',
    expectedKQLContains: ['event.action', 'user.name', 'user.target.name', 'event.category'],
    expectedFilters: ['event.action : "added-user-to-group"'],
  },
  {
    id: 'priv-02',
    investigationType: INVESTIGATION_TYPES.PRIVILEGE_ESCALATION,
    naturalLanguageQuery: 'Find sudo or runas executions that elevated to root or SYSTEM',
    expectedKQLContains: ['event.action', 'user.name', 'process.name', 'event.category'],
    expectedFilters: ['event.category : "process"'],
  },

  // ----- lateral_movement (2) -----
  {
    id: 'lat-01',
    investigationType: INVESTIGATION_TYPES.LATERAL_MOVEMENT,
    naturalLanguageQuery: 'Detect SMB connections between internal hosts used to move laterally',
    expectedKQLContains: ['source.ip', 'destination.ip', 'network.protocol', 'user.name'],
    expectedFilters: ['network.protocol : "smb"'],
  },
  {
    id: 'lat-02',
    investigationType: INVESTIGATION_TYPES.LATERAL_MOVEMENT,
    naturalLanguageQuery: 'Show remote WMI or RDP sessions from one workstation to many servers',
    expectedKQLContains: ['source.ip', 'destination.ip', 'destination.port', 'user.name'],
    expectedFilters: ['destination.port : 3389'],
  },

  // ----- suspicious_process (3) -----
  {
    id: 'proc-01',
    investigationType: INVESTIGATION_TYPES.SUSPICIOUS_PROCESS,
    naturalLanguageQuery: 'Find cmd.exe or powershell.exe spawned by Microsoft Word',
    expectedKQLContains: ['process.name', 'process.parent.name', 'host.name', 'event.category'],
    expectedFilters: ['process.parent.name : "winword.exe"'],
  },
  {
    id: 'proc-02',
    investigationType: INVESTIGATION_TYPES.SUSPICIOUS_PROCESS,
    naturalLanguageQuery: 'Show processes launched from temporary or download directories',
    expectedKQLContains: ['process.name', 'process.executable', 'host.name', 'event.category'],
    expectedFilters: ['event.category : "process"'],
  },
  {
    id: 'proc-03',
    investigationType: INVESTIGATION_TYPES.SUSPICIOUS_PROCESS,
    naturalLanguageQuery: 'List rundll32 executions with unusual parent processes on servers',
    expectedKQLContains: ['process.name', 'process.parent.name', 'host.name'],
    expectedFilters: ['process.name : "rundll32.exe"'],
  },

  // ----- auth_anomaly (3) -----
  {
    id: 'auth-01',
    investigationType: INVESTIGATION_TYPES.AUTH_ANOMALY,
    naturalLanguageQuery: 'Show successful logins from countries we do not normally operate in',
    expectedKQLContains: [
      'event.outcome',
      'user.name',
      'source.geo.country_name',
      'event.action',
    ],
    expectedFilters: ['event.outcome : "success"'],
  },
  {
    id: 'auth-02',
    investigationType: INVESTIGATION_TYPES.AUTH_ANOMALY,
    naturalLanguageQuery: 'Find users logging in at unusual hours from new source IPs',
    expectedKQLContains: ['event.outcome', 'user.name', 'source.ip', 'event.action'],
    expectedFilters: ['event.category : "authentication"'],
  },
  {
    id: 'auth-03',
    investigationType: INVESTIGATION_TYPES.AUTH_ANOMALY,
    naturalLanguageQuery: 'Detect impossible-travel logins for the same user across geographies',
    expectedKQLContains: ['user.name', 'source.geo.country_name', 'source.ip', 'event.outcome'],
    expectedFilters: ['event.outcome : "success"'],
  },

  // ----- unusual_outbound (2) -----
  {
    id: 'out-01',
    investigationType: INVESTIGATION_TYPES.UNUSUAL_OUTBOUND,
    naturalLanguageQuery: 'Show outbound connections to port 4444 indicating C2 beaconing',
    expectedKQLContains: ['destination.ip', 'destination.port', 'network.bytes', 'source.ip'],
    expectedFilters: ['destination.port : 4444'],
  },
  {
    id: 'out-02',
    investigationType: INVESTIGATION_TYPES.UNUSUAL_OUTBOUND,
    naturalLanguageQuery: 'Find hosts sending large volumes of data to external destinations',
    expectedKQLContains: ['destination.ip', 'network.bytes', 'source.ip', 'network.direction'],
    expectedFilters: ['network.direction : "outbound"'],
  },

  // ----- suspicious_powershell (2) -----
  {
    id: 'ps-01',
    investigationType: INVESTIGATION_TYPES.SUSPICIOUS_POWERSHELL,
    naturalLanguageQuery: 'Find encoded PowerShell commands using the EncodedCommand flag',
    expectedKQLContains: ['process.name', 'process.command_line', 'event.category'],
    expectedFilters: ['process.name : "powershell.exe"'],
  },
  {
    id: 'ps-02',
    investigationType: INVESTIGATION_TYPES.SUSPICIOUS_POWERSHELL,
    naturalLanguageQuery: 'Show PowerShell downloading and executing remote scripts via the web',
    expectedKQLContains: ['process.name', 'process.command_line', 'host.name'],
    expectedFilters: ['process.name : "powershell.exe"'],
  },

  // ----- general (3) -----
  {
    id: 'gen-01',
    investigationType: INVESTIGATION_TYPES.GENERAL,
    naturalLanguageQuery: 'Show all error logs from web servers today',
    expectedKQLContains: ['event.dataset', 'log.level', 'host.name'],
    expectedFilters: ['log.level : "error"'],
  },
  {
    id: 'gen-02',
    investigationType: INVESTIGATION_TYPES.GENERAL,
    naturalLanguageQuery: 'Find all events for a specific host over the past 24 hours',
    expectedKQLContains: ['host.name', 'event.category', '@timestamp'],
    expectedFilters: [],
  },
  {
    id: 'gen-03',
    investigationType: INVESTIGATION_TYPES.GENERAL,
    naturalLanguageQuery: 'List recent firewall denies for a given destination network',
    expectedKQLContains: ['event.action', 'destination.ip', 'event.outcome'],
    expectedFilters: ['event.outcome : "deny"'],
  },
];

/** Convenience: total number of benchmark cases. */
export const BENCHMARK_CASE_COUNT = BENCHMARK_DATASET.length;
