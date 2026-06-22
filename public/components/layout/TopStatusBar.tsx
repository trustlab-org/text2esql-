import React from 'react';
import {
  EuiPanel,
  EuiFlexGroup,
  EuiFlexItem,
  EuiTitle,
  EuiText,
  EuiIcon,
  EuiAvatar,
  EuiButton,
  EuiButtonEmpty,
  useEuiTheme,
} from '@elastic/eui';
import { css } from '@emotion/react';

import { useCopilot, hasUsablePrimary } from '../../store/copilot.context';
import { SyntaxBadge } from '../statusbar/SyntaxBadge';
import { ECSFieldsBadge } from '../statusbar/ECSFieldsBadge';
import { TokensBadge } from '../statusbar/TokensBadge';
import { ProviderBadge } from '../statusbar/ProviderBadge';
import { FallbackBadge } from '../statusbar/FallbackBadge';
import { CostBadge } from '../statusbar/CostBadge';

/**
 * Horizontal status bar rendered above the split layout. Shows a blue rounded
 * logo square + the application title/subtitle on the left, and the live status
 * badges (each wired to copilot state) plus the analyst avatar on the right.
 * Most badges render nothing until the first query produces data; FallbackBadge
 * always renders the green/orange system-status indicator.
 */
interface TopStatusBarProps {
  onOpenBenchmark?: () => void;
  onOpenSettings?: () => void;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({ onOpenBenchmark, onOpenSettings }) => {
  const { euiTheme } = useEuiTheme();
  const { state } = useCopilot();
  // No usable primary key yet → surface a prominent call-to-action instead of
  // the quiet gear, so a new user immediately sees where to add their key.
  const needsKey = !hasUsablePrimary(state.credentialsStatus);

  const logoCss = css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: euiTheme.border.radius.medium,
    backgroundColor: euiTheme.colors.primary,
  });

  return (
    <EuiPanel
      hasShadow={false}
      hasBorder
      paddingSize="m"
      borderRadius="none"
      data-test-subj="queryCopilotTopStatusBar"
    >
      <EuiFlexGroup
        alignItems="center"
        justifyContent="spaceBetween"
        gutterSize="m"
        responsive={false}
      >
        <EuiFlexItem grow={false}>
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            <EuiFlexItem grow={false}>
              <div css={logoCss}>
                <EuiIcon type="search" color="ghost" />
              </div>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiFlexGroup direction="column" gutterSize="none" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiTitle size="s">
                    <h1>Query Copilot</h1>
                  </EuiTitle>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiText size="xs" color="subdued">
                    Security Log Investigation
                  </EuiText>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>

        <EuiFlexItem grow={false}>
          <EuiFlexGroup alignItems="center" gutterSize="s" wrap responsive={false}>
            <EuiFlexItem grow={false}>
              <SyntaxBadge />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <ECSFieldsBadge />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <TokensBadge />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <ProviderBadge />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <FallbackBadge />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <CostBadge />
            </EuiFlexItem>
            {onOpenBenchmark && (
              <EuiFlexItem grow={false}>
                <EuiButtonEmpty
                  size="s"
                  iconType="visGauge"
                  onClick={onOpenBenchmark}
                  data-test-subj="queryCopilotOpenBenchmark"
                >
                  Benchmark
                </EuiButtonEmpty>
              </EuiFlexItem>
            )}
            {onOpenSettings && (
              <EuiFlexItem grow={false}>
                {needsKey ? (
                  <EuiButton
                    size="s"
                    fill
                    color="warning"
                    iconType="key"
                    onClick={onOpenSettings}
                    data-test-subj="queryCopilotOpenSettings"
                  >
                    Add API key
                  </EuiButton>
                ) : (
                  <EuiButtonEmpty
                    size="s"
                    iconType="gear"
                    onClick={onOpenSettings}
                    data-test-subj="queryCopilotOpenSettings"
                  >
                    Settings
                  </EuiButtonEmpty>
                )}
              </EuiFlexItem>
            )}
            <EuiFlexItem grow={false}>
              <EuiAvatar name="Analyst User" initials="AU" size="m" color={euiTheme.colors.primary} />
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>
    </EuiPanel>
  );
};
