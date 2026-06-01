import type { NormalizedQuery } from './intent.normalizer';
import type {
  InvestigationIntent,
  InvestigationType,
  TimeRangeHint,
  ExtractedEntities,
} from '../../../common/types';
import type { ECSField } from '../../../common/types';
import { INVESTIGATION_TYPES, QUERY_LANGUAGES } from '../../../common/constants';

// ---------------------------------------------------------------------------
// InvestigationTypeRule — declarative rule entry per investigation type
// ---------------------------------------------------------------------------

interface InvestigationTypeRule {
  /** All keywords are evaluated against the normalized (lowercased) query. */
  readonly keywords: readonly string[];
  /**
   * Regex patterns applied to the normalized text for stronger signal.
   * Any match adds PATTERN_SCORE to the type's total score.
   */
  readonly patterns: readonly RegExp[];
  /**
   * Score weight for a keyword hit (each distinct keyword match).
   * Default: 1. Set higher for unambiguous keywords.
   */
  readonly keywordWeight?: number;
  /** Suggested ECS fields relevant to this investigation type. */
  readonly suggestedEcsFieldNames: readonly string[];
  /** Preferred query language for this type. */
  readonly suggestedLanguage: (typeof QUERY_LANGUAGES)[keyof typeof QUERY_LANGUAGES];
}

const PATTERN_SCORE = 3; // regex match is stronger signal than a keyword

// ---------------------------------------------------------------------------
// INVESTIGATION_TYPE_RULES
//
// Coverage matrix — all 12 InvestigationType values.
//
// Keyword strategy:
//   - Include domain-specific terms that an analyst would naturally type
//   - Include ECS field names they might reference explicitly
//   - Include MITRE ATT&CK technique names / tactic names where applicable
//   - Avoid overly generic terms to minimise false-positive cross-type scoring
// ---------------------------------------------------------------------------

const INVESTIGATION_TYPE_RULES: Readonly<
  Record<InvestigationType, InvestigationTypeRule>
> = {
  // ── T1110 / T1190 — Brute Force ──────────────────────────────────────────
  [INVESTIGATION_TYPES.BRUTE_FORCE]: {
    keywords: [
      'brute force',
      'brute-force',
      'bruteforce',
      'password spray',
      'credential stuffing',
      'failed login',
      'failed logins',
      'failed authentication',
      'multiple failures',
      'repeated failures',
      'login attempts',
      'auth failures',
      'authentication failures',
      'wrong password',
      'account lockout',
      'lockout',
      'bad password',
      'invalid credentials',
      'event.outcome:failure',
      'winlogon',
      '4625',      // Windows event: failed logon
      '4771',      // Windows event: Kerberos pre-auth failed
    ],
    patterns: [
      /failed\s+(login|logon|auth(?:entication)?)\s+attempt/i,
      /\d+\s+(failed|bad|invalid)\s+(login|logon|auth)/i,
      /account\s+lock(?:ed|out)/i,
    ],
    keywordWeight: 1,
    suggestedEcsFieldNames: [
      'user.name',
      'source.ip',
      'event.outcome',
      'event.action',
      '@timestamp',
      'host.name',
    ],
    suggestedLanguage: QUERY_LANGUAGES.EQL,
  },

  // ── T1068 / T1134 — Privilege Escalation ─────────────────────────────────
  [INVESTIGATION_TYPES.PRIVILEGE_ESCALATION]: {
    keywords: [
      'privilege escalation',
      'privesc',
      'priv esc',
      'elevated privilege',
      'privilege elevation',
      'admin rights',
      'root access',
      'sudoers',
      'sudo -i',
      'runas',
      'impersonation',
      'token impersonation',
      'token theft',
      'uac bypass',
      'uac',
      'setuid',
      'setgid',
      'suid',
      'sgid',
      'whoami /priv',
      'getsystem',
      'bypassuac',
      'user.effective',
      'seimpersonateprivilege',
      'sedebugprivilege',
      '4672',   // Windows: special privileges assigned
      '4673',   // Windows: privileged service called
    ],
    patterns: [
      /escalat\w+\s+privile\w+/i,
      /user\.effective\.name/i,
      /sudo\s+(-[a-z]+\s+)*[a-z]/i,
    ],
    keywordWeight: 1,
    suggestedEcsFieldNames: [
      'user.name',
      'user.effective.name',
      'process.name',
      'process.args',
      'event.action',
      'host.name',
    ],
    suggestedLanguage: QUERY_LANGUAGES.EQL,
  },

  // ── T1021 — Lateral Movement ──────────────────────────────────────────────
  [INVESTIGATION_TYPES.LATERAL_MOVEMENT]: {
    keywords: [
      'lateral movement',
      'lateral move',
      'moving laterally',
      'pass the hash',
      'pth',
      'pass-the-hash',
      'pass the ticket',
      'overpass the hash',
      'wmi',
      'psexec',
      'winrm',
      'wsman',
      'smb lateral',
      'remote execution',
      'admin share',
      'c$',
      'ipc$',
      'rdp',
      'remote desktop',
      'ssh lateral',
      'pivoting',
      'pivot',
      'network hop',
      'east-west',
      't1021',
    ],
    patterns: [
      /lateral\s+mov\w+/i,
      /pass[- ]the[- ](hash|ticket)/i,
      /(?:psexec|wmiexec|dcomexec)/i,
    ],
    keywordWeight: 1,
    suggestedEcsFieldNames: [
      'source.ip',
      'destination.ip',
      'user.name',
      'event.action',
      'network.protocol',
      'host.name',
    ],
    suggestedLanguage: QUERY_LANGUAGES.EQL,
  },

  // ── T1059 — Suspicious Process ────────────────────────────────────────────
  [INVESTIGATION_TYPES.SUSPICIOUS_PROCESS]: {
    keywords: [
      'suspicious process',
      'malicious process',
      'unexpected process',
      'unusual process',
      'process execution',
      'process spawn',
      'process launch',
      'command execution',
      'cmd.exe',
      'process.name',
      'process.command_line',
      'process.parent',
      'lolbin',
      'living off the land',
      'certutil',
      'mshta',
      'regsvr32',
      'rundll32',
      'wscript',
      'cscript',
      'bitsadmin',
      'installutil',
      'regasm',
      'regsvcs',
      'msdt',
      'odbcconf',
    ],
    patterns: [
      /process\.(name|command_line|executable)/i,
      /(?:cmd|powershell|bash|sh)\s+[-/]/i,
      /(?:lolbin|lolbas)/i,
    ],
    keywordWeight: 1,
    suggestedEcsFieldNames: [
      'process.name',
      'process.command_line',
      'process.parent.name',
      'process.args',
      'user.name',
      'host.name',
    ],
    suggestedLanguage: QUERY_LANGUAGES.EQL,
  },

  // ── T1547 / T1053 — Persistence ───────────────────────────────────────────
  [INVESTIGATION_TYPES.PERSISTENCE]: {
    keywords: [
      'persistence',
      'persistent access',
      'backdoor',
      'scheduled task',
      'scheduled job',
      'cron job',
      'crontab',
      'autorun',
      'autostart',
      'startup folder',
      'run key',
      'registry run',
      'hklm\\software\\microsoft\\windows\\currentversion\\run',
      'hkcu\\software\\microsoft\\windows\\currentversion\\run',
      'at.exe',
      'schtasks',
      'service install',
      'new service',
      'winlogon helper',
      'logon script',
      'dll hijack',
      'dll side-load',
      'boot execute',
      'lsa packages',
    ],
    patterns: [
      /(?:scheduled\s+task|cron(?:tab)?|at\.exe)/i,
      /registry\.path.*\\run/i,
      /(?:backdoor|webshell|web\s+shell)/i,
    ],
    keywordWeight: 1,
    suggestedEcsFieldNames: [
      'registry.path',
      'file.path',
      'process.name',
      'event.action',
      'user.name',
      'host.name',
    ],
    suggestedLanguage: QUERY_LANGUAGES.EQL,
  },

  // ── T1041 / T1048 — Unusual Outbound Traffic ──────────────────────────────
  [INVESTIGATION_TYPES.UNUSUAL_OUTBOUND]: {
    keywords: [
      'unusual outbound',
      'suspicious outbound',
      'data exfiltration',
      'exfiltration',
      'data leak',
      'data loss',
      'large transfer',
      'high volume transfer',
      'bytes out',
      'network.bytes',
      'unusual destination',
      'unexpected destination',
      'uncommon port',
      'non-standard port',
      'dns tunneling',
      'dns tunnel',
      'icmp tunnel',
      'http exfil',
      'c2',
      'command and control',
      'command-and-control',
      'c&c',
      'beaconing',
      'beacon',
      'callback',
    ],
    patterns: [
      /data\s+exfil\w+/i,
      /(?:c2|c&c|command[- ]and[- ]control)/i,
      /(?:dns|icmp|http[s]?)\s+tunnel\w*/i,
    ],
    keywordWeight: 1,
    suggestedEcsFieldNames: [
      'destination.ip',
      'destination.port',
      'network.bytes',
      'process.name',
      'source.ip',
      'dns.question.name',
    ],
    suggestedLanguage: QUERY_LANGUAGES.EQL,
  },

  // ── T1059.001 — Suspicious PowerShell ────────────────────────────────────
  [INVESTIGATION_TYPES.SUSPICIOUS_POWERSHELL]: {
    keywords: [
      'powershell',
      'powershell.exe',
      'pwsh',
      'encoded command',
      '-encodedcommand',
      '-enc',
      '-e ',
      'invoke-expression',
      'iex',
      'invoke-webrequest',
      'downloadstring',
      'downloadfile',
      'net.webclient',
      'start-process',
      'hidden window',
      '-windowstyle hidden',
      '-noninteractive',
      '-noprofile',
      '-nop',
      'bypass',
      '-executionpolicy bypass',
      'mimikatz',
      'invoke-mimikatz',
      'amsi',
      'amsi bypass',
      'reflection.assembly',
      'scriptblock',
      'constrained language',
    ],
    patterns: [
      /powershell(?:\.exe)?\s+.*-e(?:nc(?:odedcommand)?)?/i,
      /\[system\.reflection\.(assembly|type)\]/i,
      /iex\s*\(/i,
      /invoke-expression/i,
    ],
    keywordWeight: 2, // PowerShell terms are high-signal — weight double
    suggestedEcsFieldNames: [
      'process.name',
      'process.command_line',
      'process.args',
      'process.parent.name',
      'user.name',
      'host.name',
    ],
    suggestedLanguage: QUERY_LANGUAGES.EQL,
  },

  // ── T1078 — Authentication Anomaly ───────────────────────────────────────
  [INVESTIGATION_TYPES.AUTH_ANOMALY]: {
    keywords: [
      'auth anomaly',
      'authentication anomaly',
      'anomalous login',
      'unusual login',
      'suspicious login',
      'impossible travel',
      'off-hours login',
      'after hours',
      'new country',
      'new location',
      'new device',
      'new ip',
      'first seen',
      'first time',
      'unusual time',
      'kerberos anomaly',
      'golden ticket',
      'silver ticket',
      'pass-the-ticket',
      'as-rep roasting',
      'asrep',
      'kerberoasting',
      'delegation abuse',
      'unconstrained delegation',
    ],
    patterns: [
      /(?:impossible|anomal\w+)\s+(?:travel|login|auth)/i,
      /(?:golden|silver)\s+ticket/i,
      /kerbero(?:ast|roast)\w*/i,
    ],
    keywordWeight: 1,
    suggestedEcsFieldNames: [
      'user.name',
      'source.ip',
      'event.action',
      'event.outcome',
      'user.domain',
      'host.name',
    ],
    suggestedLanguage: QUERY_LANGUAGES.KQL,
  },

  // ── T1110 (focused) — Failed Login ────────────────────────────────────────
  [INVESTIGATION_TYPES.FAILED_LOGIN]: {
    keywords: [
      'failed login',
      'failed logon',
      'login failure',
      'logon failure',
      'authentication failure',
      'bad credentials',
      'wrong password',
      'incorrect password',
      'event.outcome failure',
      'outcome:failure',
      '4625',
      '4776',  // Windows: NTLM auth failure
      'sec-auth-failure',
      'ssh auth failure',
      'pam failure',
      'unix auth failure',
    ],
    patterns: [
      /(?:failed|invalid|incorrect)\s+(?:login|logon|auth(?:entication)?|password|credentials)/i,
      /event\.outcome\s*[=:]\s*["']?failure["']?/i,
    ],
    keywordWeight: 1,
    suggestedEcsFieldNames: [
      'user.name',
      'source.ip',
      'event.outcome',
      'event.action',
      '@timestamp',
      'host.name',
    ],
    suggestedLanguage: QUERY_LANGUAGES.KQL,
  },

  // ── T1059 parent-child variant ────────────────────────────────────────────
  [INVESTIGATION_TYPES.PARENT_CHILD_ANOMALY]: {
    keywords: [
      'parent child',
      'parent-child',
      'process ancestry',
      'process tree',
      'child process',
      'spawned by',
      'spawned from',
      'process.parent',
      'unusual parent',
      'unexpected parent',
      'office spawning',
      'word spawning',
      'excel spawning',
      'outlook spawning',
      'acrobat spawning',
      'explorer spawning shell',
      'winword.exe',
      'excel.exe',
      'outlook.exe',
      'acrord32',
      'acrobat',
    ],
    patterns: [
      /process\.parent\.(name|pid|executable)/i,
      /(?:word|excel|outlook|acrobat)\w*\s+spawn\w*/i,
      /parent[- ]child\s+(?:anomal|relat|process)/i,
    ],
    keywordWeight: 1,
    suggestedEcsFieldNames: [
      'process.name',
      'process.pid',
      'process.parent.name',
      'process.parent.pid',
      'process.command_line',
      'host.name',
    ],
    suggestedLanguage: QUERY_LANGUAGES.EQL,
  },

  // ── Threat Hunting (broad) ────────────────────────────────────────────────
  [INVESTIGATION_TYPES.THREAT_HUNTING]: {
    keywords: [
      'threat hunting',
      'threat hunt',
      'hunt for',
      'hunting for',
      'ioc',
      'indicator of compromise',
      'threat indicator',
      'threat intelligence',
      'ttp',
      'tactics techniques procedures',
      'mitre',
      'att&ck',
      'attack technique',
      'attack pattern',
      'threat actor',
      'apt',
      'advanced persistent threat',
      'campaign',
      'known bad',
      'threat.indicator',
      'threat.technique',
      'threat.tactic',
    ],
    patterns: [
      /threat[- ]hunt\w*/i,
      /(?:ioc|ttp)\b/i,
      /mitre\s+(?:att&ck|attack)/i,
    ],
    keywordWeight: 1,
    suggestedEcsFieldNames: [
      'threat.indicator.ip',
      'threat.technique.id',
      'event.category',
      'host.name',
      'user.name',
      'network.protocol',
    ],
    suggestedLanguage: QUERY_LANGUAGES.KQL,
  },

  // ── General (catch-all) ───────────────────────────────────────────────────
  [INVESTIGATION_TYPES.GENERAL]: {
    keywords: [
      'show me',
      'find',
      'search',
      'query',
      'look for',
      'investigate',
      'events',
      'logs',
      'records',
      'activity',
      'traffic',
      'connections',
    ],
    patterns: [],
    keywordWeight: 0.1, // very low weight — general is the fallback
    suggestedEcsFieldNames: [
      'event.action',
      'event.category',
      'host.name',
      'user.name',
      '@timestamp',
    ],
    suggestedLanguage: QUERY_LANGUAGES.KQL,
  },
} as const;

// ---------------------------------------------------------------------------
// ECS field registry (minimal — covers suggestedEcsFieldNames above)
// Full ECS index lives in common/constants/ecs.constants.ts; we build a
// lightweight lookup here so the extractor can return proper ECSField objects
// without depending on a full field index that requires I/O.
// ---------------------------------------------------------------------------

const ECS_FIELD_STUB_REGISTRY: Readonly<Record<string, ECSField>> = {
  '@timestamp':              { name: '@timestamp',              type: 'date',    category: 'base',    description: 'Date/time the event occurred',           isRequired: true,  isMultiValue: false, normalizationLevel: 'core' },
  'event.action':            { name: 'event.action',            type: 'keyword', category: 'event',   description: 'Action that was observed',               isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'event.category':          { name: 'event.category',          type: 'keyword', category: 'event',   description: 'Event category',                         isRequired: false, isMultiValue: true,  normalizationLevel: 'core' },
  'event.outcome':           { name: 'event.outcome',           type: 'keyword', category: 'event',   description: 'Outcome of the event (success/failure)', isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'event.code':              { name: 'event.code',              type: 'keyword', category: 'event',   description: 'Identification code for this event',     isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'host.name':               { name: 'host.name',               type: 'keyword', category: 'host',    description: 'Name of the host',                       isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'user.name':               { name: 'user.name',               type: 'keyword', category: 'user',    description: 'Short name or login of the user',        isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'user.domain':             { name: 'user.domain',             type: 'keyword', category: 'user',    description: 'User domain',                            isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'user.effective.name':     { name: 'user.effective.name',     type: 'keyword', category: 'user',    description: 'Effective user name (post-escalation)',  isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'source.ip':               { name: 'source.ip',               type: 'ip',      category: 'source',  description: 'IP of the source',                       isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'source.port':             { name: 'source.port',             type: 'long',    category: 'source',  description: 'Port of the source',                     isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'destination.ip':          { name: 'destination.ip',          type: 'ip',      category: 'destination', description: 'IP of the destination',              isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'destination.port':        { name: 'destination.port',        type: 'long',    category: 'destination', description: 'Port of the destination',            isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'network.protocol':        { name: 'network.protocol',        type: 'keyword', category: 'network', description: 'Network protocol name',                  isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'network.bytes':           { name: 'network.bytes',           type: 'long',    category: 'network', description: 'Total bytes transferred',                isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'network.direction':       { name: 'network.direction',       type: 'keyword', category: 'network', description: 'Direction of network traffic',           isRequired: false, isMultiValue: false, normalizationLevel: 'core' },
  'process.name':            { name: 'process.name',            type: 'keyword', category: 'process', description: 'Process name',                           isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'process.pid':             { name: 'process.pid',             type: 'long',    category: 'process', description: 'Process ID',                             isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'process.args':            { name: 'process.args',            type: 'keyword', category: 'process', description: 'Process arguments',                      isRequired: false, isMultiValue: true,  normalizationLevel: 'extended' },
  'process.command_line':    { name: 'process.command_line',    type: 'wildcard', category: 'process', description: 'Full command line',                     isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'process.executable':      { name: 'process.executable',      type: 'keyword', category: 'process', description: 'Full path to the process executable',   isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'process.parent.name':     { name: 'process.parent.name',     type: 'keyword', category: 'process', description: 'Parent process name',                   isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'process.parent.pid':      { name: 'process.parent.pid',      type: 'long',    category: 'process', description: 'Parent process ID',                     isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'process.parent.executable': { name: 'process.parent.executable', type: 'keyword', category: 'process', description: 'Parent process executable path',   isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'registry.path':           { name: 'registry.path',           type: 'keyword', category: 'registry', description: 'Full registry key path',               isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'file.path':               { name: 'file.path',               type: 'keyword', category: 'file',    description: 'Full path to the file',                  isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'dns.question.name':       { name: 'dns.question.name',       type: 'keyword', category: 'dns',     description: 'DNS question name',                      isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'threat.indicator.ip':     { name: 'threat.indicator.ip',     type: 'ip',      category: 'threat',  description: 'Threat indicator IP address',            isRequired: false, isMultiValue: false, normalizationLevel: 'extended' },
  'threat.technique.id':     { name: 'threat.technique.id',     type: 'keyword', category: 'threat',  description: 'MITRE ATT&CK technique ID',              isRequired: false, isMultiValue: true,  normalizationLevel: 'extended' },
} as const;

// ---------------------------------------------------------------------------
// Extraction patterns
// ---------------------------------------------------------------------------

// IPv4 with optional CIDR
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;

// FQDN — at least 2 labels, no pure IP (post-IP extraction)
const HOSTNAME_PATTERN =
  /\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){1,}[A-Za-z]{2,}\b/g;

// user:value, username=value, account:value
const USERNAME_EXPLICIT_PATTERN =
  /(?:user(?:name)?|account)\s*[:=]\s*([^\s,;]+)/gi;

// DOMAIN\user or DOMAIN/user
const DOMAIN_USER_PATTERN = /([A-Za-z0-9_-]+)[\\\/]([A-Za-z0-9._-]+)/g;

// @handle
const AT_HANDLE_PATTERN = /@([A-Za-z0-9._-]+)/g;

// MD5 (32 hex) or SHA-256 (64 hex)
const HASH_PATTERN = /\b([0-9a-fA-F]{32}|[0-9a-fA-F]{64})\b/g;

// Relative time: "last 24h", "past 7 days", "previous 2 hours", "in the last week"
const RELATIVE_TIME_PATTERN =
  /(?:last|past|previous|in\s+the\s+last)\s+(\d+)?\s*(second|minute|hour|day|week|month)s?/gi;

// Absolute time anchors: "since 2024-01-01", "from 2024-01-01 to 2024-01-07"
const ABSOLUTE_SINCE_PATTERN = /since\s+(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z?)?)/gi;
const ABSOLUTE_FROM_TO_PATTERN =
  /from\s+(\d{4}-\d{2}-\d{2}(?:T[^\s]+)?)\s+to\s+(\d{4}-\d{2}-\d{2}(?:T[^\s]+)?)/gi;

// Port references: "port 22", ":443", "destination.port:80"
const PORT_PATTERN = /(?:port\s+|:)(\d{1,5})\b/gi;

// ---------------------------------------------------------------------------
// Time unit → milliseconds
// ---------------------------------------------------------------------------

const TIME_UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

// ---------------------------------------------------------------------------
// IntentExtractorService
// ---------------------------------------------------------------------------

/**
 * IntentExtractorService
 *
 * Lightweight, deterministic intent classification engine.
 * Does NOT call an LLM — suitable for high-frequency pre-processing.
 *
 * Classification algorithm:
 *  1. Score each InvestigationType by summing:
 *     - keywordWeight for each keyword found in the normalized text
 *     - PATTERN_SCORE for each regex pattern that matches
 *  2. Break ties by type definition order (stable sort).
 *  3. Winning type determines the InvestigationIntent fields.
 *  4. If only GENERAL type has a non-zero score (or all scores = 0),
 *     type is set to 'general' with low confidence.
 *
 * All InvestigationIntent fields are always populated — null for absent
 * values, empty readonly arrays for missing collections.
 */
export class IntentExtractorService {
  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Extracts an InvestigationIntent from a normalized query.
   * Never throws — returns a GENERAL intent with zero confidence on any error.
   */
  public extract(normalizedQuery: NormalizedQuery): InvestigationIntent {
    try {
      return this.extractUnsafe(normalizedQuery);
    } catch {
      return this.fallbackIntent();
    }
  }

  // ── Private — orchestration ────────────────────────────────────────────────

  private extractUnsafe(normalizedQuery: NormalizedQuery): InvestigationIntent {
    const text = normalizedQuery.normalizedText;

    const { type, confidence } = this.classify(text);
    const rule = INVESTIGATION_TYPE_RULES[type];
    const timeRangeHint = this.extractTimeRange(text);
    const entities = this.extractEntities(text);
    const suggestedFields = this.resolveEcsFields(rule.suggestedEcsFieldNames);

    return Object.freeze<InvestigationIntent>({
      type,
      confidence,
      reasoning: this.buildReasoning(type, text, rule),
      suggestedFields,
      suggestedQueryLanguage: rule.suggestedLanguage,
      timeRangeHint,
      entitiesExtracted: entities,
    });
  }

  // ── Private — classification ───────────────────────────────────────────────

  /**
   * Scores all investigation types against the normalized text and returns
   * the winner with a normalized confidence value.
   */
  private classify(text: string): { type: InvestigationType; confidence: number } {
    const lower = text.toLowerCase();

    const scores = new Map<InvestigationType, number>();
    let maxScore = 0;

    for (const [investigationType, rule] of Object.entries(INVESTIGATION_TYPE_RULES) as Array<
      [InvestigationType, InvestigationTypeRule]
    >) {
      let score = 0;
      const weight = rule.keywordWeight ?? 1;

      // Keyword scoring
      for (const keyword of rule.keywords) {
        if (lower.includes(keyword.toLowerCase())) {
          score += weight;
        }
      }

      // Pattern scoring (stronger signal)
      for (const pattern of rule.patterns) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          score += PATTERN_SCORE;
        }
      }

      scores.set(investigationType, score);
      if (score > maxScore) maxScore = score;
    }

    // Pick the winner — highest score, excluding 'general' unless it's the only
    // non-zero type (general keywords are very low weight and act as fallback only)
    let winner: InvestigationType = INVESTIGATION_TYPES.GENERAL;
    let winnerScore = 0;

    for (const [investigationType, score] of scores) {
      if (
        investigationType !== INVESTIGATION_TYPES.GENERAL &&
        score > winnerScore
      ) {
        winner = investigationType;
        winnerScore = score;
      }
    }

    // If no specific type won, fall back to general
    if (winnerScore === 0) {
      winner = INVESTIGATION_TYPES.GENERAL;
      winnerScore = scores.get(INVESTIGATION_TYPES.GENERAL) ?? 0;
    }

    // Confidence: winner score / theoretical max score for that type's rule set
    const confidence = this.computeConfidence(winner, winnerScore, maxScore);

    return { type: winner, confidence };
  }

  /**
   * Normalizes a raw score to a [0, 1] confidence value.
   *
   * Strategy:
   *  - Compute theoretical max for the winning type
   *    (all keywords hit + all patterns match)
   *  - Divide actual score by theoretical max
   *  - Clamp to [0.05, 0.98] — never claim absolute certainty or near-zero
   *    confidence for a chosen type
   */
  private computeConfidence(
    type: InvestigationType,
    score: number,
    _maxAcrossAllTypes: number
  ): number {
    if (score === 0) return 0.05;

    const rule = INVESTIGATION_TYPE_RULES[type];
    const weight = rule.keywordWeight ?? 1;
    const theoreticalMax =
      rule.keywords.length * weight + rule.patterns.length * PATTERN_SCORE;

    if (theoreticalMax === 0) return 0.05;

    const raw = score / theoreticalMax;
    return Math.min(0.98, Math.max(0.05, parseFloat(raw.toFixed(4))));
  }

  // ── Private — time range extraction ───────────────────────────────────────

  /**
   * Extracts a TimeRangeHint from the normalized text.
   * Handles:
   *  - Relative: "last 24h", "past 7 days", "last week"
   *  - Absolute: "from 2024-01-01 to 2024-01-07"
   *  - Since: "since 2024-01-01"
   * Returns null if no time expression is found.
   */
  private extractTimeRange(text: string): TimeRangeHint | null {
    // 1. Absolute from-to range
    ABSOLUTE_FROM_TO_PATTERN.lastIndex = 0;
    const fromToMatch = ABSOLUTE_FROM_TO_PATTERN.exec(text);
    if (fromToMatch) {
      return Object.freeze<TimeRangeHint>({
        relative: undefined,
        from: this.toIso(fromToMatch[1]),
        to: this.toIso(fromToMatch[2]),
      });
    }

    // 2. Since anchor
    ABSOLUTE_SINCE_PATTERN.lastIndex = 0;
    const sinceMatch = ABSOLUTE_SINCE_PATTERN.exec(text);
    if (sinceMatch) {
      return Object.freeze<TimeRangeHint>({
        relative: undefined,
        from: this.toIso(sinceMatch[1]),
        to: new Date().toISOString(),
      });
    }

    // 3. Relative time expressions
    RELATIVE_TIME_PATTERN.lastIndex = 0;
    const relativeMatch = RELATIVE_TIME_PATTERN.exec(text);
    if (relativeMatch) {
      const count = relativeMatch[1] ? parseInt(relativeMatch[1], 10) : 1;
      const unit = relativeMatch[2].toLowerCase().replace(/s$/, ''); // normalize plurals
      const ms = (TIME_UNIT_MS[unit] ?? 86_400_000) * count;

      const now = Date.now();
      const relativeLabel = `last ${count} ${unit}${count !== 1 ? 's' : ''}`;

      return Object.freeze<TimeRangeHint>({
        relative: relativeLabel,
        from: new Date(now - ms).toISOString(),
        to: new Date(now).toISOString(),
      });
    }

    return null;
  }

  /**
   * Coerces a date string fragment to a full ISO 8601 string.
   */
  private toIso(fragment: string): string {
    // Already has time component
    if (fragment.includes('T')) {
      return fragment.endsWith('Z') ? fragment : `${fragment}Z`;
    }
    // Date-only → midnight UTC
    return `${fragment}T00:00:00Z`;
  }

  // ── Private — entity extraction ────────────────────────────────────────────

  /**
   * Extracts structured entities from the normalized text:
   *  - IPv4 addresses (with optional CIDR)
   *  - Hostnames (FQDNs)
   *  - Usernames (explicit prefix or @handle or DOMAIN\user)
   *  - Port numbers
   *  - Hashes (MD5/SHA-256)
   */
  private extractEntities(text: string): ExtractedEntities {
    // IPv4
    IPV4_PATTERN.lastIndex = 0;
    const ipAddresses = this.uniqueMatches(text, IPV4_PATTERN);

    // Hostnames — run after IPs are extracted to avoid false positive FQDN
    // matches on IP fragments; we work on the original text since IPs are
    // preserved by the normalizer and the hostname pattern is distinct
    const ipSet = new Set(ipAddresses);
    HOSTNAME_PATTERN.lastIndex = 0;
    const hostnames = this.uniqueMatches(text, HOSTNAME_PATTERN).filter(
      (h) => !ipSet.has(h) && !isLikelyIp(h)
    );

    // Usernames
    const usernameSet = new Set<string>();

    USERNAME_EXPLICIT_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = USERNAME_EXPLICIT_PATTERN.exec(text)) !== null) {
      if (m[1]) usernameSet.add(m[1]);
    }

    DOMAIN_USER_PATTERN.lastIndex = 0;
    while ((m = DOMAIN_USER_PATTERN.exec(text)) !== null) {
      if (m[2]) usernameSet.add(m[2]); // user part of DOMAIN\user
    }

    AT_HANDLE_PATTERN.lastIndex = 0;
    while ((m = AT_HANDLE_PATTERN.exec(text)) !== null) {
      if (m[1]) usernameSet.add(m[1]);
    }

    // Hashes
    HASH_PATTERN.lastIndex = 0;
    const hashes = this.uniqueMatches(text, HASH_PATTERN);

    // Ports
    PORT_PATTERN.lastIndex = 0;
    const portSet = new Set<number>();
    while ((m = PORT_PATTERN.exec(text)) !== null) {
      const port = parseInt(m[1], 10);
      if (port >= 0 && port <= 65535) portSet.add(port);
    }

    return Object.freeze<ExtractedEntities>({
      ipAddresses: Object.freeze(ipAddresses),
      hostnames: Object.freeze(hostnames),
      usernames: Object.freeze(Array.from(usernameSet)),
      processNames: Object.freeze([]),  // process names require process.name field context — not extractable from free text without NER
      filePaths: Object.freeze(this.extractFilePaths(text)),
      hashes: Object.freeze(hashes),
      domains: Object.freeze(this.extractDomains(text, ipSet)),
      ports: Object.freeze(Array.from(portSet)),
    });
  }

  /**
   * Extracts file path fragments — Windows or Unix style.
   */
  private extractFilePaths(text: string): string[] {
    const winPath = /[A-Za-z]:\\(?:[^\s\\/:*?"<>|\r\n]+\\)*[^\s\\/:*?"<>|\r\n]*/g;
    const unixPath = /\/(?:[^\s/:*?"<>|\r\n]+\/)+[^\s/:*?"<>|\r\n]*/g;

    const paths = new Set<string>();

    winPath.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = winPath.exec(text)) !== null) paths.add(m[0]);

    unixPath.lastIndex = 0;
    while ((m = unixPath.exec(text)) !== null) paths.add(m[0]);

    return Array.from(paths);
  }

  /**
   * Extracts apex domain names from hostnames, excluding those that are IPs.
   */
  private extractDomains(text: string, ipSet: Set<string>): string[] {
    HOSTNAME_PATTERN.lastIndex = 0;
    const all = this.uniqueMatches(text, HOSTNAME_PATTERN);
    const domainSet = new Set<string>();

    for (const host of all) {
      if (ipSet.has(host) || isLikelyIp(host)) continue;
      // Apex domain: last two labels
      const parts = host.split('.');
      if (parts.length >= 2) {
        domainSet.add(parts.slice(-2).join('.'));
      }
    }

    return Array.from(domainSet);
  }

  // ── Private — ECS field resolution ────────────────────────────────────────

  private resolveEcsFields(fieldNames: readonly string[]): readonly ECSField[] {
    return Object.freeze(
      fieldNames
        .map((name) => ECS_FIELD_STUB_REGISTRY[name])
        .filter((f): f is ECSField => f !== undefined)
    );
  }

  // ── Private — reasoning string ────────────────────────────────────────────

  private buildReasoning(
    type: InvestigationType,
    text: string,
    rule: InvestigationTypeRule
  ): string {
    const lower = text.toLowerCase();
    const matchedKeywords = rule.keywords
      .filter((kw) => lower.includes(kw.toLowerCase()))
      .slice(0, 5); // top 5 for brevity

    if (matchedKeywords.length === 0) {
      return `No strong keyword matches found; defaulted to ${type} classification.`;
    }

    return (
      `Classified as "${type}" based on matched terms: ` +
      matchedKeywords.map((k) => `"${k}"`).join(', ') +
      '.'
    );
  }

  // ── Private — helpers ──────────────────────────────────────────────────────

  private uniqueMatches(text: string, pattern: RegExp): string[] {
    pattern.lastIndex = 0;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      seen.add(m[0]);
    }
    return Array.from(seen);
  }

  private fallbackIntent(): InvestigationIntent {
    return Object.freeze<InvestigationIntent>({
      type: INVESTIGATION_TYPES.GENERAL,
      confidence: 0.05,
      reasoning: 'Extraction failed; defaulted to general investigation type.',
      suggestedFields: Object.freeze([]),
      suggestedQueryLanguage: QUERY_LANGUAGES.KQL,
      timeRangeHint: null,
      entitiesExtracted: Object.freeze<ExtractedEntities>({
        ipAddresses: Object.freeze([]),
        hostnames: Object.freeze([]),
        usernames: Object.freeze([]),
        processNames: Object.freeze([]),
        filePaths: Object.freeze([]),
        hashes: Object.freeze([]),
        domains: Object.freeze([]),
        ports: Object.freeze([]),
      }),
    });
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a string looks like an IPv4 address (heuristic guard to
 * prevent IP octets from being classified as hostnames).
 */
function isLikelyIp(s: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/.test(s);
}
