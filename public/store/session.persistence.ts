import type {
  ConversationMessage,
  CostEstimate,
  ProviderName,
  TimeRange,
  TokenEstimate,
  ValidationResult,
} from '../../common/types';
import { ALL_PROVIDER_NAMES } from '../../common';
import type { CopilotState } from './types';

/**
 * sessionStorage key for the persisted copilot session. Versioned so the shape
 * can evolve without misreading stale payloads.
 */
const STORAGE_KEY = 'queryCopilot.session.v1';

/**
 * Maximum number of conversation messages persisted. Only the LAST
 * {@link MAX_PERSISTED_MESSAGES} are written so storage stays bounded even for
 * very long sessions.
 */
const MAX_PERSISTED_MESSAGES = 50;

/**
 * The slice of {@link CopilotState} that survives a page reload, plus the
 * session id used to key the server-side conversation cache.
 *
 * SECURITY: NO credentials or API keys are EVER persisted here — only
 * credential-free session data. `credentialsStatus` (even though it is already
 * masked) is deliberately excluded and reloads from the encrypted server-side
 * store on mount, as do provider/model selection and health.
 */
export interface PersistedSession {
  readonly sessionId: string;
  readonly conversation: readonly ConversationMessage[];
  readonly currentKQL: string;
  readonly validationResult: ValidationResult | null;
  readonly selectedDataViews: readonly string[];
  readonly timeRange: TimeRange;
  readonly tokenUsage: TokenEstimate | null;
  readonly estimatedCost: CostEstimate | null;
  readonly sessionTokenUsage: CopilotState['sessionTokenUsage'];
  readonly sessionCostUsd: number;
  /**
   * Provider pinned via the main-screen LLM selector; null = automatic.
   * Absent in payloads written before the selector existed — treated as null.
   */
  readonly preferredProvider?: ProviderName | null;
}

/** Narrow unknown to a plain object (non-null, non-array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the value looks like a persisted {@link TimeRange}. */
function isTimeRange(value: unknown): value is TimeRange {
  return isRecord(value) && typeof value.from === 'string' && typeof value.to === 'string';
}

/** True when the value looks like the cumulative session token-usage counters. */
function isSessionTokenUsage(value: unknown): value is CopilotState['sessionTokenUsage'] {
  return (
    isRecord(value) &&
    typeof value.promptTokens === 'number' &&
    typeof value.completionTokens === 'number' &&
    typeof value.totalTokens === 'number' &&
    typeof value.requests === 'number'
  );
}

/**
 * Defensive shape check for a parsed payload. Individual conversation messages
 * are only checked to be objects with the load-bearing string fields; deeper
 * fields degrade gracefully in the UI.
 */
function isPersistedSession(value: unknown): value is PersistedSession {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    Array.isArray(value.conversation) &&
    value.conversation.every(
      (msg: unknown) =>
        isRecord(msg) && typeof msg.id === 'string' && typeof msg.content === 'string'
    ) &&
    typeof value.currentKQL === 'string' &&
    (value.validationResult === null || isRecord(value.validationResult)) &&
    Array.isArray(value.selectedDataViews) &&
    value.selectedDataViews.every((view: unknown) => typeof view === 'string') &&
    isTimeRange(value.timeRange) &&
    (value.tokenUsage === null || isRecord(value.tokenUsage)) &&
    (value.estimatedCost === null || isRecord(value.estimatedCost)) &&
    isSessionTokenUsage(value.sessionTokenUsage) &&
    typeof value.sessionCostUsd === 'number' &&
    (value.preferredProvider === undefined ||
      value.preferredProvider === null ||
      (ALL_PROVIDER_NAMES as readonly string[]).includes(value.preferredProvider as string))
  );
}

/**
 * Loads the persisted session from `window.sessionStorage`, or null when there
 * is none, the payload is corrupt, or storage is unavailable (e.g. a
 * `SecurityError` in sandboxed iframes). A corrupt payload is best-effort
 * removed so it is not re-parsed on every mount.
 */
export function loadPersistedSession(): PersistedSession | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // Storage unavailable — treat as no persisted session.
  }
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPersistedSession(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to cleanup below.
  }
  clearPersistedSession();
  return null;
}

/**
 * Persists the reload-surviving slice of the given state to
 * `window.sessionStorage` under the session id. The conversation is capped to
 * the last {@link MAX_PERSISTED_MESSAGES} messages so storage stays bounded.
 * Quota and availability errors are swallowed — persistence is best-effort.
 *
 * NO credentials/keys are ever written: `credentialsStatus` reloads from the
 * server, and transient fields (isGenerating, error, queryResults,
 * providerState) intentionally start fresh on reload.
 */
export function persistSession(sessionId: string, state: CopilotState): void {
  const payload: PersistedSession = {
    sessionId,
    conversation: state.conversation.slice(-MAX_PERSISTED_MESSAGES),
    currentKQL: state.currentKQL,
    validationResult: state.validationResult,
    selectedDataViews: state.selectedDataViews,
    timeRange: state.timeRange,
    tokenUsage: state.tokenUsage,
    estimatedCost: state.estimatedCost,
    sessionTokenUsage: state.sessionTokenUsage,
    sessionCostUsd: state.sessionCostUsd,
    preferredProvider: state.preferredProvider,
  };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort: ignore quota exceeded / storage unavailable.
  }
}

/** Removes any persisted session, swallowing storage-unavailable errors. */
export function clearPersistedSession(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}
