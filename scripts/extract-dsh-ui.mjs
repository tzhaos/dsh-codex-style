/** Read public UI assets from an installed ASAR into an isolated fixture cache. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const archive = path.resolve(
  process.argv[2] ??
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs/DeepSeek Harness/resources/app.asar'),
)
const output = path.resolve(root, 'node_modules/.review-upstream')
const fd = fs.openSync(archive, 'r')
try {
  const prefix = Buffer.alloc(8)
  fs.readSync(fd, prefix, 0, 8, 0)
  const headerSize = prefix.readUInt32LE(4)
  if (headerSize < 8 || headerSize > 16 * 1024 * 1024) throw new Error('Unsupported ASAR header')
  const header = Buffer.alloc(headerSize)
  fs.readSync(fd, header, 0, header.length, 8)
  const jsonSize = header.readUInt32LE(4)
  if (jsonSize > headerSize - 8) throw new Error('Invalid ASAR header length')
  const directory = JSON.parse(header.subarray(8, 8 + jsonSize).toString('utf8'))
  const dataOffset = 8 + headerSize
  const archiveSize = fs.fstatSync(fd).size
  const packages = new Set([
    'dsh-client-ui-layout',
    'dsh-client-ui-sidebar',
    'dsh-client-ui-conversation',
    'dsh-client-ui-attachment',
    'dsh-client-ui-permission-presets',
    'dsh-client-ui-model-selection',
    'dsh-client-ui-schedule',
    'dsh-client-ui-plugin-manager',
    'dsh-client-ui-theme',
    'dsh-web-frontend',
  ])
  let copied = 0
  function walk(node, key = '') {
    if (node.files) {
      for (const [name, value] of Object.entries(node.files))
        walk(value, key ? key + '/' + name : name)
      return
    }
    const match = /^dsh\/node_modules\/@deepseek-ai\/([^/]+)\/(.+)$/.exec(key)
    if (!match || !packages.has(match[1])) return
    const relative = match[2]
    if (
      !(
        relative === 'package.json' ||
        relative === 'lib/client.js' ||
        relative === 'dist/index.html' ||
        /^dist\/assets\/(?:index-|vendor-).+\.(?:js|css)$/.test(relative)
      )
    )
      return
    const size = Number(node.size),
      offset = dataOffset + Number(node.offset)
    if (
      node.unpacked ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > 32 * 1024 * 1024 ||
      !Number.isSafeInteger(offset) ||
      offset < dataOffset ||
      offset + size > archiveSize
    )
      throw new Error('Unsupported ASAR entry: ' + key)
    const bytes = Buffer.alloc(size)
    if (fs.readSync(fd, bytes, 0, size, offset) !== size)
      throw new Error('Incomplete ASAR entry: ' + key)
    if (relative === 'package.json' && JSON.parse(bytes).version !== '0.2.1-rc.2')
      throw new Error('This UI fixture supports DSH 0.2.1-rc.2 only')
    const target = path.resolve(output, match[1], relative)
    if (!target.startsWith(output + path.sep))
      throw new Error('ASAR path escaped fixture directory')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
    copied++
  }
  walk(directory)
  if (copied === 0) throw new Error('No supported DSH UI assets found')
  console.log('copied ' + copied + ' public UI files to ' + output)
} finally {
  fs.closeSync(fd)
}
