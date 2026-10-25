/**
 * Shared presentation and the versioned DSH 0.2.1-rc.2 conversation adapter.
 * Semantic colors stay owned by ui-theme. These rules are installed with the
 * navigation feature and disappear with its scope, including after quarantine.
 */
env.presentationCSS = `
.dshss-root, .dshss-settings, .dshss-dialogContent, .dshcs-section,
.dshch-panel, .dshqf-panel, .dshhp-tooltip,
.dshwp-sidebar, .dshwp-skills, .dshwp-taskLanding {
  font-family: var(--dsw-font-family, inherit);
}
:where(.dshss-root, .dshss-settings, .dshss-dialogContent, .dshcs-section, .dshqf-panel) :where(button, input, textarea, select) {
  font-family: inherit;
}
:where(.dshcs-section, .dshqf-panel) :where(button, input, textarea, select) { box-sizing: border-box; }
/* One viewport material joins the caption and rail. The Host publishes the
   Windows accent palette, so the material is a very pale wash of the live
   system color across the whole caption row, like the Codex window chrome;
   until it arrives the theme surface tone keeps the material neutral. The
   native Window Controls Overlay paints its own solid strip over the caption,
   so the wash fades back to the surface tone before that strip starts; the
   overlay exposes the free titlebar area through env(titlebar-area-*), and
   the fallback keeps a 150px gap when those variables are unavailable. */
html[data-dshlr-active][data-windows-titlebar] body {
  --dshlr-material-top: 7%;
  --dshlr-material-bottom: 4%;
  --dshlr-material-tint: var(--dshlr-system-accent, var(--dsw-alias-bg-layer-2));
  --dshlr-controls-start: calc(env(titlebar-area-x, 0px) + env(titlebar-area-width, calc(100vw - 150px)));
  --dshlr-material-fade: 150px;
  background-color: var(--dsw-specific-sidebar-fill);
  background-image:
    linear-gradient(90deg,
      transparent 0,
      transparent max(0px, calc(var(--dshlr-controls-start) - var(--dshlr-material-fade))),
      var(--dsw-specific-sidebar-fill) var(--dshlr-controls-start)),
    linear-gradient(180deg,
      color-mix(in srgb, var(--dshlr-material-tint) var(--dshlr-material-top), var(--dsw-specific-sidebar-fill)),
      color-mix(in srgb, var(--dshlr-material-tint) var(--dshlr-material-bottom), var(--dsw-specific-sidebar-fill)));
  background-size: 100% var(--dsh-windows-titlebar-height, 40px), 100% 100%;
  background-position: top left, top left;
  background-repeat: no-repeat, no-repeat;
  background-attachment: fixed, fixed;
}
html[data-dshlr-active][data-windows-titlebar] body[data-ds-dark-theme] {
  --dshlr-material-top: 18%;
  --dshlr-material-bottom: 8%;
  --dshlr-material-tint: var(--dshlr-system-accent-on-dark, var(--dsw-alias-bg-layer-2));
}
html[data-dshlr-active][data-windows-titlebar] [class$="_frame"],
html[data-dshlr-active][data-windows-titlebar] [class$="_frame"]::before,
html[data-dshlr-active][data-windows-titlebar] .dshlr-rail { background: transparent; }
html[data-dshlr-active][data-windows-titlebar] [class$="_frame"] {
  --dshlr-pane-radius: var(--dsh-windows-content-radius, 16px);
  --dshlr-pane-gap: 8px;
  --dshlr-pane-edge: 4px;
  --dshlr-pane-top: calc(var(--dsh-frame-chrome-top, 0px) + var(--dshlr-pane-edge));
  --dshlr-rail-span: calc(var(--dsh-left-rail-width) + var(--dshlr-pane-gap));
  height: calc(100% - var(--dshlr-pane-edge));
  padding-top: var(--dshlr-pane-top);
  margin-inline: var(--dshlr-pane-gap) var(--dshlr-pane-edge);
}
html[data-dshlr-active][data-windows-titlebar] .dshlr-rail { top: var(--dshlr-pane-top); }
/* Fixed like the rail, so the native frame's overflow does not clip its shadow. */
html[data-dshlr-active][data-windows-titlebar] [class$="_frame"]::after {
  content: ''; position: fixed; z-index: 12; pointer-events: none;
  inset: var(--dshlr-pane-top) var(--dshlr-pane-edge) var(--dshlr-pane-edge)
    calc(var(--dsh-left-rail-width) + var(--dshlr-pane-gap));
  border-radius: var(--dshlr-pane-radius); corner-shape: round;
  box-shadow: 0 0 0 .5px var(--dsw-alias-border-l2), 0 2px 5px rgb(0 0 0 / .04);
  /* Native caption controls cover the titlebar; keep every edge below that boundary. */
  clip-path: inset(calc(-1 * var(--dshlr-pane-edge)) -40px -40px -40px);
}
html[data-dshlr-active][data-windows-titlebar] [class$="_sidebarCol"] {
  --dsw-specific-sidebar-fill: transparent;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 65%, transparent);
  border-radius: var(--dshlr-pane-radius) 0 0 var(--dshlr-pane-radius);
  corner-shape: round;
  border-right: .5px solid var(--dsw-alias-border-l3);
}
html[data-dshlr-active][data-windows-titlebar] [class$="_centerCol"] { border-radius: 0; }
html[data-dshlr-active][data-windows-titlebar] [class$="_frame"][data-sidebar-collapsed] > [class$="_centerCol"] {
  border-top-left-radius: var(--dshlr-pane-radius);
  border-bottom-left-radius: var(--dshlr-pane-radius);
}
html[data-dshlr-active][data-windows-titlebar] [class$="_frame"][data-sidebar-collapsed] > [class$="_sidebarCol"] { border-right: 0; }
html[data-dshlr-active][data-windows-titlebar] [class$="_frame"][data-rightbar-collapsed] > [class$="_centerCol"],
html[data-dshlr-active][data-windows-titlebar] [data-sidebar-right-panel] {
  border-top-right-radius: var(--dshlr-pane-radius);
  border-bottom-right-radius: var(--dshlr-pane-radius);
  corner-shape: round;
}
html[data-dshlr-active][data-windows-titlebar] [class$="_bottomRow"] {
  border-radius: 0 0 var(--dshlr-pane-radius) var(--dshlr-pane-radius);
}
html[data-dshlr-active][data-windows-titlebar] [class$="_sidebarCol"] > [class$="_root"]:not([class$="_collapsed"]) { padding-top: 0; padding-bottom: 0; }
html[data-dshlr-active][data-windows-titlebar] .dshss-scroll {
  margin-right: calc(-1 * var(--dsh-sidebar-inline-padding, 12px));
  padding-right: calc(5px + var(--dsh-sidebar-inline-padding, 12px));
}
html[data-dshlr-active] [data-phase="hero"][class$="_root"] [class$="_composerSeat"] { flex: 1; min-height: 0; }
html[data-dshlr-active] [data-phase="hero"][class$="_root"] [class$="_composerHero"] {
  flex: 1; min-height: 0; justify-content: flex-end; gap: 0; padding-bottom: 16px;
}
html[data-dshlr-active] [class$="_composerHero"] > [class$="_root"] { flex: 1; min-height: 160px; height: auto; }
html[data-dshlr-active] [class$="_composerHero"] [class$="_headline"] { flex-direction: column; gap: 24px; font-weight: 400; text-align: center; }
html[data-dshlr-active] [class$="_composerHero"] [class$="_fish"] { color: var(--dsw-alias-label-caption); }
html[data-dshlr-active] [class$="_heroWorkspaceRow"] {
  box-sizing: border-box;
  width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 32px);
  max-width: calc(100% - 32px); align-self: center;
  flex: none; margin: 0 auto; padding: 6px 10px; min-height: 40px;
  justify-content: flex-start; flex-wrap: wrap; gap: 8px 12px;
  border-radius: 16px 16px 0 0; background: var(--dsw-alias-bg-module-platform);
}
html[data-dshlr-active] [class$="_heroOptions"] { margin-left: 0; max-width: 100%; justify-content: flex-start; flex-wrap: wrap; }
html[data-dshlr-active] [class$="_heroWorkspaceRow"] :is([class$="_workspace"],[class$="_seat"],.dshgit-trigger) {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  min-height: 28px; height: 28px; font-size: 13px; line-height: 20px;
}
html[data-dshlr-active] [class*="_trigger"] { box-sizing: border-box; align-items: center; gap: 4px; }
html[data-dshlr-active] [class*="_trigger"] :is([class*="_triggerIcon"],[class*="_chevron"]) {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 14px; height: 14px; line-height: 0; translate: 0 1px;
}
html[data-dshlr-active] [class*="_trigger"] :is([class*="_triggerIcon"],[class*="_chevron"]) > svg { display: block; width: 14px; height: 14px; }
@container (width <= 460px) {
  html[data-dshlr-active] [class*="_trigger"] :is([class*="_triggerIcon"],[class*="_chevron"]) { translate: none; }
}
html[data-dshlr-active] [class*="_trigger"]:has(path[d="M8 4.39209V9.89209"]) :is([class*="_triggerLabel"],[class*="_triggerIcon"]),
html[data-dshlr-active] button[role="menuitem"]:has(path[d="M8 4.39209V9.89209"]),
html[data-dshlr-active] button[role="menuitem"]:has(path[d="M8 4.39209V9.89209"]) :is(span,svg) {
  color: var(--dsw-alias-state-warn-label);
}
html[data-dshlr-active] [class*="_input"] { min-height: 36px; }
html[data-dshlr-active] [class*="_row"] { align-items: center; }
html[data-dshlr-active] [class*="_primary"] {
  width: 32px; height: 32px; transform: none;
  background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground);
}
html[data-dshlr-active] [class*="_primary"]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
html[data-dshlr-active] [class*="_add"] { background: transparent; }
html[data-dshlr-active] [class*="_add"]:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
@media (max-height: 520px) {
  html[data-dshlr-active] [class$="_composerHero"] > [class$="_root"] { min-height: 80px; }
  html[data-dshlr-active] [class$="_composerHero"] [class$="_headline"] { flex-direction: row; gap: 8px; font-size: 20px; line-height: 28px; }
}
`
