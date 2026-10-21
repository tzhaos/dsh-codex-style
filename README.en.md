# Codex Workbench

Codex-style navigation, composer tools, content actions and side panels for DeepSeek Harness.
The installation name and module ID remain `dsh-codex-style` for compatibility.

Supported baseline: DSH `0.2.1-rc.2`. Build and checks require Node.js 22 or later. No third-party runtime dependencies.

## Capabilities

Settings → **Codex Workbench** groups capabilities by task, with independent switches.

| Group | Capabilities |
|---|---|
| Sessions and navigation | Session list, navigation rail, back and forward |
| Composer | Queue editing, prompt history, long paste, file references, selection quotes |
| Content actions | File context menu, selection toolbar |
| Side panels | Temporary side chat, middle-click tab close |
| Interaction | Hover feedback |

The caption order is **Back → Forward → Toggle sidebar → Native menus**.
The rail uses DSH SVG artwork; activation changes its fill, inverse details and weight.
The empty conversation keeps a centered heading and a bottom composer, using host theme colors.

## Boundaries

The content toolbar reads selected text. Composer and side-panel modules register actions that receive only `{ sessionId, text }`.
Disposing a provider removes its action without affecting another area.

See [architecture](docs/ARCHITECTURE.md) and the [review report](docs/REVIEW.md) for implementation boundaries, repairs and validation coverage.

## Install and update

Install the local bundle in a DSH Creator session using an absolute path:

```text
plugin_manager(action="install_bundle", target="<absolute clone directory>")
```

Or install through the CLI:

```powershell
git clone https://github.com/tzhaos/dsh-codex-style.git
dsh plugin --profile desktop add "<absolute clone directory>"
```

For CLI installation, add `dsh-codex-style` to the desktop profile's `dsh.profile.bundles`.
Existing path-linked installations use the updated source after a complete DSH restart.
Capability switches also take effect after a complete restart.

## Data

- Ordering, collapse state, prompt history, selection quotes and feature preferences remain browser-local.
- Existing `dsh.sidebarSections.*`, `dsh.composerHistory.*`, `dsh.quickFork.*` and `dsh.codexStyle.*` keys remain compatible.
- Queue file caches use IndexedDB and upload-reference matching. Expired records cannot restore a file.
- Queue holds use atomic replacement of `$DSH_HOME/queue-withdraw-frozen.json`. Persistence failure rolls back the requested change.
- Closing a temporary side chat stops and archives its child session. DSH retains the messages.

The former selection-fork feature is split into a content toolbar, composer quotes and side chat.
An existing disabled preference remains disabled across that split until the new capability is explicitly configured.

## Development

```powershell
node scripts/build-client.mjs
node scripts/check.mjs
```

`client.js` is generated. `src/catalog.json` owns capability IDs, source locations and build order.
The artifact remains one browser module with separate failure boundaries and cleanup scopes.

```text
src/
  navigation/     Session organization and navigation
  composer/       Input state, history, attachments and quotes
  conversation/   Content selection and file actions
  panels/         Side chat and panel tabs
  shared/         Presentation, official icon adapter, action registry, isolation
  settings.js     Task-group settings
  catalog.json    Capability inventory
```

The isolated UI fixture uses public assets from the locally installed DSH build:

```powershell
node scripts/extract-dsh-ui.mjs
node scripts/review-ui.mjs
```

The fixture prints its private loopback URL and Playwright configuration.
Run `checks/fixtures/verify-ui.js` in a separate, muted, headless browser session.
Extracted assets remain in the ignored `node_modules/.review-upstream` directory. No DSH gateway or personal sessions are used.

DOM compatibility adapters are concentrated in navigation, presentation and queue decoration. Recheck them against the official build when upgrading DSH.

[MIT](LICENSE)
