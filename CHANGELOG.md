# Changelog

All notable changes to the merged `dsh-codex-style` bundle are documented here.
Sub-plugin behaviour comes from the standalone repositories this bundle merges;
their per-release history remains in those repositories.

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
