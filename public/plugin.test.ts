import type { CoreSetup, PluginInitializerContext } from '@kbn/core/public';
import { QueryCopilotPlugin } from './plugin';

/** Builds an initializer context whose config exposes `defaultIndexPattern`. */
function mockInitializerContext(
  defaultIndexPattern = 'fosstlsoc-logs-*'
): PluginInitializerContext {
  return {
    config: { get: jest.fn().mockReturnValue({ defaultIndexPattern }) },
  } as unknown as PluginInitializerContext;
}

describe('QueryCopilotPlugin (public)', () => {
  it('registers the query_copilot application on setup', () => {
    const register = jest.fn();
    const core = {
      application: { register },
      getStartServices: jest.fn(),
    } as unknown as CoreSetup;

    new QueryCopilotPlugin(mockInitializerContext()).setup(core);

    expect(register).toHaveBeenCalledTimes(1);
    const app = register.mock.calls[0]?.[0] as { id: string; title: string; mount: unknown };
    expect(app.id).toBe('query_copilot');
    expect(app.title).toBe('Query Copilot');
    expect(typeof app.mount).toBe('function');
  });

  it('start and stop are no-ops that do not throw', () => {
    const p = new QueryCopilotPlugin(mockInitializerContext());
    expect(() => p.start()).not.toThrow();
    expect(() => p.stop()).not.toThrow();
  });
});
