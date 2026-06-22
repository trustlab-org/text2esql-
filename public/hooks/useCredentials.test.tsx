/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';

import { useCredentials } from './useCredentials';
import { loadCredentials } from '../services/credentials.store';

describe('useCredentials', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('seeds from the persisted store on mount', () => {
    window.localStorage.setItem(
      'queryCopilot.providerCredentials',
      JSON.stringify({ primary: { provider: 'groq', apiKey: 'k' } })
    );

    const { result } = renderHook(() => useCredentials());

    expect(result.current.credentials).toEqual({ primary: { provider: 'groq', apiKey: 'k' } });
  });

  it('setCredentials persists and updates state', () => {
    const { result } = renderHook(() => useCredentials());

    act(() => {
      result.current.setCredentials({ primary: { provider: 'openai', apiKey: 'sk-x' } });
    });

    expect(result.current.credentials).toEqual({ primary: { provider: 'openai', apiKey: 'sk-x' } });
    expect(loadCredentials()).toEqual({ primary: { provider: 'openai', apiKey: 'sk-x' } });
  });

  it('clearCredentials removes persisted bundle and resets state', () => {
    const { result } = renderHook(() => useCredentials());

    act(() => {
      result.current.setCredentials({ primary: { provider: 'openai', apiKey: 'sk-x' } });
    });
    act(() => {
      result.current.clearCredentials();
    });

    expect(result.current.credentials).toBeNull();
    expect(loadCredentials()).toBeNull();
  });
});
