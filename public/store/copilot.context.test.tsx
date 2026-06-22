/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';

import { CopilotProvider, useCopilot } from './copilot.context';
import { ServicesContext, type Services } from '../services';
import type { MaskedCredentials } from '../../common/types';

const WITH_KEY: MaskedCredentials = {
  primary: { provider: 'anthropic', model: null, endpoint: null, hasKey: true },
  fallback: null,
};

/**
 * Drives the sendQuery thunk and exposes the resulting state to assertions.
 * `refreshCredentials` loads the (mocked) masked status into state so the gate
 * can be observed via the mocked queryApi.
 */
const Harness: React.FC<{ onReady: (api: ReturnType<typeof useCopilot>) => void }> = ({
  onReady,
}) => {
  const ctx = useCopilot();
  onReady(ctx);
  return (
    <div>
      <span data-test-subj="error">{ctx.state.error?.message ?? ''}</span>
      <span data-test-subj="messages">{ctx.state.conversation.length}</span>
    </div>
  );
};

function makeServices(overrides: {
  generateQuery?: jest.Mock;
  getCredentials?: jest.Mock;
}): Services {
  return {
    queryApi: {
      generateQuery: overrides.generateQuery ?? jest.fn(),
      executeQuery: jest.fn(),
      estimateTokens: jest.fn(),
    },
    providerApi: { getProviders: jest.fn(), getHealth: jest.fn() },
    benchmarkApi: { runBenchmark: jest.fn() },
    credentialsApi: {
      getCredentials: overrides.getCredentials ?? jest.fn().mockResolvedValue(WITH_KEY),
      saveCredentials: jest.fn(),
      deleteCredentials: jest.fn(),
    },
  } as unknown as Services;
}

function renderWithServices(services: Services) {
  let api: ReturnType<typeof useCopilot> | null = null;
  const utils = render(
    <ServicesContext.Provider value={services}>
      <CopilotProvider>
        <Harness onReady={(a) => (api = a)} />
      </CopilotProvider>
    </ServicesContext.Provider>
  );
  return { ...utils, getApi: () => api as unknown as ReturnType<typeof useCopilot> };
}

describe('CopilotProvider sendQuery gating', () => {
  it('blocks generation and surfaces a guidance error when no usable primary key is set', async () => {
    const generateQuery = jest.fn();
    const getCredentials = jest.fn().mockRejectedValue(new Error('no creds'));
    const { getApi, getByTestId } = renderWithServices(
      makeServices({ generateQuery, getCredentials })
    );

    // Load (failing) credential status → credentialsStatus stays null.
    await act(async () => {
      await getApi().refreshCredentials();
    });

    await act(async () => {
      await getApi().sendQuery('failed logins');
    });

    expect(generateQuery).not.toHaveBeenCalled();
    expect(getByTestId('error').textContent).toContain('Add your LLM API key in Settings');
    // No user message was recorded.
    expect(getByTestId('messages').textContent).toBe('0');
  });

  it('generates WITHOUT sending credentials in the body once a primary key is configured', async () => {
    const generateQuery = jest.fn().mockResolvedValue({
      pipelineId: 'p1',
      finalQuery: { id: 'q1', queryString: 'event.action:*' },
      tokenEstimate: { totalTokens: 10 },
      costEstimate: { provider: 'anthropic', model: 'claude' },
      totalDurationMs: 5,
    });
    const { getApi } = renderWithServices(makeServices({ generateQuery }));

    await act(async () => {
      await getApi().refreshCredentials();
    });

    await act(async () => {
      await getApi().sendQuery('failed logins');
    });

    expect(generateQuery).toHaveBeenCalledTimes(1);
    const req = generateQuery.mock.calls[0][0];
    expect(req.credentials).toBeUndefined();
    expect(req.query).toBe('failed logins');
  });

  it('refreshCredentials loads the masked status into state', async () => {
    const { getApi } = renderWithServices(makeServices({}));

    await act(async () => {
      await getApi().refreshCredentials();
    });

    await waitFor(() => expect(getApi().state.credentialsStatus).toEqual(WITH_KEY));
  });
});
