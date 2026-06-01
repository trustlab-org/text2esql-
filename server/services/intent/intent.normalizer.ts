import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// NormalizedQuery — output contract
// ---------------------------------------------------------------------------

export interface NormalizedQuery {
  /** Original raw input, untouched. */
  readonly originalText: string;
  /**
   * Normalized form: lowercased, collapsed whitespace, trimmed.
   * Preserved verbatim: IPv4/CIDR addresses, usernames, hostnames,
   * ISO timestamps and common relative time expressions.
   */
  readonly normalizedText: string;
  /**
   * SHA-256 hex digest of normalizedText.
   * Used as the primary cache key — identical normalized queries produce the
   * same key regardless of whitespace/casing differences in the original input.
   */
  readonly cacheKey: string;
}

// ---------------------------------------------------------------------------
// Preservation patterns
//
// Tokens matching these patterns are replaced with placeholders before
// lowercasing, then restored, so their casing is preserved.
//
// Rationale:
//   IPv4 / CIDR   — case-insensitive but exact octets matter for routing
//   Timestamps    — ISO 8601 mixed-case "T" and "Z" must survive
//   Usernames     — user:Alice ≠ user:alice in many auth systems
//   Hostnames     — DNS is case-insensitive, but operators write them with
//                   specific casing for readability; we preserve as-is
//   Hashes        — SHA/MD5 hex; lowercasing is safe but we keep originals
//                   to avoid confusing analysts comparing against raw logs
// ---------------------------------------------------------------------------

interface PreservationToken {
  readonly pattern: RegExp;
  readonly label: string;
}

const PRESERVATION_TOKENS: readonly PreservationToken[] = [
  // IPv4 with optional CIDR suffix:  192.168.1.1, 10.0.0.0/8
  {
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g,
    label: 'IPV4',
  },
  // ISO 8601 timestamps: 2024-01-15T13:45:00Z, 2024-01-15T13:45:00+05:30
  {
    pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g,
    label: 'TIMESTAMP',
  },
  // Date-only fragments: 2024-01-15
  {
    pattern: /\b\d{4}-\d{2}-\d{2}\b/g,
    label: 'DATE',
  },
  // user: or username: prefixed values: user:jsmith, username:Alice.Jones
  {
    pattern: /(?:user(?:name)?|account)\s*[:=]\s*\S+/gi,
    label: 'USERNAME',
  },
  // DOMAIN\user or DOMAIN/user (Windows-style)
  {
    pattern: /[A-Za-z0-9_-]+[\\\/][A-Za-z0-9._-]+/g,
    label: 'DOMAINUSER',
  },
  // Hostnames with dots (heuristic: ≥2 labels, no spaces, mixed case common)
  // e.g. DC01.corp.example.com, web-01.prod.internal
  {
    pattern: /\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){2,}[A-Za-z]{2,}\b/g,
    label: 'HOSTNAME',
  },
  // MD5 / SHA hashes (32 or 64 hex chars)
  {
    pattern: /\b[0-9A-Fa-f]{32}\b|\b[0-9A-Fa-f]{64}\b/g,
    label: 'HASH',
  },
];

// ---------------------------------------------------------------------------
// QueryNormalizer
// ---------------------------------------------------------------------------

/**
 * QueryNormalizer
 *
 * Produces a deterministic, cache-friendly normalized form of a raw analyst
 * query string while preserving tokens (IPs, usernames, hostnames, timestamps,
 * hashes) that carry semantic meaning sensitive to casing or exact form.
 *
 * Normalization steps:
 *  1. Extract and replace preservation tokens with labelled placeholders.
 *  2. Lowercase the remaining text.
 *  3. Collapse internal whitespace runs to single spaces.
 *  4. Trim leading/trailing whitespace.
 *  5. Restore preservation tokens.
 *  6. Compute SHA-256 of the normalized text as the cache key.
 *
 * Designed to be instantiated once (or used as a singleton) — all methods
 * are stateless and safe to call concurrently in Node's single-threaded loop.
 */
export class QueryNormalizer {
  /**
   * Normalizes a raw query string.
   *
   * @param rawQuery The raw analyst input (as received from the HTTP request).
   * @returns NormalizedQuery with originalText, normalizedText, and cacheKey.
   */
  public normalize(rawQuery: string): NormalizedQuery {
    const originalText = rawQuery;

    // ── Step 1: Extract preservation tokens ──────────────────────────────
    const restorationMap = new Map<string, string>();
    let working = rawQuery;
    let slotIndex = 0;

    for (const token of PRESERVATION_TOKENS) {
      // Reset lastIndex before each pass (global regex statefulness)
      token.pattern.lastIndex = 0;

      working = working.replace(token.pattern, (match) => {
        // Label is lowercased so the placeholder survives the toLowerCase()
        // below; otherwise the case-sensitive restore at Step 5 never matches
        // and the preserved token is dropped.
        const slot = `\x00${token.label.toLowerCase()}_${slotIndex++}\x00`;
        restorationMap.set(slot, match);
        return slot;
      });
    }

    // ── Step 2–4: Lowercase + collapse whitespace ─────────────────────────
    working = working
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    // ── Step 5: Restore preserved tokens ─────────────────────────────────
    for (const [slot, original] of restorationMap) {
      // Escape the slot string for use in a literal regex (NUL chars are safe
      // but the label may contain underscores/digits — no special chars)
      working = working.replace(slot, original);
    }

    const normalizedText = working;

    // ── Step 6: SHA-256 cache key ─────────────────────────────────────────
    const cacheKey = createHash('sha256')
      .update(normalizedText, 'utf8')
      .digest('hex');

    return Object.freeze<NormalizedQuery>({
      originalText,
      normalizedText,
      cacheKey,
    });
  }
}
