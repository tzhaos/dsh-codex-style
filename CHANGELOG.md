# Changelog

All notable changes to the merged `dsh-codex-style` bundle are documented here.
Sub-plugin behaviour comes from the standalone repositories this bundle merges;
their per-release history remains in those repositories.

## [1.3.4] - 2026-10-26

### Changed

- Audited the remaining host-owned class hashes. Model effort, permission trigger, composer primary/input/row/add, queue dock rows, attachment thumbnails/cards and the continue send button now use suffix selectors or plugin-owned classes instead of DSH hash literals.
- The workbench customisation layer for Automation tasks and Plugins is gone; both pages keep their native DSH headers, tabs, search, cards and schedules list. Only rail navigation remains.

### Validation

- `node scripts/check.mjs`: 526 checks green (20 merged features).

## [1.3.3] - 2026-10-26

### Changed

- Removed the workbench customisation layer for the Automation tasks and Plugins panels. The rail still navigates to both native panels, but their headers, search fields, tabs, cards, sidebars and schedules list keep the native DSH implementation and no longer depend on host hash selectors.

### Validation

- `node scripts/check.mjs`: 526 checks green (20 merged features).

## [1.3.2] - 2026-10-26

### Fixed

- DSH 0.2.1-rc.x host class hashes changed (`BynINW_*`, `Dc7zOa_*`, `Hqq-bq_*`). The rail, session history, sidebar tools, workbench pages and window presentation now key off stable class suffixes instead of stale hashes.
- Native sidebar panel rows are mirrored into the rail dynamically: `插件`, `自动化任务`, `ThoughtDAG` and future panel rows get a rail button with the host's own SVG, hide from the sidebar, and track the native active state. The `更多` marketplace row stays native.

### Validation

- `node scripts/check.mjs`: 526 checks green.

## [1.3.1] - 2026-10-25

### Fixed

- Conversation-wide right-click: the Session log download menu now opens from any point inside the conversation body, including message text and the transcript background, instead of only the side gutters. Attachment surfaces keep their richer attachment menu; editors, the composer card and the queue dock keep their native menus.

### Validation

- `checks/attachment-actions.mjs` covers the conversation scope and its editor/composer exclusions.

## [1.3.0] - 2026-10-21

### Added

- Inline composer status (`dsh-composer-status`): the host context-occupancy ring and the two session stat buttons move from the external dock row into the composer's own control row. All three keep only their icon — the ring sits directly before the model name and the stat buttons hug it from the left — while tooltips and click-open detail dialogs stay native. The external dock no longer adds vertical height, so the composer card stays on the window bottom; the icon pair collapses away first on narrow rows.

### Validation

- `checks/composer-status.mjs` covers the fit plan (wide, boundary, tool-collision and wrapped-row cases), dock surface splitting and the no-reparent/no-text-write contract; the isolated review fixture gains an opt-in status mode that supplies the host projections for visual verification.

## [Unreleased]

### Added

- Account launcher and update install button (`dsh-left-rail`): when DSH is signed in to a DeepSeek account the bottom-left settings launcher becomes the account avatar, and clicking it opens a native DSH `Menu` with the topped-up and bonus wallet balance, Settings, Help and Sign out. The balance row only appears when the account Remote can answer, so third-party or API-key-only setups keep the plain settings launcher without inventing a number; sign out warns first when tasks are still running. On Desktop, a blue install circle sits above the avatar whenever the updater reports an available, downloading or ready version and opens DSH's official update flow. Everything reuses the shell `Menu`, `Modal` and `Button` primitives, so the menu keeps the native surface, shortcuts and keyboard behaviour.
- Attachment action menu (`dsh-attachment-actions`): right-click a draft, message, tool-result or trajectory attachment to copy the image, copy its address, save the original bytes, open the host lightbox, copy file names and sizes, or remove a composer draft. Desktop-dropped drafts also copy their host path, reveal in the file manager or open with the default application. The menu reuses the host `Menu` and `Toast` primitives and only reads the rendered DOM.
- Image preview zoom (`dsh-image-zoom`): the Host lightbox image now zooms around the pointer with the wheel (1× to 8×), pans with a left-button drag while zoomed, and returns to fit size on double-click. The listener only recognises the lightbox dialog whose stage holds a direct image, so ordinary modals are untouched, and the transform is cleared when the preview closes.

### Changed

- The window material follows the Windows 11 accent color and now reacts to a color change the moment the shell applies it: the Host half listens on the two Personalization registry keys with `RegNotifyChangeKeyValue` (one read-only PowerShell helper, no polling) and pushes the decoded palette over a same-origin event stream, so the material switches without a reload or a wait — base accent on light surfaces, the lighter shade on dark ones. The DWM `AccentColor` value is the base tone because it keeps the color the user picked (the `AccentPalette` base is Windows' contrast-adjusted control shade), and the palette shades are used only while they still describe that tone; if the helper cannot run, the browser keeps a short GET-poll fallback, and an unreadable palette keeps the neutral theme surface. The wash now follows the Codex window chrome: a very pale, full-width tint (7% at the top fading to 4%, unchanged 18%/8% on dark surfaces) covers the caption row instead of a saturated left-only band, so the material reads as light as the system window around it. The native Window Controls Overlay cannot be tinted from the renderer, so the wash fades back to the surface tone before that strip using `env(titlebar-area-*)`; the caption no longer ends in a white block around the minimize/maximize/close buttons. The previous fixed brand-blue and amber glows are gone.
- Composer status panels stay centered on the status button that opened them: the pressed button is remembered per composer, and a panel that appears before its `aria-expanded` attribute lands is retried on the next layout pass, so the context ring and both stat pills each center their own panel instead of falling back to the Host's left-aligned anchor.
- Long pasted text becomes a real temporary file instead of an uploaded blob: the Host writes it as UTF-8 under `$DSH_HOME/dsh-codex-style/pasteboard/` and the composer inserts the absolute path as a native `@` file reference, so the chip shows up like any other file and clicking it opens the side-panel preview. The Host empties that folder on every start and keeps only the newest 100 files (oldest pruned on each write), so the pasteboard cannot grow without bound; a failed save now restores the intercepted paste inline instead of losing it.
- Attachment previews in the composer, the queue and the transcript get a readable hairline and a solid accent hover edge. The Host hairline (`border-l1` / `darkmode-thin`) nearly disappears on the input surface, so white and transparent previews looked borderless; the stroke now uses `border-l3`, and hovering or focusing a preview swaps in the business accent as one continuous 1.5px stroke — a 0.5px accent border plus a 1px halo of the same color — instead of a lighter separate ring of a different tone, so the highlight fits the border at every corner. Only color and shadow change, so nothing shifts or resizes under the pointer, and reduced-motion users get no transition.
- The two composer stat buttons follow the Host **Performance & usage** preference (`ui-chat` → `performanceUsage`): compact mode only carries plain-text speed and cache-hit readings, which this icon-only row hides, so the buttons are dropped instead of leaving two glyphs without content. Detailed mode keeps them, and a missing Host form falls back to visible.
- Reasoning-effort levels show the model catalog's original English names in every UI language again: the slider no longer replaces the provider's own `Low` / `Medium` / `High` / `Extra high` / `Max` spelling with translated labels, on the composer trigger, the panel heading or the accessibility value. The surrounding control copy stays localized, and the translation keys for the effort names are gone from both dictionaries.
- Queue rows keep one **Edit** action and no in-place editor: the Host edit control now withdraws the message back into the composer (attachments included through the existing cache/image restore paths) instead of opening its inline editor. The separate withdraw button and the row menu are removed.
- The lock is a visible peer of the Host row actions: same 28px circle, hover pill, focus ring and 14px icon size, including the native `corner-shape: round` hover shape. Its artwork is redrawn on the native 16-unit grid with the regular one-pixel stroke, so closed/open locks match the primitive icon weight and style.
- The queued row's leading message icon is now the lock toggle: it keeps the native message glyph while idle and swaps to the closed lock when held, so the icon is useful and the separate action-cluster lock button is gone. Dragging moves to the dedicated grip at its left, keeping click-to-lock and drag apart.
- Queue attachment previews use the Host `ImageLightbox` primitive (the same surface as composer and transcript images) instead of a bespoke modal, and queue thumbnails/files answer right-click with the shared attachment menu (copy image/address, save image, view image, copy file name and size).
- Merging queued messages now keeps every attachment: the drag-merge writes the combined text plus both messages' image/file blocks through the update route and only then removes the source, instead of relying on the text-only Host merge.
- The two composer stat pills and the context ring stay three separate icon buttons moved into the composer control row, each keeping its own Host tooltip and detail panel.
- The Host **steer** action keeps its native icon, tooltip, order and label; the custom 「引导」 mask glyph and text pill are removed, and only the remove control is still intercepted.
- The queue handle's leading glyph is the Host's own message icon (`IconQueueOutlineRegular`) instead of a bespoke queue arrow, matching the native icon grid and stroke.
- Queued messages are always expanded: the Host dock header (count + collapse chevron) is removed and a collapsed list state is forced open, so queued rows and their actions cannot be hidden behind a collapse toggle.
- Withdrawing into a composer that already holds text or attachments now asks for confirmation before the draft is replaced, instead of silently dropping it.
- Icon-only hover surfaces stay circular: the prompt-history clock, the two composer status pills, the context-ring control and the left-rail add button all use `border-radius: 999px` with `corner-shape: round` instead of rounded-square superellipses.

### Fixed

- Composer icon controls share one hover surface: the prompt-history trigger, the context ring and the two session stat pills all hover as a 28px circle (the ring and the pills previously hovered at 20px), and the history clock glyph grows from 14px to the 16px composer icon scale. Only padding and the icon size change, so every control keeps its own action and dialog.
- The queued row's **Edit** action works again: the withdrawal reads the previous draft from the published `snapshot.draft` string instead of the shell's structured `draftSnapshot` document, which was not text and made the action throw before it could withdraw anything (queued messages with image attachments included).
- Native browser tooltips no longer leak from plugin-owned controls: the queue handle/lock no longer write the native `title` attribute (the custom hover layer owns the tooltip), the Host edit control's refusal title is stripped, and the back/forward, effort-model, long-paste, quote-annotation and removed-session controls lost their redundant native titles.
- The composer status detail panels open centered on the status button that was clicked (clamped to the viewport) instead of centered on the whole composer card.
- The queue row's two leading icons sit together: the grip column is 16px wide and the message/lock toggle pulls 8px against it, closing the 24px glyph gap to 10px.
- Clicking a control now dismisses its hover bubble for the rest of that pointer visit: the tooltip no longer reappears over the action or panel the click just opened, and it returns once the pointer leaves and re-enters the control.

### Removed

- Settings no longer list safely removed conversations or recorded prompt history. The **Sidebar sections** page keeps only the Archived-section switch, and the **Prompt history** page keeps only its explanation. Removed conversation titles and recorded prompts are never surfaced in Settings; safe delete stays one-way from the UI, while per-conversation history clearing remains in the composer's history palette.

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
