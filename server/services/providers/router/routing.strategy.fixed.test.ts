import { FixedOrderRoutingStrategy } from './routing.strategy';
import { NullHealthMonitor } from './null.health.monitor';
import type { ProviderHealthState } from './routing.strategy';
import type { ILLMProvider, ProviderMetadata } from '../types';
import { PROVIDER_NAMES } from '../../../../common/constants';
import type { ProviderName } from '../../../../common';

// ---------------------------------------------------------------------------
// FixedOrderRoutingStrategy + NullHealthMonitor unit tests.
// ---------------------------------------------------------------------------

function makeProvider(name: ProviderName): ILLMProvider {
  return {
    complete: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    getMetadata: jest.fn<ProviderMetadata, []>().mockReturnValue({
      name,
      role: 'primary',
      priority: 0,
      maxTokens: 8192,
    }),
    estimateTokens: jest.fn().mockReturnValue(0),
  };
}

function providerMap(...names: ProviderName[]): Map<ProviderName, ILLMProvider> {
  const map = new Map<ProviderName, ILLMProvider>();
  for (const name of names) map.set(name, makeProvider(name));
  return map;
}

const OPENAI = PROVIDER_NAMES.OPENAI as ProviderName;
const GEMINI = PROVIDER_NAMES.GEMINI as ProviderName;
const GROQ = PROVIDER_NAMES.GROQ as ProviderName;
const EMPTY_HEALTH = new Map<ProviderName, ProviderHealthState>();

describe('FixedOrderRoutingStrategy', () => {
  it('returns the providers present in the map, in the configured order', () => {
    const strategy = new FixedOrderRoutingStrategy([OPENAI, GEMINI]);
    const order = strategy.order(providerMap(GEMINI, OPENAI), EMPTY_HEALTH);
    expect(order).toEqual([OPENAI, GEMINI]);
  });

  it('filters out configured providers that are absent from the map', () => {
    const strategy = new FixedOrderRoutingStrategy([OPENAI, GROQ, GEMINI]);
    const order = strategy.order(providerMap(OPENAI, GEMINI), EMPTY_HEALTH);
    expect(order).toEqual([OPENAI, GEMINI]);
  });

  it('ignores health-state reordering (order is purely the configured sequence)', () => {
    const strategy = new FixedOrderRoutingStrategy([OPENAI, GEMINI]);
    const health = new Map<ProviderName, ProviderHealthState>([
      [OPENAI, { name: OPENAI, healthy: false, lastCheckedAt: null, consecutiveFailures: 9 }],
      [GEMINI, { name: GEMINI, healthy: true, lastCheckedAt: null, consecutiveFailures: 0 }],
    ]);
    const order = strategy.order(providerMap(OPENAI, GEMINI), health);
    expect(order).toEqual([OPENAI, GEMINI]);
  });

  it('returns an empty array when none of the configured providers are present', () => {
    const strategy = new FixedOrderRoutingStrategy([GROQ]);
    expect(strategy.order(providerMap(OPENAI), EMPTY_HEALTH)).toEqual([]);
  });
});

describe('NullHealthMonitor', () => {
  it('returns an empty health-state map', () => {
    const monitor = new NullHealthMonitor();
    expect(monitor.getHealthStates().size).toBe(0);
  });

  it('checkProvider resolves to nothing (no-op)', async () => {
    const monitor = new NullHealthMonitor();
    await expect(monitor.checkProvider(OPENAI)).resolves.toBeUndefined();
  });
});
