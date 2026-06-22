import type { HttpSetup } from '@kbn/core/public';

/**
 * Error thrown by {@link ApiClient} for any non-2xx HTTP response or transport
 * failure. Carries the HTTP status and (when present) the server's request id.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly requestId?: string;

  constructor(statusCode: number, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.requestId = requestId;
    // Restore the prototype chain so `instanceof ApiError` works after transpilation.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Thin wrapper over Kibana's HttpSetup. Subclasses (the API services) use the
 * protected `post`/`get` helpers, which normalise transport/HTTP errors into
 * {@link ApiError}.
 */
export class ApiClient {
  constructor(protected readonly http: HttpSetup) {}

  protected async post<T>(path: string, body: unknown): Promise<T> {
    try {
      return await this.http.post<T>(path, { body: JSON.stringify(body) });
    } catch (error) {
      throw this.toApiError(error);
    }
  }

  protected async get<T>(path: string): Promise<T> {
    try {
      return await this.http.get<T>(path);
    } catch (error) {
      throw this.toApiError(error);
    }
  }

  protected async del<T>(path: string): Promise<T> {
    try {
      return await this.http.delete<T>(path);
    } catch (error) {
      throw this.toApiError(error);
    }
  }

  protected toApiError(error: unknown): ApiError {
    const candidate = error as
      | {
          response?: { status?: number };
          body?: { statusCode?: number; message?: string; attributes?: { requestId?: string } };
          message?: string;
        }
      | null
      | undefined;
    const statusCode = candidate?.response?.status ?? candidate?.body?.statusCode ?? 500;
    const message =
      candidate?.body?.message ?? candidate?.message ?? 'Request to the Query Copilot API failed.';
    const requestId = candidate?.body?.attributes?.requestId;
    return new ApiError(statusCode, message, requestId);
  }
}
