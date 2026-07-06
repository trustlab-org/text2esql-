import { useEffect, useRef, useState } from 'react';

import type { TokenEstimateEntry, TokenEstimateProviderSpec } from '../../common/types';
import { useServices } from '../services';
import { useCopilot } from '../store/copilot.context';

/** Debounce delay before firing a live estimate for in-progress typing. */
const DEBOUNCE_MS = 400;
/** Minimum trimmed length before an estimate call is worth making. */
const MIN_TEXT_LENGTH = 3;
/** Cap on cached estimate entries (simple FIFO eviction). */
const CACHE_MAX_ENTRIES = 50;

/** Result of {@link useTokenEstimate}. */
export interface UseTokenEstimateResult {
  /** Latest estimate for the current text, or null when unavailable. */
  readonly estimate: TokenEstimateEntry | null;
  /** True while a debounced estimate request is pending or in flight. */
  readonly isEstimating: boolean;
}

/**
 * Live pre-flight token/cost estimate for the text the analyst is typing.
 *
 * Debounces 400ms and calls the pure token-estimate endpoint for the primary
 * provider only (provider + optional model from the masked credential status,
 * mirroring TokenEstimatePanel). Recent results are cached in a small ref Map
 * so retyping the same text never re-issues a request, and out-of-order
 * resolutions are ignored via a monotonic sequence counter.
 *
 * Errors are swallowed (estimate becomes null) — the live estimate is a hint
 * and must never surface an error banner in the composer.
 */
export function useTokenEstimate(text: string): UseTokenEstimateResult {
  const { queryApi } = useServices();
  const { state } = useCopilot();
  const credentialsStatus = state.credentialsStatus;

  const [estimate, setEstimate] = useState<TokenEstimateEntry | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);

  /** FIFO cache of recent estimates keyed by `${provider}|${model}|${text}`. */
  const cacheRef = useRef<Map<string, TokenEstimateEntry>>(new Map());
  /** Monotonic sequence used to drop stale (out-of-order) resolutions. */
  const seqRef = useRef(0);

  // The primary provider spec comes from `primaryProvider` (looked up in
  // `providers`), falling back to the first configured provider.
  const primarySpec =
    credentialsStatus?.providers.find(
      (p) => p.provider === credentialsStatus.primaryProvider
    ) ??
    credentialsStatus?.providers[0] ??
    null;
  const provider = primarySpec?.provider ?? null;
  const model = primarySpec?.model ?? null;

  useEffect(() => {
    const trimmed = text.trim();

    // Too short / no primary provider: clear and invalidate anything in flight.
    if (trimmed.length < MIN_TEXT_LENGTH || provider === null) {
      seqRef.current += 1;
      setEstimate(null);
      setIsEstimating(false);
      return;
    }

    const cacheKey = `${provider}|${model ?? ''}|${trimmed}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      seqRef.current += 1; // In-flight responses for older text are now stale.
      setEstimate(cached);
      setIsEstimating(false);
      return;
    }

    const seq = ++seqRef.current;
    setIsEstimating(true);
    const timer = setTimeout(() => {
      const spec: TokenEstimateProviderSpec = {
        provider,
        ...(model ? { model } : {}),
      };
      queryApi
        .estimateTokens(trimmed, [spec])
        .then(({ estimates }) => {
          if (seq !== seqRef.current) {
            return; // Stale: newer text superseded this request.
          }
          const entry = estimates[0] ?? null;
          if (entry !== null) {
            cacheRef.current.set(cacheKey, entry);
            // FIFO eviction: Map iteration order is insertion order.
            if (cacheRef.current.size > CACHE_MAX_ENTRIES) {
              const oldest = cacheRef.current.keys().next().value;
              if (oldest !== undefined) {
                cacheRef.current.delete(oldest);
              }
            }
          }
          setEstimate(entry);
          setIsEstimating(false);
        })
        .catch(() => {
          if (seq !== seqRef.current) {
            return;
          }
          setEstimate(null);
          setIsEstimating(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [text, provider, model, queryApi]);

  return { estimate, isEstimating };
}
