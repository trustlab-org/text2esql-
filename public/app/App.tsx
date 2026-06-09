import React, { useEffect, useMemo } from 'react';
import { EuiProvider } from '@elastic/eui';
import type { CoreStart } from '@kbn/core/public';

import { AppShell } from './app_shell';
import { createServices, ServicesProvider } from '../services';
import { CopilotProvider } from '../store/copilot.context';

interface AppProps {
  readonly coreStart: CoreStart;
  /** Configured default index pattern, used to seed the copilot session state. */
  readonly defaultIndexPattern: string;
}

/**
 * Root application component. Sets the Kibana chrome breadcrumbs, applies EUI
 * theming (color mode derived from the active Kibana theme), and renders the
 * application shell.
 */
export const App: React.FC<AppProps> = ({ coreStart, defaultIndexPattern }) => {
  useEffect(() => {
    coreStart.chrome.setBreadcrumbs([{ text: 'Query Copilot' }]);
  }, [coreStart]);

  const colorMode = coreStart.theme.getTheme().darkMode ? 'dark' : 'light';

  const services = useMemo(() => createServices(coreStart.http), [coreStart.http]);

  return (
    <EuiProvider colorMode={colorMode}>
      <ServicesProvider value={services}>
        <CopilotProvider indexPattern={defaultIndexPattern}>
          <AppShell />
        </CopilotProvider>
      </ServicesProvider>
    </EuiProvider>
  );
};
