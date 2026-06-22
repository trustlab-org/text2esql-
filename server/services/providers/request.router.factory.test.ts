import { buildRequestRouter } from './request.router.factory';
import { ProviderFactory } from './provider.factory';
import { ProviderRouter, NullHealthMonitor, FixedOrderRoutingStrategy } from './router';
import { PROVIDER_NAMES } from '../../../common';
import type { ProviderName } from '../../../common';
import type { RequestCredentials } from '../../../common/types';
import type { LoggerService } from '../observability';

// ---------------------------------------------------------------------------
// buildRequestRouter unit tests.
//
// ProviderFactory.createProviderMap and the ProviderRouter / strategy classes
// are mocked: we assert the factory map is forwarded, the order is the deduped
// primary→fallback sequence, and the router is built with a NullHealthMonitor
// + FixedOrderRoutingStrategy + the supplied logger.
// ---------------------------------------------------------------------------

jest.mock('./provider.factory');
jest.mock('./router');

const FactoryMock = ProviderFactory as jest.MockedClass<typeof ProviderFactory>;
const RouterMock = ProviderRouter as jest.MockedClass<typeof ProviderRouter>;
const NullMonitorMock = NullHealthMonitor as jest.MockedClass<typeof NullHealthMonitor>;
const FixedStrategyMock = FixedOrderRoutingStrategy as jest.MockedClass<
  typeof FixedOrderRoutingStrategy
>;

const OPENAI = PROVIDER_NAMES.OPENAI as ProviderName;
const GEMINI = PROVIDER_NAMES.GEMINI as ProviderName;

function makeLogger(): LoggerService {
  return { logRequest: jest.fn() } as unknown as LoggerService;
}

describe('buildRequestRouter', () => {
  const sampleMap = new Map();

  beforeEach(() => {
    jest.clearAllMocks();
    FactoryMock.prototype.createProviderMap = jest.fn().mockReturnValue(sampleMap);
  });

  it('builds the map from the factory and forwards it to the router', () => {
    const creds: RequestCredentials = {
      primary: { provider: OPENAI, apiKey: 'k1' },
      fallback: { provider: GEMINI, apiKey: 'k2' },
    };
    const logger = makeLogger();

    buildRequestRouter(creds, logger);

    expect(FactoryMock.prototype.createProviderMap).toHaveBeenCalledWith(creds);
    const [mapArg, monitorArg, strategyArg, loggerArg] = RouterMock.mock.calls[0];
    expect(mapArg).toBe(sampleMap);
    expect(monitorArg).toBeInstanceOf(NullMonitorMock);
    expect(strategyArg).toBeInstanceOf(FixedStrategyMock);
    expect(loggerArg).toBe(logger);
  });

  it('orders providers primary then fallback', () => {
    buildRequestRouter(
      { primary: { provider: OPENAI, apiKey: 'k1' }, fallback: { provider: GEMINI, apiKey: 'k2' } },
      makeLogger()
    );
    expect(FixedStrategyMock).toHaveBeenCalledWith([OPENAI, GEMINI]);
  });

  it('omits a null fallback from the order', () => {
    buildRequestRouter(
      { primary: { provider: OPENAI, apiKey: 'k1' }, fallback: null },
      makeLogger()
    );
    expect(FixedStrategyMock).toHaveBeenCalledWith([OPENAI]);
  });

  it('dedupes a same-provider fallback in the order', () => {
    buildRequestRouter(
      {
        primary: { provider: OPENAI, apiKey: 'k1' },
        fallback: { provider: OPENAI, apiKey: 'k2' },
      },
      makeLogger()
    );
    expect(FixedStrategyMock).toHaveBeenCalledWith([OPENAI]);
  });

  it('returns the constructed ProviderRouter instance', () => {
    const router = buildRequestRouter(
      { primary: { provider: OPENAI, apiKey: 'k1' } },
      makeLogger()
    );
    expect(router).toBeInstanceOf(RouterMock);
  });
});
