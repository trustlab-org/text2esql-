import './index.scss';

import type { PluginInitializerContext } from '@kbn/core/public';
import { QueryCopilotPlugin } from './plugin';

export function plugin(initializerContext: PluginInitializerContext) {
  return new QueryCopilotPlugin(initializerContext);
}
