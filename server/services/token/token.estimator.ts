import { getEncoding } from 'js-tiktoken';
import type { Tiktoken } from 'js-tiktoken';
import type { ProviderName } from '../../../common';
import type { ProviderPrompt } from '../providers/types';

// ---------------------------------------------------------------------------
// ProviderTokenEstimate
//
// Server-side estimation contract. Distinct from common/types/cost.types.ts
// TokenEstimate, which carries ISO timestamps and isActual flags for the
// pipeline result envelope. This type is cheaper to construct, never
// persisted, and never crosses the HTTP boundary.
// ---------------------------------------------------------------------------

export type TokenEstimationMethod = 'tiktoken' | 'heuristic';

export interface ProviderTokenEstimate {
  /**
   * Tokens attributed to the input (system prompt + user message combined).
   * Zero when this estimate covers only output (estimateResponseTokens).
   */
  readonly inputTokens: number;
  /**
   * Tokens attributed to generated output.
   * Zero when this estimate covers only input (estimateForProvider / estimatePromptTokens).
   */
  readonly outputTokens: number;
  /** inputTokens + outputTokens */
  readonly totalTokens: number;
  readonly provider: ProviderName;
  /**
   * 'tiktoken'  — cl100k_base BPE encoder (js-tiktoken, pure-JS, no WASM).
   *               Used for openai, groq, anthropic.
   *               Accuracy: ±2–5% vs actual API token counts on English + code.
   *
   * 'heuristic' — Math.ceil(text.length / 4).
   *               Used for:
   *                 gemini  — no client-side tokeniser available; the Gemini
   *                           countTokens() API is async/cloud-only and not
   *                           suitable for synchronous pre-flight estimation.
   *                 ollama  — serves multiple model families (Llama, Mistral,
   *                           Gemma, Phi…), each with a different SentencePiece
   *                           vocabulary; loading the correct tokeniser requires
   *                           the model files, which are not available at plugin
   *                           init time.
   *               Also used as a fallback for openai/groq/anthropic if the
   *               js-tiktoken encoder fails to initialise at runtime.
   *               Accuracy: ±15–25% on English prose; ±10% on ASCII-heavy KQL.
   */
  readonly estimationMethod: TokenEstimationMethod;
}

// ---------------------------------------------------------------------------
// Providers that use cl100k_base BPE tokenisation
//
// openai    — GPT-4 / GPT-4o use cl100k_base. Newer snapshots (gpt-4o-2024-*)
//             use o200k_base which differs by <5% on typical query strings.
//             cl100k_base is an acceptable proxy for context-window guards.
//
// groq      — Hosts Llama-3 (and others). Llama-3 uses a custom BPE vocabulary
//             (128k tokens) distinct from cl100k (100k). In practice the
//             char-per-token ratio is comparable for English + code (~4:1),
//             making cl100k_base a reasonable guard. A per-model tokeniser
//             would require shipping each model's tokenizer.json at plugin
//             build time, which is not viable.
//
// anthropic — Claude tokeniser is proprietary and undocumented. Anthropic's
//             SDK exposes client.messages.countTokens() but that is an async
//             API call — not suitable for the synchronous ILLMProvider.estimateTokens
//             contract. cl100k_base is documented externally as a ~5% proxy
//             for Claude 3 family token counts.
// ---------------------------------------------------------------------------

const TIKTOKEN_PROVIDERS = new Set<ProviderName>(['openai', 'groq', 'anthropic']);

// ---------------------------------------------------------------------------
// Sentinel zero estimate — returned on unrecoverable internal errors
// ---------------------------------------------------------------------------

function zeroEstimate(provider: ProviderName): ProviderTokenEstimate {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    provider,
    estimationMethod: 'heuristic',
  };
}

// ---------------------------------------------------------------------------
// TokenEstimatorService
//
// Design invariants:
//
//  1. Never throws. All public methods swallow internal errors and return
//     either a heuristic estimate or the zero estimate. A token count failure
//     must never propagate into the pipeline.
//
//  2. Lazy encoder initialisation. The cl100k_base rank table is ~1 MB and
//     is only parsed on first use. Plugin setup is not delayed by encoder
//     construction even when no tiktoken providers are enabled.
//
//  3. Singleton encoder. getEncoding() returns a new object on each call.
//     We cache the first successful instance to avoid re-parsing the rank
//     table on every estimate call. The encoder is stateless and safe to
//     reuse across concurrent estimates in Node's single-threaded event loop.
//
//  4. Permanent fallback on encoder failure. If the encoder fails to
//     initialise (e.g. js-tiktoken rank files are missing from the build),
//     encoderReady is set to false and we permanently use the heuristic
//     without logging an error on every call.
// ---------------------------------------------------------------------------

export class TokenEstimatorService {
  private encoder: Tiktoken | null = null;
  /**
   * Three-state initialisation flag:
   *   null  — not yet attempted (lazy init)
   *   true  — encoder ready and cached
   *   false — encoder permanently unavailable; use heuristic
   */
  private encoderReady: boolean | null = null;

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Estimates tokens for a raw string, attributed entirely to `inputTokens`.
   *
   * Use for single-field pre-flight checks and cache key sizing.
   * Does not apply any per-message framing overhead.
   *
   * Never throws.
   */
  public estimateForProvider(text: string, provider: ProviderName): ProviderTokenEstimate {
    try {
      const inputTokens = this.countTokens(text, provider);
      return {
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens,
        provider,
        estimationMethod: this.resolveMethod(provider),
      };
    } catch {
      return zeroEstimate(provider);
    }
  }

  /**
   * Estimates the combined token count for a full ProviderPrompt
   * (system prompt + user message).
   *
   * The two strings are joined with '\n' before counting. This intentionally
   * over-counts by ~4 tokens vs the actual per-message framing overhead that
   * provider APIs apply. Over-counting is the safe direction for context-
   * window pre-flight guards.
   *
   * Result is attributed entirely to `inputTokens`; `outputTokens` is 0.
   *
   * Never throws.
   */
  public estimatePromptTokens(
    prompt: ProviderPrompt,
    provider: ProviderName
  ): ProviderTokenEstimate {
    try {
      const combined = `${prompt.systemPrompt}\n${prompt.userMessage}`;
      const inputTokens = this.countTokens(combined, provider);
      return {
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens,
        provider,
        estimationMethod: this.resolveMethod(provider),
      };
    } catch {
      return zeroEstimate(provider);
    }
  }

  /**
   * Estimates the token count for a model-generated response string.
   *
   * Result is attributed entirely to `outputTokens`; `inputTokens` is 0.
   * Useful for post-hoc cost attribution when the provider API does not
   * return usage metadata (e.g. Ollama non-streaming edge cases).
   *
   * Never throws.
   */
  public estimateResponseTokens(
    responseText: string,
    provider: ProviderName
  ): ProviderTokenEstimate {
    try {
      const outputTokens = this.countTokens(responseText, provider);
      return {
        inputTokens: 0,
        outputTokens,
        totalTokens: outputTokens,
        provider,
        estimationMethod: this.resolveMethod(provider),
      };
    } catch {
      return zeroEstimate(provider);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Dispatches to tiktoken or heuristic based on provider identity.
   * Called inside a try/catch in every public method.
   */
  private countTokens(text: string, provider: ProviderName): number {
    if (text.length === 0) return 0;

    return TIKTOKEN_PROVIDERS.has(provider)
      ? this.countWithTiktoken(text)
      : this.countWithHeuristic(text);
  }

  /**
   * BPE token count via the cached cl100k_base encoder.
   * Falls through to the heuristic if the encoder is unavailable.
   */
  private countWithTiktoken(text: string): number {
    const enc = this.getEncoder();
    if (enc === null) {
      return this.countWithHeuristic(text);
    }
    return enc.encode(text).length;
  }

  /**
   * Math.ceil(text.length / 4) heuristic.
   *
   * Accuracy profile for query_copilot use cases:
   *   ASCII KQL / EQL queries  : ±10–15% vs actual BPE counts
   *   English natural language  : ±15–20%
   *   Repeated / synthetic text : may differ by 50–100% (not a concern here)
   *   Non-Latin Unicode         : under-counts; non-ASCII chars tokenise as
   *                               multiple tokens, not 0.25 tokens/char
   *
   * These margins are acceptable for context-window guard purposes.
   * Actual token counts are obtained from provider API usage metadata
   * after a successful completion and stored in TokenEstimate.isActual = true.
   */
  private countWithHeuristic(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Resolves the estimation method that will be reported in the result.
   *
   * Called after countTokens() so the reported method always reflects
   * what was actually used (tiktoken may have silently fallen back to
   * heuristic if the encoder is unavailable).
   */
  private resolveMethod(provider: ProviderName): TokenEstimationMethod {
    if (!TIKTOKEN_PROVIDERS.has(provider)) return 'heuristic';
    if (this.encoderReady === false) return 'heuristic';
    // encoderReady === null means we haven't attempted yet; optimistically
    // report 'tiktoken' — the first countWithTiktoken call will set the flag.
    return 'tiktoken';
  }

  /**
   * Lazy singleton encoder construction.
   *
   * - First call: attempts getEncoding('cl100k_base'), caches the result.
   * - Subsequent calls: returns the cached encoder in O(1).
   * - On construction failure: sets encoderReady = false and returns null
   *   permanently. Subsequent calls short-circuit without retrying.
   *
   * getEncoding() from js-tiktoken is synchronous — it parses the embedded
   * cl100k_base rank table (bundled in the package's dist directory) and
   * returns a Tiktoken instance. No WASM, no async I/O.
   */
  private getEncoder(): Tiktoken | null {
    if (this.encoderReady === false) return null;

    if (this.encoderReady === true && this.encoder !== null) {
      return this.encoder;
    }

    try {
      this.encoder = getEncoding('cl100k_base');
      this.encoderReady = true;
      return this.encoder;
    } catch {
      this.encoderReady = false;
      this.encoder = null;
      return null;
    }
  }
}
