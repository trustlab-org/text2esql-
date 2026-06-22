/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { TokenEstimatePanel } from './TokenEstimatePanel';
import { ServicesContext, type Services } from '../../services';
import { CopilotProvider } from '../../store/copilot.context';
import type { MaskedCredentials, TokenEstimateResponse } from '../../../common/types';

const ESTIMATES: TokenEstimateResponse = {
  estimates: [
    {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      tokenEstimate: {
        promptTokens: 120,
        completionTokens: 90,
        totalTokens: 210,
        estimatedAt: '2026-06-22T00:00:00.000Z',
        isActual: false,
      },
      costEstimate: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        promptCostUsd: 0.0001,
        completionCostUsd: 0.0002,
        totalCostUsd: 0.0123,
        currency: 'USD',
        rateCardVersion: 'v1',
        estimatedAt: '2026-06-22T00:00:00.000Z',
        isActual: false,
      },
    },
  ],
};

function maskedFor(provider: MaskedCredentials['primary']['provider']): MaskedCredentials {
  return {
    primary: { provider, model: null, endpoint: null, hasKey: true },
    fallback: null,
  };
}

function makeServices(
  estimateTokens: jest.Mock,
  status: MaskedCredentials | null
): Services {
  return {
    queryApi: { generateQuery: jest.fn(), executeQuery: jest.fn(), estimateTokens },
    providerApi: { getProviders: jest.fn(), getHealth: jest.fn() },
    benchmarkApi: { runBenchmark: jest.fn() },
    credentialsApi: {
      getCredentials: status
        ? jest.fn().mockResolvedValue(status)
        : jest.fn().mockRejectedValue(new Error('none')),
      saveCredentials: jest.fn(),
      deleteCredentials: jest.fn(),
    },
  } as unknown as Services;
}

function renderPanel(services: Services) {
  return render(
    <ServicesContext.Provider value={services}>
      <CopilotProvider>
        <TokenEstimatePanel />
      </CopilotProvider>
    </ServicesContext.Provider>
  );
}

describe('TokenEstimatePanel', () => {
  it('renders the estimate table from a mocked estimateTokens response', async () => {
    const estimateTokens = jest.fn().mockResolvedValue(ESTIMATES);
    const { getByTestId } = renderPanel(makeServices(estimateTokens, maskedFor('anthropic')));

    await waitFor(() => expect(getByTestId('queryCopilotTokenEstimateTable')).toBeTruthy());

    const table = getByTestId('queryCopilotTokenEstimateTable');
    expect(table.textContent).toContain('Anthropic');
    expect(table.textContent).toContain('210');
    expect(table.textContent).toContain('$0.0123');
  });

  it('estimates the most recent analyst query, defaulting to the example placeholder', async () => {
    const estimateTokens = jest.fn().mockResolvedValue(ESTIMATES);
    renderPanel(makeServices(estimateTokens, maskedFor('anthropic')));

    await waitFor(() => expect(estimateTokens).toHaveBeenCalled());
    const [query, providers] = estimateTokens.mock.calls[0];
    expect(query).toBe('show me all failed login attempts');
    expect(providers).toEqual([{ provider: 'anthropic' }]);
  });

  it('shows an error callout when the estimate call fails', async () => {
    const estimateTokens = jest.fn().mockRejectedValue(new Error('boom'));
    const { getByTestId } = renderPanel(makeServices(estimateTokens, maskedFor('openai')));

    // The auto-estimate fires once the masked status loads.
    await waitFor(() => expect(estimateTokens).toHaveBeenCalled());

    // Re-running via the button still surfaces an error callout.
    await act(async () => {
      fireEvent.click(getByTestId('queryCopilotEstimateTokensButton'));
    });
    await waitFor(() =>
      expect(getByTestId('queryCopilotTokenEstimatePanel').textContent).toContain(
        'Token estimate failed.'
      )
    );
  });
});
