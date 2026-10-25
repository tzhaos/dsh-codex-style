/** Immediate presentation for plugin-owned surfaces; native focus lifecycles remain in control. */
__DSH_FEATURE('dsh-instant-ui', function () {
  const surfaces = [
    '.dsh-motion-surface', '.dshe-panel', '[data-dshe-native-model]', '.dshch-panel',
    '.dshst-searchModal', '.dshss-hoverCard', '.dshqf-annotationPanel',
    '.dsh-selection-toolbar', '.dshhp-tooltip', '.dshfl-toast', '.dshgit-menu',
    '.dshlr-displayMenu', '.dshss-viewMenu', '.dshqf-panel',
    '.dshwp-skills', '.dshwp-taskLanding', '[role="tooltip"][data-dshhp-ready]',
  ].join(',')
  const controls = `:where(${surfaces},.dshlr-rail,.dshss-root,.dshss-settings,
    .dshcs-section,.dshst-headerActions,
    .dshqw-freeze,.dshqf-quotes) :where(button,[role="button"],[role="menuitem"])`
  const css = `
    :is(${surfaces}),
    [role="presentation"]:has(> :is(${surfaces})[aria-modal="true"]),
    [role="presentation"]:has(> :is(${surfaces})[aria-modal="true"]) > *,
    ${controls},
    .dshss-rowActions,.dshss-sectionArrow,.dshqw-grip,.dshqw-queueGlyph,
    [class*="_trigger"][data-dshe-trigger] [class*="_chevron"] {
      animation:none!important;transition:none!important;
    }
  `
  return {
    apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'dsh-instant-ui'
        style.textContent = css
        document.head.append(style)
        return () => style.remove()
      }, 'instant-ui: styles')
    },
  }
})
