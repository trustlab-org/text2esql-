import type { MaskedCredentials, SaveCredentialsInput } from '../../common/types';
import { PLUGIN_ROUTE_PREFIX } from '../../common';
import { ApiClient } from './api.client';

/**
 * Typed client for the server-side credentials endpoints.
 *
 * Stage 3 moved raw LLM keys to encrypted server-side storage keyed by the
 * logged-in user. This client only ever sends a key on save (in the request
 * body, over the wire) and only ever receives MASKED metadata back — raw keys
 * are never returned to the browser.
 */
export class CredentialsApiService extends ApiClient {
  /** Loads the user's masked credential status. */
  public async getCredentials(): Promise<MaskedCredentials> {
    const { credentials } = await this.get<{ credentials: MaskedCredentials }>(
      `${PLUGIN_ROUTE_PREFIX}/credentials`
    );
    return credentials;
  }

  /** Upserts the user's credentials; returns the resulting masked status. */
  public async saveCredentials(input: SaveCredentialsInput): Promise<MaskedCredentials> {
    const { credentials } = await this.post<{ credentials: MaskedCredentials }>(
      `${PLUGIN_ROUTE_PREFIX}/credentials`,
      input
    );
    return credentials;
  }

  /** Deletes the user's stored credentials. */
  public async deleteCredentials(): Promise<void> {
    await this.del<{ deleted: boolean }>(`${PLUGIN_ROUTE_PREFIX}/credentials`);
  }
}
