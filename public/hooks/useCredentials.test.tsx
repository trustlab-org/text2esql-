/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useCredentials } from './useCredentials';
import { ServicesContext, type Services } from '../services';
import type { MaskedCredentials, SaveCredentialsInput } from '../../common/types';

const MASKED: MaskedCredentials = {
  primary: { provider: 'groq', model: null, endpoint: null, hasKey: true },
  fallback: null,
};

function makeServices(overrides: Partial<Services['credentialsApi']> = {}): {
  services: Services;
  getCredentials: jest.Mock;
  saveCredentials: jest.Mock;
  deleteCredentials: jest.Mock;
} {
  const getCredentials = jest.fn().mockResolvedValue(MASKED);
  const saveCredentials = jest.fn().mockResolvedValue(MASKED);
  const deleteCredentials = jest.fn().mockResolvedValue(undefined);
  const services = {
    queryApi: {},
    providerApi: {},
    benchmarkApi: {},
    credentialsApi: { getCredentials, saveCredentials, deleteCredentials, ...overrides },
  } as unknown as Services;
  return { services, getCredentials, saveCredentials, deleteCredentials };
}

function wrapper(services: Services): React.FC<{ children: React.ReactNode }> {
  return ({ children }) => (
    <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
  );
}

describe('useCredentials', () => {
  it('loads the masked status from the server on mount', async () => {
    const { services, getCredentials } = makeServices();

    const { result } = renderHook(() => useCredentials(), { wrapper: wrapper(services) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getCredentials).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual(MASKED);
  });

  it('sets status to null when the server has no credentials', async () => {
    const { services } = makeServices({
      getCredentials: jest.fn().mockRejectedValue(new Error('not found')),
    });

    const { result } = renderHook(() => useCredentials(), { wrapper: wrapper(services) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBeNull();
  });

  it('save POSTs the input, updates status, and fires onChange', async () => {
    const onChange = jest.fn();
    const { services, saveCredentials } = makeServices();
    const input: SaveCredentialsInput = {
      primary: { provider: 'openai', apiKey: 'sk-x' },
      fallback: null,
    };

    const { result } = renderHook(() => useCredentials(onChange), { wrapper: wrapper(services) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.save(input);
    });

    expect(saveCredentials).toHaveBeenCalledWith(input);
    expect(result.current.status).toEqual(MASKED);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clear DELETEs, resets status to null, and fires onChange', async () => {
    const onChange = jest.fn();
    const { services, deleteCredentials } = makeServices();

    const { result } = renderHook(() => useCredentials(onChange), { wrapper: wrapper(services) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.clear();
    });

    expect(deleteCredentials).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
