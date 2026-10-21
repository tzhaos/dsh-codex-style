/** Shared rail icons; the conversation entry uses a home silhouette. */
env.createNavigationIcon = (React, primitives) => {
  const renderHome = (size, active) =>
    React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 20 20',
        fill: active ? 'currentColor' : 'none',
        stroke: active ? 'none' : 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      React.createElement('path', {
        d: 'M9.04 2.02a1.5 1.5 0 0 1 1.92 0l7.25 6.04a1 1 0 0 1-.64 1.77H17v6.42a1.5 1.5 0 0 1-1.5 1.5h-3.75v-4a1.75 1.75 0 0 0-3.5 0v4H4.5a1.5 1.5 0 0 1-1.5-1.5V9.83h-.57a1 1 0 0 1-.64-1.77Z',
      }),
    )
  const glyphs = {
    chat: [({ size }) => renderHome(size, false), ({ size }) => renderHome(size, true)],
    automation: [primitives.IconClockOutlineRegular, primitives.IconClockOutlineMedium],
    plugins: [
      primitives.IconPluginPinwheelOutlineRegular,
      primitives.IconPluginPinwheelOutlineMedium,
    ],
    settings: [primitives.IconSettingsOutlineRegular, primitives.IconSettingsOutlineMedium],
  }
  return function NavigationIcon({ name, active = false, size = 20 }) {
    const pair = glyphs[name]
    if (!pair) return null
    const Glyph = pair[active ? 1 : 0] ?? pair[0]
    return React.createElement(
      'span',
      {
        className: 'dsh-navigation-icon',
        'aria-hidden': true,
        'data-navigation-glyph': name,
        'data-active': String(active),
      },
      React.createElement(Glyph, { size }),
    )
  }
}
// Versioned paint adapter for DSH 0.2.1-rc.2. Closed contours get a fill;
// their internal marks get the theme's inverse color. The pinwheel's four
// native curved paths form its filled lobes without replacing their geometry.
env.navigationIconsCSS = `
.dsh-navigation-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex: none; pointer-events: none; }
.dsh-navigation-icon > svg { display: block; flex: none; }
.dsh-navigation-icon[data-active="true"][data-navigation-glyph="automation"] path:first-of-type { fill: currentColor; }
.dsh-navigation-icon[data-active="true"][data-navigation-glyph="automation"] path:not(:first-of-type) { stroke: var(--dsw-alias-label-primary-foreground); }
.dsh-navigation-icon[data-active="true"][data-navigation-glyph="plugins"] path { fill: currentColor; }
`
