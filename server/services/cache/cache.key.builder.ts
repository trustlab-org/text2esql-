/**
 * Builds deterministic, collision-resistant cache keys for Query Copilot.
 *
 * Keys have the form `qc:v1:{indexPattern_hash}:{query_hash}` so they are
 * namespaced, versioned, and fixed-length regardless of the size of the
 * underlying index pattern or query.
 */
import { createHash } from 'node:crypto';

const KEY_NAMESPACE = 'qc';
const KEY_VERSION = 'v1';

/**
 * Stateless builder that produces cache keys for normalized queries.
 *
 * The builder hashes variable-length inputs (such as the index pattern) so the
 * resulting key is safe to use as a cache identifier and has a bounded length.
 */
export class CacheKeyBuilder {
  /**
   * Builds a deterministic, collision-resistant cache key of the form
   * `qc:v1:{indexPattern_hash}:{query_hash}`.
   *
   * @param normalizedQueryHash a hash of the normalized query (already a digest)
   * @param indexPattern the target index pattern, which is hashed so it is safe
   *   and fixed-length in the key
   */
  buildKey(normalizedQueryHash: string, indexPattern: string): string {
    const indexPatternHash = this.hash(indexPattern);
    return `${KEY_NAMESPACE}:${KEY_VERSION}:${indexPatternHash}:${normalizedQueryHash}`;
  }

  /** SHA-256 hex digest of the input (deterministic, collision-resistant). */
  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
