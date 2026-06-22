/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, render } from '@testing-library/react';

import { CopilotProvider, useCopilot } from './copilot.context';
import { ServicesContext, type Services } from '../services';
import { saveCredentials } from '../services/credentials.store';

/**
 * Drives the sendQuery thunk and exposes the resulting state to assertions.
 * The button click triggers a generate call so the gating + credential
 * forwarding can be observed via the mocked queryApi.
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

function makeServices(generateQuery: jest.Mock): Services {
  return {
    queryApi: { generateQuery, executeQuery: jest.fn(), estimateTokens: jest.fn() },
    providerApi: { getProviders: jest.fn(), getHealth: jest.fn() },
    benchmarkApi: { runBenchmark: jest.fn() },
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
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('blocks generation and surfaces a guidance error when no usable primary key is set', async () => {
    const generateQuery = jest.fn();
    const { getApi, getByTestId } = renderWithServices(makeServices(generateQuery));

    await act(async () => {
      await getApi().sendQuery('failed logins');
    });

    expect(generateQuery).not.toHaveBeenCalled();
    expect(getByTestId('error').textContent).toContain('Add your LLM API key in Settings');
    // No user message was recorded.
    expect(getByTestId('messages').textContent).toBe('0');
  });

  it('forwards the stored credentials on the generate request when a primary key is set', async () => {
    saveCredentials({ primary: { provider: 'anthropic', apiKey: 'sk-123' } });
    const generateQuery = jest.fn().mockResolvedValue({
      pipelineId: 'p1',
      finalQuery: { id: 'q1', queryString: 'event.action:*' },
      tokenEstimate: { totalTokens: 10 },
      costEstimate: { provider: 'anthropic', model: 'claude' },
      totalDurationMs: 5,
    });
    const { getApi } = renderWithServices(makeServices(generateQuery));

    await act(async () => {
      await getApi().sendQuery('failed logins');
    });

    expect(generateQuery).toHaveBeenCalledTimes(1);
    const req = generateQuery.mock.calls[0][0];
    expect(req.credentials).toEqual({ primary: { provider: 'anthropic', apiKey: 'sk-123' } });
    expect(req.query).toBe('failed logins');
  });
});
