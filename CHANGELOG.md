# Changelog

All notable changes to the merged `dsh-codex-style` bundle are documented here.
Sub-plugin behaviour comes from the standalone repositories this bundle merges;
their per-release history remains in those repositories.

## [1.2.0] - 2026-10-20

### Changed

- Display name: **Codex Workbench / Codex 工作台**. Keep the package name, loader ID and existing storage keys compatible.
- Organize code by navigation, composer, conversation content, side panels and shared infrastructure. A single catalog owns IDs, source paths and settings groups.
- Split selection capture, composer quotes and temporary side chat into separate capabilities. Providers register actions receiving only a session ID and selected text; removing a provider removes its entry.
- Group settings by task and use the host Switch, Menu, Modal and Tooltip components.
- Align Back, Forward, native sidebar toggle and native menus in the caption row. Reuse official DSH SVG artwork and change paint for active states.
- Keep the empty-conversation heading centered and the composer at the bottom; normalize navigation metrics, typography, borders and theme tokens.

### Fixed

- Attachment removal no longer loses the InputShell receiver. Public state and attachment APIs replace shared ConversationController method patches.
- Queue uploads preserve concurrent enqueues and never resurrect claimed messages. Withdraw rollback preserves newer drafts, and fresh shells retain pending file restoration.
- Held attachment rows converge without a MutationObserver loop. Dragging shows insertion hints without moving React-owned children, and cancellation does not submit.
- Queue holds persist through atomic file replacement; write failures roll back the requested change. Remove temporary layout-diagnostic uploads and append-only logs.
- Side-chat submission respects IME composition and preserves the next draft. Cancelled creation and retained-binding disposal cannot reopen a closed child session.
- Failed quote submission and reload preserve accepted quotes beyond the new-admission limit.
- Nested effects follow their actual service context; stale navigation failures cannot rewind newer navigation. File references preserve valid punctuation and decode file URIs.

### Validation

- Regression checks cover state ownership, lifecycle, rollback, persistence failure and cross-area registration.
- An isolated browser fixture reuses the installed DSH editor, attachment rail, primitives and CSS without connecting to a DSH gateway or personal session.

## [1.1.0] - 2026-10-20

### Added

- Per-feature failure isolation: a sub-plugin that throws while building,
  applying, in an effect, in a slot label/inject callback or while rendering is
  contained instead of affecting the rest of the bundle.
  - every feature applies on its own disposable scope; a failure releases that
    feature's slot registrations, effects and listeners;
  - every component a feature registers is wrapped in that feature's React error
    boundary: a render crash renders nothing for it and schedules a quarantine
    while the host tree and the other sub-plugins stay up;
  - features may declare `requires`; dependents of a failed or quarantined
    feature are marked skipped and quarantined with it;
  - failures and skips are stored in `dsh.codexStyle.failures`; the matching
    Settings → Codex Style tab shows failed/quarantined/skipped with the reason,
    and a successful load clears the record.
- Settings page health reporting: a per-tab badge and a failure/isolated/skipped
  notice with the reason and retry hint; a settings-page error boundary
  quarantines only the page's own feature.
- `checks/isolation.mjs` plus new bundle-contract checks: 14 check files and 340
  zero-dependency checks.

### Changed

- `client.js` now also embeds `src/isolation.js`; `apply` no longer runs every
  feature on the shared context, and runtime quarantines are deferred out of the
  render phase.
- Version bumped to 1.1.0.

## [1.0.0] - 2026-10-20

### Added

- Merged eleven Codex-style plugins into one DSH web-client bundle:
  - `dsh-sidebar-sections` 2.4.2 — Pinned / Projects / Recent / Archived sidebar,
    drag ordering, row menus, safe delete and restore.
  - `dsh-left-rail` 1.9.4 — Codex-style 46px left icon rail and brand menu.
  - `dsh-nav-back-forward` 1.3.4 — Session back/forward in the Windows caption row.
  - `dsh-hover-polish` 1.0.11 — unified hover feedback and Codex-style tooltips.
  - `dsh-tab-middle-click` 1.0.1 — middle-click closes sidebar/dock tabs.
  - `dsh-long-paste` 1.1.1 — long plain-text pastes become `.txt` attachments.
  - `dsh-sidebar-file-drop` 1.1.1 — drag sidebar files into the composer as references.
  - `dsh-file-link-actions` 1.0.0 — file-link context menu actions.
  - `dsh-composer-history` 1.2.0 — searchable prompt history and `↑` recall.
  - `dsh-queue-withdraw` 1.11.5 — queue withdraw, native inline edit, drag reorder and lock.
  - `dsh-quick-fork` 0.6.0 — selection fork into a temporary side conversation.
- New **Settings → Codex Style** section: one tab per merged feature, a shared
  enable switch per feature, the original feature settings pages (sidebar
  sections, prompt history) and the data/limitation notes.
- Feature enable preferences persist in browser `localStorage` under
  `dsh.codexStyle.features` and apply on the next full DSH restart.
- One Host half keeps the queued-message routes and the `inbox.claim` lock patch.
- Zero-dependency check suite covering the bundle contract, the settings shell
  and every merged feature.

### Changed

- The browser half is now one generated `client.js` built from `src/features/`
  by `scripts/build-client.mjs`; features are lazy and a failing feature is
  reported and skipped instead of breaking the whole bundle.
- Sub-plugin localStorage keys, Host routes and stored data are preserved, so
  replacing the standalone plugins with this bundle loses nothing.
- Feature settings no longer register separate `settings.plugins.tab` entries;
  they render inside the merged Codex Style section.

### Removed

- Per-plugin installation and per-plugin release flow for the merged features.
  The standalone repositories remain available for users who only want one or
  two interactions.
