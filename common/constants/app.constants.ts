export const PLUGIN_ID = 'queryCopilot' as const;
export const PLUGIN_NAME = 'Query Copilot' as const;
export const PLUGIN_ROUTE_PREFIX = '/api/query_copilot' as const;

export const INVESTIGATION_TYPES = {
  BRUTE_FORCE: 'brute_force',
  PRIVILEGE_ESCALATION: 'privilege_escalation',
  LATERAL_MOVEMENT: 'lateral_movement',
  SUSPICIOUS_PROCESS: 'suspicious_process',
  PERSISTENCE: 'persistence',
  UNUSUAL_OUTBOUND: 'unusual_outbound',
  SUSPICIOUS_POWERSHELL: 'suspicious_powershell',
  AUTH_ANOMALY: 'auth_anomaly',
  FAILED_LOGIN: 'failed_login',
  PARENT_CHILD_ANOMALY: 'parent_child_anomaly',
  THREAT_HUNTING: 'threat_hunting',
  GENERAL: 'general',
} as const;

export const ALL_INVESTIGATION_TYPES = Object.values(INVESTIGATION_TYPES);

export const INVESTIGATION_TYPE_DISPLAY_NAMES: Record<
  (typeof INVESTIGATION_TYPES)[keyof typeof INVESTIGATION_TYPES],
  string
> = {
  brute_force: 'Brute Force Attack',
  privilege_escalation: 'Privilege Escalation',
  lateral_movement: 'Lateral Movement',
  suspicious_process: 'Suspicious Process',
  persistence: 'Persistence Mechanism',
  unusual_outbound: 'Unusual Outbound Traffic',
  suspicious_powershell: 'Suspicious PowerShell',
  auth_anomaly: 'Authentication Anomaly',
  failed_login: 'Failed Login',
  parent_child_anomaly: 'Parent-Child Process Anomaly',
  threat_hunting: 'Threat Hunting',
  general: 'General Investigation',
} as const;

export const QUERY_LANGUAGES = {
  KQL: 'kql',
  EQL: 'eql',
  DSL: 'dsl',
  ES_SQL: 'es_sql',
} as const;

export type QueryLanguage = (typeof QUERY_LANGUAGES)[keyof typeof QUERY_LANGUAGES];

export const PIPELINE_CONFIG = {
  MAX_CORRECTION_ATTEMPTS: 3,
  DEFAULT_TIMEOUT_MS: 30_000,
  MAX_TOKENS_DEFAULT: 4096,
  CACHE_TTL_SECONDS: 300,
  MAX_CONVERSATION_HISTORY: 20,
  MAX_QUERY_LENGTH_CHARS: 10_000,
} as const;

export const OBSERVABILITY_EVENT_TYPES = {
  QUERY_GENERATED: 'query_generated',
  QUERY_VALIDATED: 'query_validated',
  QUERY_CORRECTED: 'query_corrected',
  QUERY_FAILED: 'query_failed',
  INTENT_CLASSIFIED: 'intent_classified',
  PROVIDER_REQUEST: 'provider_request',
  PROVIDER_RESPONSE: 'provider_response',
  PROVIDER_ERROR: 'provider_error',
  CACHE_HIT: 'cache_hit',
  CACHE_MISS: 'cache_miss',
  PIPELINE_START: 'pipeline_start',
  PIPELINE_COMPLETE: 'pipeline_complete',
  PIPELINE_ABORT: 'pipeline_abort',
} as const;

export type ObservabilityEventType =
  (typeof OBSERVABILITY_EVENT_TYPES)[keyof typeof OBSERVABILITY_EVENT_TYPES];

export const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown',
} as const;

export type HealthStatus = (typeof HEALTH_STATUS)[keyof typeof HEALTH_STATUS];
