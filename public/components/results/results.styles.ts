import { css, type SerializedStyles } from '@emotion/react';
import type { UseEuiTheme } from '@elastic/eui';

/**
 * Emotion `css` factories for the Query Output card and its child states/table.
 *
 * Every factory is pure: it takes the value returned by {@link useEuiTheme}
 * (typed as {@link UseEuiTheme}), reads design tokens through `theme.euiTheme`,
 * and returns {@link SerializedStyles}. None of them touch a module-level theme,
 * so they are safe to call inside render. The only non-token literals are the
 * fixed pixel dimensions exported as the named constants below.
 */

/** Min height (px) of the Query Output panel body, so short states are not a sliver. */
export const PANEL_MIN_HEIGHT = 320;
/** Min height (px) of a centered non-table state (loading/error/empty/no-results). */
export const STATE_MIN_HEIGHT = 280;
/** Max height (px) of the scrollable results table before it scrolls internally. */
export const TABLE_MAX_HEIGHT = 560;
/** Max width (px) of a truncated table cell before ellipsis kicks in. */
export const CELL_MAX_WIDTH = 280;

/**
 * Outer body of the Query Output panel: a vertical flex column with a minimum
 * height so empty/error/short-result states fill the card instead of collapsing.
 */
export const panelBodyStyles = ({ euiTheme }: UseEuiTheme): SerializedStyles =>
  css({
    minHeight: `${PANEL_MIN_HEIGHT}px`,
    display: 'flex',
    flexDirection: 'column',
  });

/**
 * Wrapper for the four non-table states (loading, error, empty, no-results).
 * Centers content on both axes, grows to fill the flex body, and enforces a
 * minimum height so all states share consistent vertical centering.
 */
export const stateContainerStyles = ({ euiTheme }: UseEuiTheme): SerializedStyles =>
  css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: `${STATE_MIN_HEIGHT}px`,
    width: '100%',
  });

/**
 * Scroll container for the results table: scrolls on both axes within a bounded
 * height, draws a token-themed border, and keeps the table header row pinned to
 * the top while the body scrolls underneath it.
 */
export const tableScrollStyles = ({ euiTheme }: UseEuiTheme): SerializedStyles =>
  css({
    overflowX: 'auto',
    overflowY: 'auto',
    maxHeight: `${TABLE_MAX_HEIGHT}px`,
    minHeight: 0,
    width: '100%',
    border: `1px solid ${euiTheme.border.color}`,
    borderRadius: euiTheme.border.radius.medium,
    '.euiTableHeaderCell': {
      position: 'sticky',
      top: 0,
      zIndex: 1,
      background: euiTheme.colors.emptyShade,
    },
  });

/**
 * Visual semantics for the table itself: zebra striping on odd body rows and a
 * hover highlight on body rows, both sourced from EUI shade tokens.
 */
export const tableStyles = ({ euiTheme }: UseEuiTheme): SerializedStyles =>
  css({
    'tbody tr:nth-of-type(odd)': {
      background: euiTheme.colors.lightestShade,
    },
    'tbody tr:hover': {
      background: euiTheme.colors.lightShade,
    },
  });

/**
 * Numeric cell styling: right-aligned, monospace (code) font, rendered as a
 * block so the alignment fills the cell width.
 */
export const numericCellStyles = ({ euiTheme }: UseEuiTheme): SerializedStyles =>
  css({
    textAlign: 'right',
    fontFamily: euiTheme.font.familyCode,
    display: 'block',
  });

/**
 * Truncated cell styling: clamps a long value to a single ellipsized line up to
 * {@link CELL_MAX_WIDTH}px, while staying inline so it sits inside the cell.
 *
 * @remarks This is a plain {@link SerializedStyles} constant rather than a
 * theme factory because it uses no design tokens — only fixed layout rules and
 * the {@link CELL_MAX_WIDTH} constant.
 */
export const truncatedCellStyles: SerializedStyles = css({
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: `${CELL_MAX_WIDTH}px`,
  display: 'inline-block',
});

/**
 * Container for an expanded row's full detail: padded, on a subtle shade
 * background, with a small token border radius.
 */
export const expandedRowStyles = ({ euiTheme }: UseEuiTheme): SerializedStyles =>
  css({
    padding: euiTheme.size.s,
    background: euiTheme.colors.lightestShade,
    borderRadius: euiTheme.border.radius.small,
  });

/**
 * Results toolbar above the table: compact padding, a subtle shade background,
 * a small token border radius, and bottom spacing before the table.
 */
export const toolbarStyles = ({ euiTheme }: UseEuiTheme): SerializedStyles =>
  css({
    padding: `${euiTheme.size.xs} ${euiTheme.size.s}`,
    background: euiTheme.colors.lightestShade,
    borderRadius: euiTheme.border.radius.small,
    marginBottom: euiTheme.size.s,
  });
