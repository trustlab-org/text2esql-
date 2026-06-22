import { ApiClient, ApiError } from './api.client';
import type { HttpSetup } from '@kbn/core/public';

// Test harness exposing the protected methods.
class Harness extends ApiClient {
  public runPost<T>(path: string, body: unknown): Promise<T> {
    return this.post<T>(path, body);
  }
  public runGet<T>(path: string): Promise<T> {
    return this.get<T>(path);
  }
  public runDel<T>(path: string): Promise<T> {
    return this.del<T>(path);
  }
}

function makeHttp() {
  return { post: jest.fn(), get: jest.fn(), delete: jest.fn() };
}

describe('ApiError', () => {
  it('captures status code, message, and request id', () => {
    const e = new ApiError(503, 'down', 'r1');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ApiError');
    expect(e.statusCode).toBe(503);
    expect(e.message).toBe('down');
    expect(e.requestId).toBe('r1');
  });
});

describe('ApiClient', () => {
  it('post resolves the response and serialises the body', async () => {
    const http = makeHttp();
    http.post.mockResolvedValue({ ok: true });
    const harness = new Harness(http as unknown as HttpSetup);

    const out = await harness.runPost('/p', { a: 1 });

    expect(out).toEqual({ ok: true });
    expect(http.post).toHaveBeenCalledWith('/p', { body: JSON.stringify({ a: 1 }) });
  });

  it('post maps an HTTP error to ApiError', async () => {
    const http = makeHttp();
    http.post.mockRejectedValue({
      response: { status: 429 },
      body: { message: 'rate limited', attributes: { requestId: 'req-9' } },
    });
    const harness = new Harness(http as unknown as HttpSetup);

    await expect(harness.runPost('/p', {})).rejects.toBeInstanceOf(ApiError);

    try {
      await harness.runPost('/p', {});
      throw new Error('expected runPost to reject');
    } catch (error) {
      const err = error as ApiError;
      expect(err.statusCode).toBe(429);
      expect(err.message).toBe('rate limited');
      expect(err.requestId).toBe('req-9');
    }
  });

  it('get resolves the response', async () => {
    const http = makeHttp();
    http.get.mockResolvedValue({ status: 'healthy' });
    const harness = new Harness(http as unknown as HttpSetup);

    const out = await harness.runGet('/h');

    expect(out).toEqual({ status: 'healthy' });
    expect(http.get).toHaveBeenCalledWith('/h');
  });

  it('del resolves the response and maps errors to ApiError', async () => {
    const http = makeHttp();
    http.delete.mockResolvedValue({ deleted: true });
    const harness = new Harness(http as unknown as HttpSetup);

    const out = await harness.runDel('/d');

    expect(out).toEqual({ deleted: true });
    expect(http.delete).toHaveBeenCalledWith('/d');

    http.delete.mockRejectedValue({ response: { status: 404 }, body: { message: 'nope' } });
    await expect(harness.runDel('/d')).rejects.toBeInstanceOf(ApiError);
  });

  it('falls back to status 500 and the error message for plain errors', async () => {
    const http = makeHttp();
    http.get.mockRejectedValue(new Error('boom'));
    const harness = new Harness(http as unknown as HttpSetup);

    try {
      await harness.runGet('/h');
      throw new Error('expected runGet to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const err = error as ApiError;
      expect(err.statusCode).toBe(500);
      expect(err.message).toBe('boom');
    }
  });
});
