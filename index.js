/**
 * Host half of the dsh-codex-style bundle.
 *
 * The merged plugin keeps one Host entry because a Loader row is also how the
 * Client module registry discovers the browser bundle. Most merged features are
 * pure UI; the queued-message feature still needs the Host's Inbox splice, so
 * this half keeps the narrow same-origin routes it shipped before (the paths
 * stay under /dsh-queue-withdraw/... so the merged browser feature works
 * unchanged):
 *
 *   - reorder accepts the complete next-turn id order and applies it atomically
 *     after verifying the ids still match the live queue;
 *   - update rewrites one queued item (text plus kept and newly uploaded
 *     attachments);
 *   - freeze/thaw move one queued message in and out of the held set that the
 *     turn boundary must skip; the hold is persisted under DSH_HOME and
 *     enforced by wrapping the inbox claim entry point.
 *
 * @module dsh-codex-style
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerGit } from './host/git.js'
import { registerActivityPreview } from './host/activity-preview.js'

const REORDER_PATH = '/dsh-queue-withdraw/reorder'
const UPDATE_PATH = '/dsh-queue-withdraw/update'
const FREEZE_PATH = '/dsh-queue-withdraw/freeze'
const THAW_PATH = '/dsh-queue-withdraw/thaw'
const FROZEN_PATH = '/dsh-queue-withdraw/frozen'
const MAX_BODY = 32 * 1024 * 1024

/** Per-session ids the loop must not claim; mirrored to `$DSH_HOME`. */
const frozenSessions = new Map()
const claimPatches = new Map()

/** @returns {string} the persistent frozen-id file. */
function frozenFile() {
  const home =
    typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
      ? process.env.DSH_HOME
      : path.join(os.homedir(), '.dsh')
  return path.join(home, 'queue-withdraw-frozen.json')
}

/** Load the persisted frozen ids once per Host process. */
function loadFrozen() {
  try {
    const raw = fs.readFileSync(frozenFile(), 'utf8')
    const parsed = JSON.parse(raw)
    const sessions = parsed !== null && typeof parsed === 'object' ? parsed.sessions : undefined
    if (sessions === null || typeof sessions !== 'object') return
    for (const [sessionId, ids] of Object.entries(sessions)) {
      if (!Array.isArray(ids)) continue
      frozenSessions.set(sessionId, new Set(ids.filter((id) => typeof id === 'string')))
    }
  } catch {
    // A missing or unreadable file simply starts with nothing frozen.
  }
}

/** Persist the current frozen ids. */
function saveFrozen() {
  const sessions = {}
  for (const [sessionId, ids] of frozenSessions) {
    if (ids.size > 0) sessions[sessionId] = [...ids]
  }
  const target = frozenFile()
  const temporary = target + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp'
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, sessions }, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
      flush: true,
    })
    fs.renameSync(temporary, target)
    return true
  } catch {
    return false
  } finally {
    try {
      fs.unlinkSync(temporary)
    } catch {
      /* moved, absent, or unwritable */
    }
  }
}

/**
 * @param {string} sessionId - conversation id.
 * @returns {Set<string>} held message ids.
 */
function frozenIdsOf(sessionId) {
  let ids = frozenSessions.get(sessionId)
  if (ids === undefined) {
    ids = new Set()
    frozenSessions.set(sessionId, ids)
  }
  return ids
}

/**
 * Wrap the inbox claim entry so held ids are skipped instead of sent. The patch
 * sits on the shared prototype, so it covers every agent created afterwards.
 * @param {object} inbox - one agent's durable inbox.
 */
function installClaimPatch(inbox) {
  if (inbox === null || inbox === undefined || typeof inbox !== 'object') return
  const proto = Object.getPrototypeOf(inbox)
  if (proto === null || typeof proto.claim !== 'function') return
  if (claimPatches.has(proto)) return
  const original = proto.claim
  const patched = function patchedClaim(target, turn) {
    if (target !== 'next-turn') return original.call(this, target, turn)
    const held = frozenSessions.get(this.session?.id)
    if (held === undefined || held.size === 0) return original.call(this, target, turn)
    const claimed = this.mutate('next-step', 0, this.nextStep.length, [], false)
    const queue = this.nextTurn
    const index = queue.findIndex((message) => !held.has(String(message.id)))
    if (index >= 0) claimed.push(...this.mutate('next-turn', index, 1, [], false))
    for (const message of claimed) this.dispatch.emit('agent/inbox/claimed', { message, turn })
    return claimed
  }
  proto.claim = patched
  claimPatches.set(proto, { original, patched })
}

/**
 * Patch every agent the Host can currently reach.
 * @param {object} ctx - Host context.
 */
function armAgents(ctx) {
  try {
    const state = typeof ctx.sessions?.list === 'function'
      ? ctx.sessions.list() : ctx.sessions?.list?.getSnapshot?.()
    const ids = Array.isArray(state) ? state.map((session) => session.id)
      : Array.isArray(state?.ids) ? state.ids : Object.keys(state?.byId ?? {})
    for (const sessionId of ids) {
      const agent = ctx.agents?.get?.(sessionId)
      if (agent?.inbox !== undefined) installClaimPatch(agent.inbox)
    }
  } catch {
    // The claim patch is also installed by every freeze/thaw/arm request.
  }
}

/**
 * @param {object} res - Node response.
 * @param {number} status - HTTP status.
 * @param {object} body - JSON payload.
 */
function sendJson(res, status, body) {
  res.writeHead?.(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end?.(JSON.stringify(body))
}

/** Match the public Connection fetch contract: authenticated owner and installation gate. */
function registerQueueRoute(ctx, route) {
  return ctx.webServer.register({
    ...route,
    async handler(req, res) {
      const admission = ctx.connection.admit(req)
      if ('rejection' in admission) {
        sendJson(res, admission.rejection, { ok: false, error: 'unauthorized' })
        return
      }
      if (admission.peer?.principal?.kind !== 'owner') {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      await ctx.waterfall('connection/request', req, res, () => route.handler(req, res))
    },
  })
}

/**
 * Read and parse the JSON request body.
 * @param {object} req - Node request.
 * @returns {Promise<object|null>} parsed body, or null when invalid.
 */
async function readJson(req) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY) return null
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Keep only attachment blocks this plugin understands.
 * @param {unknown} value - client-supplied blocks.
 * @returns {object[]} safe image/file blocks.
 */
function attachmentBlocks(value) {
  if (!Array.isArray(value)) return []
  const blocks = []
  for (const block of value) {
    if (block === null || typeof block !== 'object') continue
    if (block.type !== 'image' && block.type !== 'file') continue
    if (block.attachment === null || typeof block.attachment !== 'object') continue
    blocks.push({ type: block.type, attachment: block.attachment })
  }
  return blocks
}

/**
 * Persist one browser-uploaded attachment and return its queue block.
 * @param {object} attachments - Host attachment store.
 * @param {object} file - name, mediaType, kind and canonical base64 data.
 * @returns {Promise<object>} image/file content block.
 */
async function saveUpload(attachments, file) {
  if (typeof file?.data !== 'string' || file.data === '') throw new Error('empty upload')
  const bytes = Uint8Array.from(Buffer.from(file.data, 'base64'))
  if (file.kind === 'image') {
    const refs = await attachments.saveImages([
      {
        data: bytes,
        mediaType: typeof file.mediaType === 'string' ? file.mediaType : 'image/png',
        ...(typeof file.name === 'string' && file.name !== '' ? { name: file.name } : {}),
      },
    ])
    return { type: 'image', attachment: refs[0] }
  }
  const ref = await attachments.saveFile({
    data: bytes,
    ...(typeof file.name === 'string' && file.name !== '' ? { name: file.name } : {}),
  })
  return { type: 'file', attachment: ref }
}

/**
 * Register the reorder and content-edit routes.
 * @param {object} ctx - Host context.
 */
export function apply(ctx) {
  registerActivityPreview(ctx)
  registerGit(ctx)
  if (ctx?.webServer?.register === undefined || ctx?.agents?.get === undefined ||
      typeof ctx.connection?.admit !== 'function' || typeof ctx.waterfall !== 'function') return
  loadFrozen()
  ctx.effect(
    () => () => {
      for (const [proto, { original, patched }] of claimPatches) {
        if (proto.claim === patched) proto.claim = original
      }
      claimPatches.clear()
      frozenSessions.clear()
    },
    'queue-withdraw: claim patch lifetime',
  )
  armAgents(ctx)
  ctx.on?.('agent/created', ({ agent }) => {
    if (agent?.inbox) installClaimPatch(agent.inbox)
  })
  ctx.effect(
    () =>
      registerQueueRoute(ctx, {
        kind: 'exact',
        path: REORDER_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, reason: 'method-not-allowed' })
            return
          }
          const body = await readJson(req)
          if (body === null || typeof body !== 'object') {
            sendJson(res, 400, { ok: false, reason: 'invalid-body' })
            return
          }
          const sessionId = body.sessionId
          const order = body.order
          if (
            typeof sessionId !== 'string' ||
            sessionId === '' ||
            !Array.isArray(order) ||
            order.some((id) => typeof id !== 'string')
          ) {
            sendJson(res, 400, { ok: false, reason: 'invalid-request' })
            return
          }
          const agent = ctx.agents.get(sessionId)
          if (agent === undefined || agent?.inbox === undefined) {
            sendJson(res, 409, { ok: false, reason: 'agent-unavailable' })
            return
          }
          const current = [...agent.inbox.nextTurn]
          if (order.length !== current.length || new Set(order).size !== order.length) {
            sendJson(res, 409, { ok: false, reason: 'queue-changed' })
            return
          }
          const byId = new Map(current.map((message) => [String(message.id), message]))
          if (order.some((id) => !byId.has(id))) {
            sendJson(res, 409, { ok: false, reason: 'queue-changed' })
            return
          }
          const reordered = order.map((id) => byId.get(id))
          try {
            agent.inbox.splice('next-turn', 0, current.length, reordered)
            sendJson(res, 200, { ok: true })
          } catch {
            sendJson(res, 500, { ok: false, reason: 'reorder-failed' })
          }
        },
      }),
    'queue-withdraw: reorder route',
  )

  ctx.effect(
    () =>
      registerQueueRoute(ctx, {
        kind: 'exact',
        path: UPDATE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, reason: 'method-not-allowed' })
            return
          }
          const body = await readJson(req)
          if (body === null || typeof body !== 'object') {
            sendJson(res, 400, { ok: false, reason: 'invalid-body' })
            return
          }
          const sessionId = body.sessionId
          const action = body.action
          if (typeof sessionId !== 'string' || (action !== 'edit' && action !== 'merge')) {
            sendJson(res, 400, { ok: false, reason: 'invalid-request' })
            return
          }
          const agent = ctx.agents.get(sessionId)
          if (agent === undefined || agent?.inbox === undefined) {
            sendJson(res, 409, { ok: false, reason: 'agent-unavailable' })
            return
          }
          const current = [...agent.inbox.nextTurn]
          if (action === 'merge') {
            const targetId = String(body.targetId ?? '')
            const sourceId = String(body.sourceId ?? '')
            const held = frozenSessions.get(sessionId)
            if (held?.has(targetId) || held?.has(sourceId)) {
              sendJson(res, 409, { ok: false, reason: 'message-frozen' })
              return
            }
            const target = current.find((message) => String(message.id) === targetId)
            const source = current.find((message) => String(message.id) === sourceId)
            if (target === undefined || source === undefined || targetId === sourceId) {
              sendJson(res, 409, { ok: false, reason: 'queue-changed' })
              return
            }
            const merged = { ...target, content: [...target.content, ...source.content] }
            const next = current.flatMap((message) => {
              if (String(message.id) === sourceId) return []
              if (String(message.id) === targetId) return [merged]
              return [message]
            })
            try {
              agent.inbox.splice('next-turn', 0, current.length, next)
              sendJson(res, 200, { ok: true })
            } catch {
              sendJson(res, 500, { ok: false, reason: 'merge-failed' })
            }
            return
          }
          const itemId = String(body.itemId ?? '')
          if (frozenSessions.get(sessionId)?.has(itemId)) {
            sendJson(res, 409, { ok: false, reason: 'message-frozen' })
            return
          }
          const target = current.find((message) => String(message.id) === itemId)
          if (target === undefined) {
            sendJson(res, 409, { ok: false, reason: 'queue-changed' })
            return
          }
          if (ctx.attachments === undefined) {
            sendJson(res, 500, { ok: false, reason: 'attachments-unavailable' })
            return
          }
          try {
            const blocks = attachmentBlocks(body.blocks)
            const files = Array.isArray(body.files) ? body.files : []
            for (const file of files) blocks.push(await saveUpload(ctx.attachments, file))
            const text = typeof body.text === 'string' ? body.text : ''
            const content = [...(text.trim() === '' ? [] : [{ type: 'text', text }]), ...blocks]
            if (content.length === 0) {
              sendJson(res, 400, { ok: false, reason: 'empty-content' })
              return
            }
            // Uploads yield to the agent loop. Re-read the live queue so an edit
            // cannot resurrect a claimed message or discard a concurrent enqueue.
            const live = [...agent.inbox.nextTurn]
            if (frozenSessions.get(sessionId)?.has(itemId)) {
              sendJson(res, 409, { ok: false, reason: 'message-frozen' })
              return
            }
            if (live.find((message) => String(message.id) === itemId) !== target) {
              sendJson(res, 409, { ok: false, reason: 'queue-changed' })
              return
            }
            const edited = { ...target, content }
            const next = live.map((message) => (String(message.id) === itemId ? edited : message))
            agent.inbox.splice('next-turn', 0, live.length, next)
            sendJson(res, 200, { ok: true })
          } catch {
            sendJson(res, 500, { ok: false, reason: 'edit-failed' })
          }
        },
      }),
    'queue-withdraw: update route',
  )

  ctx.effect(
    () =>
      registerQueueRoute(ctx, {
        kind: 'exact',
        path: FREEZE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, reason: 'method-not-allowed' })
            return
          }
          const body = await readJson(req)
          if (body === null || typeof body !== 'object') {
            sendJson(res, 400, { ok: false, reason: 'invalid-body' })
            return
          }
          const sessionId = body.sessionId
          const itemId = body.itemId
          if (
            typeof sessionId !== 'string' ||
            sessionId === '' ||
            typeof itemId !== 'string' ||
            itemId === ''
          ) {
            sendJson(res, 400, { ok: false, reason: 'invalid-request' })
            return
          }
          const agent = ctx.agents.get(sessionId)
          if (agent === undefined || agent?.inbox === undefined) {
            sendJson(res, 409, { ok: false, reason: 'agent-unavailable' })
            return
          }
          installClaimPatch(agent.inbox)
          const current = [...agent.inbox.nextTurn]
          const index = current.findIndex((message) => String(message.id) === itemId)
          if (index < 0) {
            sendJson(res, 409, { ok: false, reason: 'queue-changed' })
            return
          }
          // The message stays queued so every native control still works; only the
          // turn boundary is told to skip it.
          const held = frozenIdsOf(sessionId)
          const existed = held.has(itemId)
          held.add(itemId)
          if (!existed && !saveFrozen()) {
            held.delete(itemId)
            sendJson(res, 500, { ok: false, reason: 'persist-failed' })
            return
          }
          sendJson(res, 200, { ok: true, index })
        },
      }),
    'queue-withdraw: freeze route',
  )

  ctx.effect(
    () =>
      registerQueueRoute(ctx, {
        kind: 'exact',
        path: THAW_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, reason: 'method-not-allowed' })
            return
          }
          const body = await readJson(req)
          if (body === null || typeof body !== 'object') {
            sendJson(res, 400, { ok: false, reason: 'invalid-body' })
            return
          }
          const sessionId = body.sessionId
          const itemId = String(body.itemId ?? '')
          if (typeof sessionId !== 'string' || sessionId === '' || itemId === '') {
            sendJson(res, 400, { ok: false, reason: 'invalid-request' })
            return
          }
          const held = frozenSessions.get(sessionId)
          const existed = held?.delete(itemId) === true
          if (existed && !saveFrozen()) {
            held.add(itemId)
            sendJson(res, 500, { ok: false, reason: 'persist-failed' })
            return
          }
          if (held?.size === 0) frozenSessions.delete(sessionId)
          sendJson(res, 200, { ok: true })
        },
      }),
    'queue-withdraw: thaw route',
  )

  ctx.effect(
    () =>
      registerQueueRoute(ctx, {
        kind: 'exact',
        path: FROZEN_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, reason: 'method-not-allowed' })
            return
          }
          const body = await readJson(req)
          const sessionId = body !== null && typeof body === 'object' ? body.sessionId : undefined
          if (typeof sessionId !== 'string' || sessionId === '') {
            sendJson(res, 400, { ok: false, reason: 'invalid-request' })
            return
          }
          const agent = ctx.agents.get(sessionId)
          if (agent?.inbox !== undefined) installClaimPatch(agent.inbox)
          sendJson(res, 200, { ok: true, ids: [...frozenIdsOf(sessionId)] })
        },
      }),
    'queue-withdraw: frozen route',
  )
}

export const inject = [
  'connection',
  'webServer',
  'agents',
  'sessions',
  'attachments',
  'typert',
  'fs',
  'subprocess',
  'sandbox',
  'sandboxPolicy',
  'sessionQuery',
  'workingDirectory',
]
