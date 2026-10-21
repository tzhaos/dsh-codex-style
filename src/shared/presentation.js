/**
 * Shared presentation and the versioned DSH 0.2.1-rc.2 conversation adapter.
 * Semantic colors stay owned by ui-theme. These rules are installed with the
 * navigation feature and disappear with its scope, including after quarantine.
 */
env.presentationCSS = `
.dshss-root, .dshss-settings, .dshss-dialogContent, .dshcs-section,
.dshch-panel, .dshqf-panel, .dshqw-editor, .dshhp-tooltip,
.dshwp-sidebar, .dshwp-skills, .dshwp-taskLanding {
  font-family: var(--dsw-font-family, inherit);
}
:where(.dshss-root, .dshss-settings, .dshss-dialogContent, .dshcs-section, .dshqf-panel, .dshqw-editor) :where(button, input, textarea, select) {
  font-family: inherit;
}
:where(.dshcs-section, .dshqf-panel, .dshqw-editor) :where(button, input, textarea, select) { box-sizing: border-box; }
/* One viewport background joins the caption and rail. Fade before native window controls. */
html[data-dshlr-active][data-windows-titlebar] body {
  --dshlr-material-span: min(560px, max(0px, calc(100vw - 160px)));
  background-color: var(--dsw-specific-sidebar-fill);
  background-image:
    linear-gradient(90deg, transparent, var(--dsw-specific-sidebar-fill) var(--dshlr-material-span)),
    radial-gradient(ellipse at left top, color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent), transparent 75%),
    radial-gradient(ellipse at left bottom, color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent), transparent 75%);
  background-attachment: fixed;
  background-repeat: no-repeat;
}
html[data-dshlr-active][data-windows-titlebar] .BynINW_frame,
html[data-dshlr-active][data-windows-titlebar] .BynINW_frame::before,
html[data-dshlr-active][data-windows-titlebar] .dshlr-rail { background: transparent; }
html[data-dshlr-active][data-windows-titlebar] .BynINW_frame {
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
html[data-dshlr-active][data-windows-titlebar] .BynINW_frame::after {
  content: ''; position: fixed; z-index: 12; pointer-events: none;
  inset: var(--dshlr-pane-top) var(--dshlr-pane-edge) var(--dshlr-pane-edge)
    calc(var(--dsh-left-rail-width) + var(--dshlr-pane-gap));
  border-radius: var(--dshlr-pane-radius); corner-shape: round;
  box-shadow: 0 0 0 .5px var(--dsw-alias-border-l2), 0 2px 5px rgb(0 0 0 / .04);
  /* Native caption controls cover the titlebar; keep every edge below that boundary. */
  clip-path: inset(calc(-1 * var(--dshlr-pane-edge)) -40px -40px -40px);
}
html[data-dshlr-active][data-windows-titlebar] .BynINW_sidebarCol {
  --dsw-specific-sidebar-fill: transparent;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 65%, transparent);
  border-radius: var(--dshlr-pane-radius) 0 0 var(--dshlr-pane-radius);
  corner-shape: round;
  border-right: .5px solid var(--dsw-alias-border-l3);
}
html[data-dshlr-active][data-windows-titlebar] .BynINW_centerCol { border-radius: 0; }
html[data-dshlr-active][data-windows-titlebar] .BynINW_frame[data-sidebar-collapsed] > .BynINW_centerCol {
  border-top-left-radius: var(--dshlr-pane-radius);
  border-bottom-left-radius: var(--dshlr-pane-radius);
}
html[data-dshlr-active][data-windows-titlebar] .BynINW_frame[data-sidebar-collapsed] > .BynINW_sidebarCol { border-right: 0; }
html[data-dshlr-active][data-windows-titlebar] .BynINW_frame[data-rightbar-collapsed] > .BynINW_centerCol,
html[data-dshlr-active][data-windows-titlebar] [data-sidebar-right-panel] {
  border-top-right-radius: var(--dshlr-pane-radius);
  border-bottom-right-radius: var(--dshlr-pane-radius);
  corner-shape: round;
}
html[data-dshlr-active][data-windows-titlebar] .BynINW_bottomRow {
  border-radius: 0 0 var(--dshlr-pane-radius) var(--dshlr-pane-radius);
}
html[data-dshlr-active][data-windows-titlebar] ._2H3hWW_root:not(._2H3hWW_collapsed) { padding-top: 0; padding-bottom: 0; }
html[data-dshlr-active][data-windows-titlebar] .dshss-scroll {
  margin-right: calc(-1 * var(--dsh-sidebar-inline-padding, 12px));
  padding-right: calc(5px + var(--dsh-sidebar-inline-padding, 12px));
}
html[data-dshlr-active] .Dc7zOa_root[data-phase="hero"] .Dc7zOa_composerSeat { flex: 1; min-height: 0; }
html[data-dshlr-active] .Dc7zOa_root[data-phase="hero"] .Dc7zOa_composerHero {
  flex: 1; min-height: 0; justify-content: flex-end; gap: 0; padding-bottom: 16px;
}
html[data-dshlr-active] .Dc7zOa_composerHero > .Hqq-bq_root { flex: 1; min-height: 160px; height: auto; }
html[data-dshlr-active] .Dc7zOa_composerHero .Hqq-bq_headline { flex-direction: column; gap: 24px; font-weight: 400; text-align: center; }
html[data-dshlr-active] .Dc7zOa_composerHero .Hqq-bq_fish { color: var(--dsw-alias-label-caption); }
html[data-dshlr-active] .Dc7zOa_heroWorkspaceRow {
  box-sizing: border-box;
  width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 32px);
  max-width: calc(100% - 32px); align-self: center;
  flex: none; margin: 0 auto; padding: 6px 10px; min-height: 40px;
  justify-content: flex-start; flex-wrap: wrap; gap: 8px 12px;
  border-radius: 16px 16px 0 0; background: var(--dsw-alias-bg-module-platform);
}
html[data-dshlr-active] .Dc7zOa_heroOptions { margin-left: 0; max-width: 100%; justify-content: flex-start; flex-wrap: wrap; }
html[data-dshlr-active] .Dc7zOa_heroWorkspaceRow :is(.Hqq-bq_workspace,._oGoKq_seat,.dshgit-trigger) {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  min-height: 28px; height: 28px; font-size: 13px; line-height: 20px;
}
html[data-dshlr-active] .dlU_AG_trigger { box-sizing: border-box; align-items: center; gap: 4px; }
html[data-dshlr-active] .dlU_AG_trigger :is(.dlU_AG_triggerIcon,.dlU_AG_chevron) {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 14px; height: 14px; line-height: 0; translate: 0 1px;
}
html[data-dshlr-active] .dlU_AG_trigger :is(.dlU_AG_triggerIcon,.dlU_AG_chevron) > svg { display: block; width: 14px; height: 14px; }
@container (width <= 460px) {
  html[data-dshlr-active] .dlU_AG_trigger :is(.dlU_AG_triggerIcon,.dlU_AG_chevron) { translate: none; }
}
html[data-dshlr-active] .dlU_AG_trigger:has(path[d="M8 4.39209V9.89209"]) :is(.dlU_AG_triggerLabel,.dlU_AG_triggerIcon),
html[data-dshlr-active] button[role="menuitem"]:has(path[d="M8 4.39209V9.89209"]),
html[data-dshlr-active] button[role="menuitem"]:has(path[d="M8 4.39209V9.89209"]) :is(span,svg) {
  color: var(--dsw-alias-state-warn-label);
}
html[data-dshlr-active] .RlGAzG_input { min-height: 36px; }
html[data-dshlr-active] .RlGAzG_row { align-items: center; }
html[data-dshlr-active] .RlGAzG_primary {
  width: 32px; height: 32px; transform: none;
  background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground);
}
html[data-dshlr-active] .RlGAzG_primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
html[data-dshlr-active] .RlGAzG_add { background: transparent; }
html[data-dshlr-active] .RlGAzG_add:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
@media (max-height: 520px) {
  html[data-dshlr-active] .Dc7zOa_composerHero > .Hqq-bq_root { min-height: 80px; }
  html[data-dshlr-active] .Dc7zOa_composerHero .Hqq-bq_headline { flex-direction: row; gap: 8px; font-size: 20px; line-height: 28px; }
}
`
