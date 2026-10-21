/**
 * Serve a private UI fixture using a read-only copy of the installed DSH build.
 * No DSH process, remote gateway, user profile, session or credentials are used.
 * Usage: node scripts/review-ui.mjs [path-to-extracted-official-packages]
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const upstream = path.resolve(process.argv[2] ?? path.join(root, 'node_modules/.review-upstream'))
const output = path.join(root, 'node_modules/.review-ui')
fs.mkdirSync(output, { recursive: true })
const assets = path.join(upstream, 'dsh-web-frontend/dist/assets')
const names = fs.readdirSync(assets)
const html = fs.readFileSync(path.join(upstream, 'dsh-web-frontend/dist/index.html'), 'utf8')
const entryName = /src="\.\/assets\/([^"/]+\.js)"/.exec(html)?.[1]
if (!entryName) throw new Error('Expected the official dsh-web-frontend/dist/assets bundle')
let entry = fs.readFileSync(path.join(assets, entryName), 'utf8')
const seed = /function (\w+)\(\)\{return\{react:/.exec(entry)?.[1]
const boot = entry.indexOf('const Ms=globalThis.dshDesktopBoot')
if (!seed || boot < 0)
  throw new Error('Unsupported DSH seed format; review this adapter before running')
entry = entry.slice(0, boot) + '\nexport const staticModules = ' + seed + '();\n'
fs.writeFileSync(path.join(output, entryName), entry)
for (const name of names.filter(
  (name) => /^vendor-.*\.(js|css)$/.test(name) || /^index-.*\.css$/.test(name),
)) {
  fs.copyFileSync(path.join(assets, name), path.join(output, name))
}
const parts = {
  sidebar: 'SidebarRoot',
  conversation: 'SessionInputShell, ConversationContent, InputBar, QueueDock',
  attachment: 'ComposerAttachments',
  layout: 'AppFrame',
  'model-selection': 'ModelSelect',
  'permission-presets': 'PermissionSelect',
  schedule: 'TaskManagerPage',
  'plugin-manager': 'PluginManagerPage, IDLE_INSTALL',
}
for (const [name, exports] of Object.entries(parts)) {
  const source = fs.readFileSync(
    path.join(upstream, 'dsh-client-ui-' + name, 'lib/client.js'),
    'utf8',
  )
  fs.writeFileSync(
    path.join(output, name + '.js'),
    source.replace(
      'return module.exports;',
      'exports.__review = {' +
        exports +
        '}; exports.__reviewLocale = typeof accessZh !== "undefined" ? accessZh : typeof zh === "undefined" ? {} : zh; return module.exports;',
    ),
  )
}
const theme = fs.readFileSync(path.join(upstream, 'dsh-client-ui-theme/lib/client.js'), 'utf8')
const styles = [...theme.matchAll(/var \w+_css_default = ("(?:[^"\\]|\\.)*");/g)]
  .map((match) => JSON.parse(match[1]))
  .join('\n')
fs.writeFileSync(path.join(output, 'theme.css'), styles)
fs.copyFileSync(path.join(root, 'client.js'), path.join(output, 'client.js'))
fs.copyFileSync(path.join(root, 'checks/fixtures/review-ui.js'), path.join(output, 'fixture.js'))
fs.copyFileSync(path.join(root, 'checks/fixtures/workbench-pages.js'), path.join(output, 'workbench-fixture.js'))
fs.writeFileSync(
  path.join(output, 'index.html'),
  `<!doctype html><html lang="zh-CN" data-windows-titlebar style="--dsh-windows-titlebar-height:40px"><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="theme.css">${names
    .filter((name) => name.endsWith('.css'))
    .map((name) => '<link rel="stylesheet" href="' + name + '">')
    .join(
      '',
    )}<style>html,body,#root{height:100%;margin:0}body{font-family:var(--dsw-font-family);font-size:14px;color:var(--dsw-alias-label-primary)}.fixture-settings{padding:32px;overflow:auto}.fixture-transcript{flex:1;min-height:240px;padding:32px;box-sizing:border-box}.fixture-caption{position:fixed;left:var(--dsh-windows-menu-start,48px);top:0;height:40px;display:flex;align-items:center;gap:20px;color:var(--dsw-alias-label-secondary);z-index:30}</style></head><body><div id="root"></div><script type="module">import {staticModules} from './${entryName}';globalThis.__reviewModules=staticModules;await import('./fixture.js')</script></body></html>`,
)
fs.writeFileSync(
  path.join(output, 'playwright.json'),
  JSON.stringify(
    {
      browser: {
        browserName: 'chromium',
        isolated: true,
        launchOptions: { channel: 'msedge', headless: true, args: ['--mute-audio'] },
        contextOptions: {
          viewport: { width: 1440, height: 900 },
          reducedMotion: 'reduce',
          serviceWorkers: 'block',
        },
      },
      outputDir: path.join(root, 'output/playwright'),
      timeouts: { action: 5000, navigation: 15000 },
    },
    null,
    2,
  ),
)
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  const target = path.resolve(output, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (
    !target.startsWith(output + path.sep) ||
    !fs.existsSync(target) ||
    !fs.statSync(target).isFile()
  ) {
    res.writeHead(404)
    res.end()
    return
  }
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }
  res.writeHead(200, { 'content-type': mime[path.extname(target)] ?? 'application/octet-stream' })
  fs.createReadStream(target).pipe(res)
})
server.listen(0, '127.0.0.1', () =>
  console.log(
    'private review fixture: http://127.0.0.1:' +
      server.address().port +
      '\nconfig: ' +
      path.join(output, 'playwright.json'),
  ),
)
const shutdown = () => server.close()
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
setTimeout(shutdown, 20 * 60 * 1000).unref()
