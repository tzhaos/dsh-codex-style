/**
 * dsh-queue-withdraw 1.11.5 — merged feature of dsh-codex-style.
 *
 * Source: dsh-plugins/6cebd96 packages/dsh-queue-withdraw/client.js.
 * The factory wrapper is provided by scripts/build-client.mjs; the body still
 * returns { inject, apply } and is only built when the feature is enabled.
 */
__DSH_FEATURE('dsh-queue-withdraw', function (require, env) {
  const React = require('react')
  const { ImageLightbox } = require('@deepseek-ai/dsh-client-ui-primitives')
  const { useEffect, useMemo, useRef, useState } = React
  const h = React.createElement

  /** Locale namespace owned by this plugin. */
  const NS = 'queueWithdraw'

  const zh = {
    'button.attachments': '这条消息包含暂不支持的附件内容',
    'button.cacheMissing': '没有找到该文件附件的本地缓存，无法撤回',
    'remove.missing': '消息已离开队列，可能已开始发送。',
    'remove.unavailable': '会话尚未就绪，暂时无法删除。',
    'remove.writer': '删除失败：会话正由其他 DSH 实例占用。',
    'remove.ownership': '删除失败：会话当前无法修改队列。{detail}',
    'remove.failed': '删除失败：{detail}',
    'remove.unknown': '删除结果尚未确认，消息仍在队列时可重试。{detail}',
    'preview.title': '预览附件',
    'preview.close': '关闭',
    'reorder.tooltip': '拖动排序排队消息',
    'reorder.failed': '排序失败，队列可能已变化',
    'merge.failed': '合并失败，队列可能已变化',
    'button.empty': '这条排队消息没有可撤回的文本',
    'button.failed': '撤回失败，消息仍在队列中',
    'draftReplace.message': '输入框已有内容，撤回这条排队消息会替换现有草稿。继续？',
    'withdraw.unknown': '撤回结果尚未确认，内容已保留在输入框。请检查队列后再发送。',
    'freeze.tooltip': '锁定，本轮结束不发送',
    'freeze.failed': '锁定失败，队列可能已变化',
    'frozen.activate': '解锁',
    'frozen.thawFailed': '解锁失败，队列可能已变化',
  }

  const en = {
    'button.attachments': 'This message contains attachment content that cannot be withdrawn',
    'button.cacheMissing':
      'No local cache was found for this file attachment; it cannot be withdrawn',
    'remove.missing': 'The message has left the queue and may have started sending.',
    'remove.unavailable': 'The session is not ready to remove messages.',
    'remove.writer': 'Could not remove: another DSH instance owns this session.',
    'remove.ownership': 'This session cannot currently modify its queue. {detail}',
    'remove.failed': 'Could not remove: {detail}',
    'remove.unknown': 'Removal is unconfirmed. Retry if the message remains queued. {detail}',
    'preview.title': 'Preview attachment',
    'preview.close': 'Close',
    'reorder.tooltip': 'Drag to reorder queued messages',
    'reorder.failed': 'Reorder failed; the queue may have changed',
    'merge.failed': 'Merge failed; the queue may have changed',
    'button.empty': 'This queued message has no text to withdraw',
    'button.failed': 'Withdraw failed; the message is still queued',
    'draftReplace.message':
      'The composer already has content. Withdrawing this queued message replaces it. Continue?',
    'withdraw.unknown': 'Withdrawal is unconfirmed. Content is kept in the composer; check the queue before sending.',
    'freeze.tooltip': 'Lock: do not send it when the turn ends',
    'freeze.failed': 'Lock failed; the queue may have changed',
    'frozen.activate': 'Unlock',
    'frozen.thawFailed': 'Unlock failed; the queue may have changed',
  }

  /**
   * Row icons use the Host icon language: the same 16-unit grid, regular
   * one-pixel stroke and currentColor paths as the primitive icon set. The
   * leading message icon renders at 16px inside a 28px button; the lock swap
   * keeps the native optical weight.
   */
  const ICON_SVG_ATTRS = 'viewBox="0 0 16 16" fill="none" stroke-width="1" aria-hidden="true"'
  /**
   * Closed lock: the shackle meets the body's top edge. The body spans 11 of
   * the 16 grid units, close to the 12.6-unit reach of the native edit icon, so
   * the glyph keeps the same optical size as its neighbours.
   */
  const LOCK_ICON =
    '<svg ' +
    ICON_SVG_ATTRS +
    '><path d="M5 6.25H11C12.1 6.25 13 7.15 13 8.25V12C13 13.1 12.1 14 11 14H5C3.9 14 3 13.1 3 12V8.25C3 7.15 3.9 6.25 5 6.25Z" stroke="currentColor"/><path d="M5.5 6.25V4.25A2.5 2.5 0 0 1 10.5 4.25V6.25" stroke="currentColor"/></svg>'

  /**
   * The leading glyph is the Host's own message icon (IconQueueOutlineRegular,
   * the artwork the native queue dock uses for its single-row lead). It is the
   * idle face of the lock toggle: the same button shows the closed lock while
   * the message is held, so the icon stays useful instead of pure decoration.
   */
  const QUEUE_GLYPH =
    '<svg class="dshqw-queueGlyph" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke-width="1" aria-hidden="true"><path d="M5 6.75H11" stroke="currentColor"/><path d="M5 9H8" stroke="currentColor"/><path d="M2.37067 11.2497C1.5872 9.89252 1.32042 8.29798 1.61945 6.7597C1.91847 5.22141 2.76317 3.84293 3.99801 2.87809C5.23285 1.91325 6.7747 1.427 8.33964 1.50888C9.90458 1.59076 11.3873 2.23526 12.5147 3.32369C13.6422 4.41232 14.3384 5.8717 14.4751 7.43304C14.6118 8.99438 14.1797 10.5525 13.2585 11.8205C12.3372 13.0885 10.9889 13.9809 9.4617 14.3334C8.18666 14.6277 6.8587 14.529 5.64964 14.0601C5.17095 13.8745 4.76937 13.4929 4.26509 13.3963C3.67389 13.2832 2.95232 13.5595 2.0377 14.3334" stroke="currentColor"/></svg>'
  const HANDLE_ICON =
    '<svg class="dshqw-grip" viewBox="0 0 8 16" width="8" height="16" fill="currentColor" aria-hidden="true"><circle cx="2" cy="4" r=".8"/><circle cx="6" cy="4" r=".8"/><circle cx="2" cy="8" r=".8"/><circle cx="6" cy="8" r=".8"/><circle cx="2" cy="12" r=".8"/><circle cx="6" cy="12" r=".8"/></svg>'

  const REORDER_PATH = '/dsh-queue-withdraw/reorder'
  const UPDATE_PATH = '/dsh-queue-withdraw/update'
  const FREEZE_PATH = '/dsh-queue-withdraw/freeze'
  const THAW_PATH = '/dsh-queue-withdraw/thaw'
  const FROZEN_PATH = '/dsh-queue-withdraw/frozen'
  const EMPTY_QUEUE = []

  /** Match the native dock's durable rows, excluding echoes placed in the transcript. */
  function visibleQueue(queue, submissions) {
    const inChat = new Set(
      submissions.filter((item) => item.placement === 'transcript').map((item) => item.requestId),
    )
    return queue.filter(
      (item) =>
        item.source?.kind !== 'user' || !('rpcId' in item.source) || !inChat.has(item.source.rpcId),
    )
  }

  /** One removal owner per retained Session; durable inbox updates settle acknowledgements. */
  function createRemovalController(ports) {
    let operation = null,
      timer = null,
      disposed = false
    const listeners = new Set()
    const publish = () => {
      if (!disposed) for (const listener of [...listeners]) listener()
    }
    const contains = (state, id) =>
      ['next-turn', 'next-step'].some((target) =>
        state.inbox?.[target]?.some((item) => item.id === id),
      )
    const forget = () => {
      if (timer !== null) (ports.clearTimeout ?? clearTimeout)(timer)
      timer = null
      operation = null
    }
    const reconcile = () => {
      if (!operation) return
      const state = ports.read()
      if (
        !state.current ||
        (state.ready && state.inbox && !contains(state, operation.id)) ||
        (state.ready && state.connected && state.generation !== operation.generation)
      )
        forget()
    }
    return {
      snapshot() {
        reconcile()
        return operation
      },
      busy() {
        reconcile()
        return operation !== null && operation.phase !== 'uncertain'
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      changed() {
        const before = operation
        reconcile()
        if (before !== operation) publish()
      },
      async remove(id) {
        reconcile()
        const state = ports.read()
        if (disposed || (operation && operation.phase !== 'uncertain')) return false
        if (!state.current || !state.ready || !state.connected) {
          ports.notice('error', 'remove.unavailable')
          return false
        }
        if (!contains(state, id)) {
          ports.notice('info', 'remove.missing')
          return false
        }
        // Removal addresses one immutable occurrence ID. After an unknown result,
        // a manual retry rechecks that same live ID; no retry runs automatically.
        if (operation) forget()
        const request = { id, generation: state.generation, phase: 'pending' }
        operation = request
        const current = () => !disposed && ports.read().current && operation === request
        const uncertain = (detail = '') => {
          if (!current() || request.phase === 'uncertain') return
          request.phase = 'uncertain'
          ports.notice('info', 'remove.unknown', detail)
          publish()
        }
        timer = (ports.setTimeout ?? setTimeout)(() => uncertain(), 30000)
        publish()
        try {
          reconcile()
          if (!current()) return false
          const live = ports.read()
          if (!live.ready || !live.connected) {
            forget()
            publish()
            return false
          }
          // Keep the Session receiver: updateQueue reads this.remote and this.sessionId.
          const result = await ports.remove(id)
          reconcile()
          if (!current()) {
            const latest = ports.read()
            return (
              latest.current &&
              latest.ready &&
              !contains(latest, id) &&
              result?.ok === true &&
              result.value?.accepted === true
            )
          }
          if (result?.ok === true && result.value?.accepted === true) {
            request.phase = 'accepted'
            publish()
            return true
          }
          const code = result?.error?.code
          const detail = [code, result?.error?.message].filter(Boolean).join(': ')
          if (
            !code ||
            /^gateway\/(?:internal|cancelled|timeout|disconnected|unavailable)$/.test(code)
          ) {
            uncertain(detail)
            return false
          }
          forget()
          ports.notice(
            code === 'session/queue-item-not-found' ? 'info' : 'error',
            code === 'session/queue-item-not-found'
              ? 'remove.missing'
              : code === 'session/writer-held'
                ? 'remove.writer'
                : code === 'session/agent-busy'
                  ? 'remove.ownership'
                  : 'remove.failed',
            detail,
          )
          publish()
          return false
        } catch (error) {
          reconcile()
          uncertain(error?.message ?? String(error))
          return false
        }
      },
      dispose() {
        disposed = true
        forget()
        listeners.clear()
      },
    }
  }

  /**
   * Held ids last reported by the Host, per conversation. The Host owns the
   * authoritative set (it enforces the skip at claim time); this cache only
   * drives the row styling and the freeze/unfreeze button state.
   */
  const frozenIdsBySession = new Map()

  /**
   * @param {string} sessionId - conversation id.
   * @returns {Set<string>} held ids for that conversation.
   */
  function frozenIdsOf(sessionId) {
    let ids = frozenIdsBySession.get(sessionId)
    if (ids === undefined) {
      ids = new Set()
      frozenIdsBySession.set(sessionId, ids)
    }
    return ids
  }

  /** Short-lived browser cache of files selected before a queue submission. */
  const CACHE_DB = 'dsh-queue-withdraw'
  const CACHE_STORE = 'files'
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000
  const memoryCache = []
  /** Draft attachment id to selected browser File, for session-switch restoration. */
  const draftFiles = new Map()
  /** Files attached to a composer when its session was unmounted. */
  const pendingDraftFiles = new Map()
  /** Last attachment ids observed in each session's composer. */
  const trackedDraftAttachments = new Map()
  const hookDisposers = new Set()
  const observedShells = new WeakSet()
  const shellTrackers = new WeakMap()
  let cacheDbPromise

  /** @returns {Promise<IDBDatabase|null>} cache database, or null when unavailable. */
  function openCacheDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null)
    if (cacheDbPromise !== undefined) return cacheDbPromise
    cacheDbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(CACHE_DB, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(CACHE_STORE))
            db.createObjectStore(CACHE_STORE, { keyPath: 'id' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    return cacheDbPromise
  }

  /** @param {File} file @param {string} sessionId @returns {object} cache record. */
  function referenceKey(value) {
    if (Array.isArray(value)) return '[' + value.map(referenceKey).join(',') + ']'
    if (value !== null && typeof value === 'object')
      return (
        '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + referenceKey(value[key]))
          .join(',') +
        '}'
      )
    return JSON.stringify(value)
  }

  function cacheRecord(file, sessionId, ref) {
    return {
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : String(Date.now()) + '-' + Math.random(),
      sessionId,
      name: typeof file.name === 'string' ? file.name : '',
      size: typeof file.size === 'number' ? file.size : 0,
      type: typeof file.type === 'string' ? file.type : '',
      lastModified: typeof file.lastModified === 'number' ? file.lastModified : 0,
      file,
      cachedAt: Date.now(),
      referenceKey: ref === undefined ? undefined : referenceKey(ref),
    }
  }

  /**
   * Remember selected files before the Host uploads them. Memory is written
   * synchronously; IndexedDB persistence is best-effort.
   * @param {string} sessionId - target conversation.
   * @param {File[]} files - browser-selected files.
   */
  function rememberFiles(sessionId, files, ref) {
    if (!Array.isArray(files) || files.length === 0) return
    const cutoff = Date.now() - CACHE_TTL_MS
    for (let index = memoryCache.length - 1; index >= 0; index -= 1) {
      if (memoryCache[index].cachedAt < cutoff) memoryCache.splice(index, 1)
    }
    const records = files
      .filter(
        (file) =>
          !memoryCache.some(
            (record) =>
              record.sessionId === sessionId &&
              record.file === file &&
              record.referenceKey === referenceKey(ref),
          ),
      )
      .map((file) => cacheRecord(file, sessionId, ref))
    if (records.length === 0) return
    memoryCache.push(...records)
    void (async () => {
      const db = await openCacheDb()
      if (db === null) return
      try {
        const tx = db.transaction(CACHE_STORE, 'readwrite')
        const store = tx.objectStore(CACHE_STORE)
        const request = store.getAll()
        request.onsuccess = () => {
          for (const record of request.result ?? []) {
            if (record.cachedAt < cutoff) store.delete(record.id)
          }
        }
        for (const record of records) store.put(record)
      } catch {
        // The in-memory copy keeps this page functional.
      }
    })()
  }

  /**
   * Find the most recent cached file matching a queue attachment reference.
   * @param {string} sessionId - conversation id.
   * @param {string} name - original file name.
   * @param {number} size - file size.
   * @returns {Promise<object|null>} cache record.
   */
  async function findCachedFile(sessionId, name, size, ref) {
    const match = (record) =>
      record.sessionId === sessionId &&
      record.name === name &&
      record.size === size &&
      record.cachedAt >= Date.now() - CACHE_TTL_MS &&
      (record.referenceKey === undefined || record.referenceKey === referenceKey(ref))
    const memory = [...memoryCache].reverse().find(match)
    if (memory !== undefined) return memory
    const db = await openCacheDb()
    if (db === null) return null
    return await new Promise((resolve) => {
      try {
        const request = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).getAll()
        request.onsuccess = () => resolve((request.result ?? []).reverse().find(match) ?? null)
        request.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }

  /** @param {object[]} records - cached records to remove. */
  async function forgetCachedRecords(records) {
    for (const record of records) {
      const index = memoryCache.findIndex((candidate) => candidate.id === record.id)
      if (index >= 0) memoryCache.splice(index, 1)
    }
    const db = await openCacheDb()
    if (db === null) return
    try {
      const tx = db.transaction(CACHE_STORE, 'readwrite')
      for (const record of records) tx.objectStore(CACHE_STORE).delete(record.id)
    } catch {
      // TTL cleanup will collect an unremovable persistence copy.
    }
  }

  /**
   * Drop caches for file references that left the Host queue (sent or
   * removed). This implements the temporary-storage contract.
   * @param {string} sessionId - conversation id.
   * @param {Array<{name: string, size: number}>} refs - removed references.
   */
  async function forgetCachedRefs(sessionId, refs) {
    if (!Array.isArray(refs) || refs.length === 0) return
    const matches = memoryCache.filter(
      (record) =>
        record.sessionId === sessionId &&
        refs.some((ref) => record.name === ref.name && record.size === ref.size),
    )
    await forgetCachedRecords(matches)
    const db = await openCacheDb()
    if (db === null) return
    try {
      const request = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).getAll()
      request.onsuccess = () => {
        const persisted = (request.result ?? []).filter(
          (record) =>
            record.sessionId === sessionId &&
            refs.some((ref) => record.name === ref.name && record.size === ref.size),
        )
        void forgetCachedRecords(persisted)
      }
    } catch {
      // Best effort; stale records expire with the browser profile.
    }
  }

  /**
   * Wrap the conversation draft registry once so selected files are cached
   * before upload. This is the only point that has the browser File objects.
   * @param {object|undefined} conversation - conversation service.
   */
  /** Persist tracked ids for a session as pending files when it is left. */
  function saveTrackedDraftFiles(sessionId) {
    const ids = trackedDraftAttachments.get(sessionId) ?? []
    if (ids.length === 0) {
      pendingDraftFiles.delete(sessionId)
      return
    }
    const files = ids.map((id) => draftFiles.get(id)).filter((file) => file !== undefined)
    if (files.length === ids.length) pendingDraftFiles.set(sessionId, files)
  }

  /** @param {unknown} value @returns {string|undefined} session id. */
  function sessionIdOfValue(value) {
    if (typeof value === 'string') return value
    if (value !== null && typeof value === 'object') return value.key ?? value.sessionId
    return undefined
  }

  /** @param {unknown} content @returns {Array<{type: string, ref: object}>} attachment blocks. */
  function attachmentBlocksOf(content) {
    if (!Array.isArray(content)) return []
    const blocks = []
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue
      if (block.type !== 'image' && block.type !== 'file') continue
      if (block.attachment !== null && typeof block.attachment === 'object')
        blocks.push({ type: block.type, ref: block.attachment })
    }
    return blocks
  }

  /**
   * Join the text blocks of one queue message.
   * @param {unknown} content - queue message content blocks.
   * @returns {string} joined text.
   */
  function textOfContent(content) {
    if (!Array.isArray(content)) return ''
    let text = ''
    for (const block of content) {
      if (
        block !== null &&
        typeof block === 'object' &&
        block.type === 'text' &&
        typeof block.text === 'string'
      ) {
        text += block.text
      }
    }
    return text.trim()
  }

  /**
   * Classify one queue message for withdrawal. Images can be rehydrated
   * through the attachment read API; files and images both prefer the
   * temporary browser cache populated when they were selected.
   * @param {unknown} content - queue message content blocks.
   * @returns {{text: string, attachments: Array<object>, unsupported: boolean}} plan.
   */
  function withdrawPlan(content) {
    const text = textOfContent(content)
    const attachments = []
    let unsupported = false
    if (!Array.isArray(content)) return { text, attachments, unsupported: true }
    for (const block of content) {
      if (block === null || typeof block !== 'object') {
        unsupported = true
        continue
      }
      if (block.type === 'text') continue
      if (block.type === 'image' && typeof block.attachment?.attachmentId === 'string') {
        attachments.push({ type: 'image', ref: block.attachment })
        continue
      }
      if (
        block.type === 'file' &&
        typeof block.attachment?.name === 'string' &&
        typeof block.attachment?.bytes === 'number'
      ) {
        attachments.push({ type: 'file', ref: block.attachment })
        continue
      }
      unsupported = true
    }
    return { text, attachments, unsupported }
  }

  /**
   * File references still present in a queue window.
   * @param {object[]} queue - next-turn queue items.
   * @returns {Array<{name: string, size: number}>} file references.
   */
  function queuedFileRefs(queue) {
    const refs = []
    for (const item of Array.isArray(queue) ? queue : []) {
      for (const block of attachmentBlocksOf(item?.content)) {
        if (block.type !== 'file') continue
        refs.push({ name: String(block.ref.name ?? ''), size: Number(block.ref.bytes ?? 0) })
      }
    }
    return refs
  }

  /** @param {object} record @param {string} fallbackName @returns {File} restored browser file. */
  function fileFromCache(record, fallbackName) {
    if (record.file instanceof File) return record.file
    return new File([record.file], fallbackName, {
      type: typeof record.type === 'string' ? record.type : '',
      lastModified: typeof record.lastModified === 'number' ? record.lastModified : undefined,
    })
  }

  /**
   * Find the QueueDock roots owned by one conversation.
   * @param {string} sessionId - conversation id.
   * @returns {Element[]} queue dock roots.
   */
  function docksOf(sessionId) {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function')
      return []
    const all = [...document.querySelectorAll('[data-queue-dock]')]
    const docks = []
    const unowned = []
    for (const dock of all) {
      const owner = dock.closest?.('[data-conversation-session]')
      if (owner === null || owner === undefined) {
        unowned.push(dock)
        continue
      }
      if (owner.getAttribute?.('data-conversation-session') === sessionId) docks.push(dock)
    }
    // A single unscoped dock can only belong to this conversation. With more
    // than one, guessing risks decorating another Session's composer.
    return docks.length > 0 ? docks : all.length === 1 ? unowned : []
  }

  /**
   * The queue project's host rows, excluding local pending echoes.
   * @param {Element} dock - queue dock root.
   * @returns {Element[]} rows that correspond to host queue entries.
   */
  function hostRowsOf(dock) {
    if (typeof dock.querySelectorAll !== 'function') return []
    return [...dock.querySelectorAll('li')].filter(
      (row) => row.hasAttribute?.('data-submission-echo') !== true,
    )
  }

  /**
   * Find the Host edit control inside one queue row.
   * @param {Element} row - host queue row.
   * @returns {Element|null} the edit button, when present.
   */
  function hostEditButtonOf(row) {
    if (typeof row.querySelectorAll !== 'function') return null
    for (const candidate of row.querySelectorAll('button[aria-label]')) {
      const label = candidate.getAttribute?.('aria-label') ?? ''
      if (/编辑|Edit/i.test(label) && !/取消|Cancel/i.test(label)) return candidate
    }
    return null
  }

  /**
   * Put one action at the row's leading edge, before the queue icon and text.
   * @param {Element} row - host queue row.
   * @param {Element} button - injected action.
   */
  function placeButton(row, button) {
    if (typeof row.insertBefore === 'function') {
      row.insertBefore(button, row.firstChild ?? null)
      return
    }
    row.append?.(button)
  }

  /**
   * The global decoration layer. It reconciles one injected lock control and
   * re-purposes the Host edit control on each queue row.
   * @param {object} props - session id, standard hooks, injected actions and translator.
   * @returns {null} no React output.
   */
  function QueueWithdraw({ sessionId, useSession, useProjection, actions, t }) {
    const [preview, setPreview] = useState(null)
    const inbox = useProjection('inbox')
    const queue = useMemo(
      () => (Array.isArray(inbox?.['next-turn']) ? inbox['next-turn'] : []),
      [inbox],
    )
    const submissions = useSession((state) => state.pendingSubmissions ?? EMPTY_QUEUE)
    const visible = useMemo(() => visibleQueue(queue, submissions), [queue, submissions])
    const queueMutable = useSession(
      (snapshot) =>
        snapshot.subagent === null || snapshot.subagent?.address?.mode === 'continuable',
    )
    const queueRef = useRef(visible)
    const mutableRef = useRef(queueMutable)
    const actionsRef = useRef(actions)
    const tRef = useRef(t)
    queueRef.current = visible
    mutableRef.current = queueMutable
    actionsRef.current = actions
    tRef.current = t
    const previousFileRefsRef = useRef([])
    const refreshFrozenRef = useRef(async () => {})
    useEffect(() => {
      const current = queuedFileRefs(queue)
      const removed = previousFileRefsRef.current.filter(
        (old) => !current.some((ref) => ref.name === old.name && ref.size === old.size),
      )
      if (removed.length > 0) void actionsRef.current.forgetCached?.(removed)
      previousFileRefsRef.current = current
    }, [queue])

    useEffect(
      () => () => {
        actionsRef.current.saveDraftAttachments?.()
      },
      [],
    )

    useEffect(() => {
      const timer = setTimeout(() => {
        void actionsRef.current.restoreDraftAttachments?.()
      }, 0)
      return () => clearTimeout(timer)
    }, [])

    useEffect(() => {
      if (typeof document === 'undefined' || typeof MutationObserver !== 'function')
        return undefined
      const editRestores = new Map()
      const editIntercepted = new WeakSet()
      const previewOriginal = new Map()
      const rowItems = new WeakMap()
      const removeButtons = new Set()
      const busyDisabled = new Set()
      const expandingHeaders = new WeakSet()
      const decoratedDocks = new Set()
      const listeners = new Map()
      let cancelDrag = () => {}
      const listen = (node, type, handler, capture = false) => {
        node.addEventListener(type, handler, capture)
        if (!listeners.has(node)) listeners.set(node, [])
        listeners.get(node).push(() => node.removeEventListener?.(type, handler, capture))
      }
      let frame = null
      let disposed = false
      const cancelFrame = () => {
        if (frame === null) return
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        else clearTimeout(frame)
        frame = null
      }
      const schedule = () => {
        if (disposed || frame !== null) return
        if (typeof requestAnimationFrame === 'function') {
          frame = requestAnimationFrame(() => {
            frame = null
            sync()
          })
        } else {
          frame = setTimeout(() => {
            frame = null
            sync()
          }, 0)
        }
      }
      /**
       * One withdrawal at a time. The composer draft is replaced wholesale, so
       * two concurrent withdrawals would drop one message's text: a second
       * click (or drop) is ignored until the first Host round-trip settles.
       */
      let withdrawing = false

      /**
       * Withdraw one queue item back into the composer. Returns whether the
       * Host accepted the removal.
       * @param {Element|null} button - triggering control, disabled while busy.
       * @param {object} item - queue item with id and content.
       * @returns {Promise<boolean>} whether the item left the queue.
       */
      const withdrawItem = async (button, item) => {
        if (withdrawing) return false
        withdrawing = true
        if (button !== null && button !== undefined) button.disabled = true
        try {
          const accepted = await actionsRef.current.withdraw(
            item,
            tRef.current('button.empty'),
            tRef.current('button.failed'),
            tRef.current('button.attachments'),
            tRef.current('button.cacheMissing'),
          )
          if (accepted !== true) return false
          // A withdrawn message leaves the queue, so its lock must go too.
          const id = String(item.id)
          if (frozenIdsOf(sessionId).has(id)) {
            await actionsRef.current.thaw(id, tRef.current('frozen.thawFailed'))
            await refreshFrozenRef.current()
          }
          return true
        } finally {
          withdrawing = false
          sync()
        }
      }

      /** Withdraw from the re-purposed Host edit control. */
      const withdrawThrough = async (button, item) => {
        if (button.disabled) return
        await withdrawItem(button, item)
      }

      /**
       * Toggle one queue item's hold. The message stays queued either way; the
       * Host only skips it at the turn boundary while it is held.
       */
      const freezeThrough = async (button, item) => {
        if (button.disabled) return
        button.disabled = true
        const id = String(item.id)
        const held = frozenIdsOf(sessionId).has(id)
        const accepted = held
          ? await actionsRef.current.thaw(id, tRef.current('frozen.thawFailed'))
          : await actionsRef.current.freeze(id, tRef.current('freeze.failed'))
        if (accepted !== true) {
          button.disabled = false
          return
        }
        await refreshFrozenRef.current()
        button.disabled = false
      }

      /**
       * Open the Host's own image lightbox for one queue thumbnail. The queue
       * rows reuse the same primitive the composer and transcripts use, so the
       * preview surface stays native instead of a second custom modal.
       * @param {Element} image - queue row thumbnail.
       */
      const openPreview = (image) => {
        if (image === null || image === undefined) return
        const src = image.currentSrc || image.src || image.getAttribute?.('src') || ''
        if (typeof src !== 'string' || src === '') return
        const alt = image.getAttribute?.('alt') ?? ''
        setPreview({ src, alt: typeof alt === 'string' ? alt : '' })
      }

      /** Whether a pointer drag is currently moving a queue row. */
      let dragging = false

      /** @param {Element|null|undefined} target @returns {boolean} press lands on a control. */
      const onRowControl = (target) => {
        if (target === null || target === undefined || typeof target.closest !== 'function')
          return false
        return (
          target.closest(
            'button, a, input, textarea, select, label, [contenteditable="true"], [role="button"]',
          ) !== null
        )
      }

      /**
       * Start a pointer drag from anywhere on one queue row. A three-pixel
       * threshold separates a plain click from a reorder, so the row's own
       * buttons, previews and text selection keep working.
       * @param {Element} row - host queue row.
       * @param {object} event - pointerdown event.
       */
      function beginRowDrag(row, event, fromHandle = false) {
        if (event.button !== 0) return
        if (!fromHandle && onRowControl(event.target)) return
        cancelDrag()
        if (typeof row.getBoundingClientRect !== 'function') return
        const current = rowItems.get(row)
        if (current === undefined) return
        const dock = row.closest?.('[data-queue-dock]') ?? row.parentElement
        if (dock === null || dock === undefined) return
        const initial = hostRowsOf(dock)
          .map((entry) => rowItems.get(entry)?.id)
          .filter((id) => id !== undefined)
          .map(String)
        const startX = event.clientX
        const startY = event.clientY
        const rowRect = row.getBoundingClientRect()
        const offsetX = event.clientX - rowRect.left
        const offsetY = event.clientY - rowRect.top
        let ghost = null
        let started = false
        let mergeTarget = null
        let composerTarget = null
        let reorderTarget = null
        let pendingOrder = initial
        const clearDropHint = () => {
          if (mergeTarget !== null) mergeTarget.classList.remove('dshqw-merge-target')
          if (composerTarget !== null) composerTarget.classList.remove('dshqw-drop-composer')
          mergeTarget = null
          composerTarget = null
          reorderTarget?.classList.remove('dshqw-drop-before', 'dshqw-drop-after')
          reorderTarget = null
          pendingOrder = initial
        }
        const moveGhost = (pointerEvent) => {
          if (ghost === null) return
          ghost.style.left = pointerEvent.clientX - offsetX + 'px'
          ghost.style.top = pointerEvent.clientY - offsetY + 'px'
        }
        const begin = (pointerEvent) => {
          started = true
          dragging = true
          const rect = row.getBoundingClientRect()
          ghost = row.cloneNode(true)
          ghost.classList.add('dshqw-drag-ghost')
          ghost.setAttribute('aria-hidden', 'true')
          ghost.inert = true
          ghost.style.width = rect.width + 'px'
          ghost.style.height = rect.height + 'px'
          ghost.style.left = rect.left + 'px'
          ghost.style.top = rect.top + 'px'
          row.classList.add('dshqw-drag-source')
          document.body.appendChild(ghost)
          moveGhost(pointerEvent)
        }
        const move = (pointerEvent) => {
          if (!started) {
            if (Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY) < 3) return
            begin(pointerEvent)
          }
          pointerEvent.preventDefault?.()
          moveGhost(pointerEvent)
          clearDropHint()
          const hit = document.elementFromPoint?.(pointerEvent.clientX, pointerEvent.clientY)
          const composer = hit?.closest?.('[data-composer-card]')
          if (
            composer !== null &&
            composer !== undefined &&
            composer
              .closest?.('[data-conversation-session]')
              ?.getAttribute('data-conversation-session') === sessionId
          ) {
            if (composerTarget !== composer) {
              if (composerTarget !== null) composerTarget.classList.remove('dshqw-drop-composer')
              composerTarget = composer
              composer.classList.add('dshqw-drop-composer')
            }
            if (mergeTarget !== null) mergeTarget.classList.remove('dshqw-merge-target')
            mergeTarget = null
            return
          }
          if (composerTarget !== null) composerTarget.classList.remove('dshqw-drop-composer')
          composerTarget = null
          const target = hit?.closest?.('li')
          if (target === null || target === undefined || target === row) {
            if (mergeTarget !== null) mergeTarget.classList.remove('dshqw-merge-target')
            mergeTarget = null
            return
          }
          const rows = hostRowsOf(dock).filter((entry) => entry !== row)
          if (!rows.includes(target)) return
          const rect = target.getBoundingClientRect()
          if (pointerEvent.clientY > rect.bottom - 14 &&
              !frozenIdsOf(sessionId).has(String(current.id)) &&
              !frozenIdsOf(sessionId).has(String(rowItems.get(target)?.id))) {
            if (mergeTarget !== target) {
              if (mergeTarget !== null) mergeTarget.classList.remove('dshqw-merge-target')
              mergeTarget = target
              target.classList.add('dshqw-merge-target')
            }
            return
          }
          if (mergeTarget !== null) mergeTarget.classList.remove('dshqw-merge-target')
          mergeTarget = null
          const before = pointerEvent.clientY < rect.top + rect.height / 2
          // React owns the host rows. Show an insertion hint and submit an
          // order; physically moving its children corrupts later commits.
          reorderTarget = target
          target.classList.add(before ? 'dshqw-drop-before' : 'dshqw-drop-after')
          pendingOrder = initial.filter((id) => id !== String(current.id))
          const index = pendingOrder.indexOf(String(rowItems.get(target)?.id))
          pendingOrder.splice(index + (before ? 0 : 1), 0, String(current.id))
        }
        const finish = async (event) => {
          document.removeEventListener?.('pointermove', move, true)
          document.removeEventListener?.('pointerup', finish, true)
          document.removeEventListener?.('pointercancel', finish, true)
          ghost?.remove?.()
          row.classList.remove('dshqw-drag-source')
          dragging = false
          const mergeWith = mergeTarget
          const composerDrop = composerTarget
          const order = pendingOrder
          clearDropHint()
          cancelDrag = () => {}
          if (!started || disposed || event?.type === 'pointercancel') return
          if (mergeWith !== null) {
            const targetItem = rowItems.get(mergeWith)
            if (targetItem !== undefined && String(targetItem.id) !== String(current.id)) {
              await actionsRef.current.mergeInto(
                targetItem,
                current,
                tRef.current('merge.failed'),
              )
            }
            return
          }
          if (composerDrop !== null) {
            await withdrawItem(null, current)
            return
          }
          if (order.length !== initial.length || order.some((id, index) => id !== initial[index])) {
            await actionsRef.current.reorder(order, tRef.current('reorder.failed'))
          }
        }
        document.addEventListener?.('pointermove', move, true)
        document.addEventListener?.('pointerup', finish, true)
        document.addEventListener?.('pointercancel', finish, true)
        cancelDrag = () => {
          void finish({ type: 'pointercancel' })
        }
      }

      /**
       * Give each Host row its drag handle and the inline lock toggle. The lock
       * is a visible peer of the Host's own row actions; withdrawal itself is
       * re-purposed onto the Host edit control instead of a second button.
       * @param {Element} row - host queue row.
       * @param {object} item - queue item currently shown by the row.
       */
      const ensureRow = (row, item) => {
        if (typeof row.querySelector !== 'function') return
        rowItems.set(row, item)
        if (row.getAttribute?.('data-dshq-row') !== '') {
          row.setAttribute('data-dshq-row', '')
          listen(row, 'pointerdown', (event) => beginRowDrag(row, event))
        }
        let handle = row.querySelector('[data-dshq-handle]')
        if (!handle) {
          handle = document.createElement('button')
          handle.type = 'button'
          handle.className = 'dshqw-handle'
          handle.setAttribute('data-dshq-handle', '')
          handle.setAttribute('aria-label', tRef.current('reorder.tooltip'))
          handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown')
          handle.innerHTML = HANDLE_ICON
          listen(handle, 'pointerdown', (event) => {
            event.stopPropagation?.()
            beginRowDrag(row, event, true)
          })
          listen(handle, 'keydown', (event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault?.()
            const dock = row.closest('[data-queue-dock]')
            if (!dock) return
            const order = hostRowsOf(dock).map((entry) => String(rowItems.get(entry)?.id))
            const index = order.indexOf(String(rowItems.get(row)?.id))
            const target = index + (event.key === 'ArrowUp' ? -1 : 1)
            if (index < 0 || target < 0 || target >= order.length) return
            const previous = order[index]
            order[index] = order[target]
            order[target] = previous
            void actionsRef.current.reorder(order, tRef.current('reorder.failed'))
          })
          placeButton(row, handle)
        }
        let freeze = row.querySelector?.('[data-dshq-freeze]')
        if (freeze === null || freeze === undefined) {
          freeze = document.createElement('button')
          freeze.type = 'button'
          freeze.className = 'dshqw-lockToggle'
          freeze.setAttribute('data-dshq-freeze', '')
          freeze.setAttribute('aria-label', tRef.current('freeze.tooltip'))
          freeze.setAttribute('aria-pressed', 'false')
          freeze.innerHTML = QUEUE_GLYPH
          listen(freeze, 'click', (event) => {
            event.preventDefault?.()
            event.stopPropagation?.()
            const target = rowItems.get(row)
            if (target !== undefined) void freezeThrough(freeze, target)
          })
          // The leading message icon doubles as the lock toggle. It sits right
          // after the drag grip so dragging and locking stay separate gestures.
          const grip = row.querySelector?.('[data-dshq-handle]') ?? null
          if (grip !== null && grip !== undefined) row.insertBefore?.(freeze, grip.nextSibling ?? null)
          else row.insertBefore?.(freeze, row.firstChild ?? null)
        }
      }

      /**
       * The Host's remove control is the only native action this plugin
       * intercepts: it relays through the session-scoped removal controller so
       * ownership errors are reported once. Steer and the other Host controls
       * keep their native labels, icons, order and tooltips untouched.
       */
      const syncNativeActions = (row) => {
        const box = row.querySelector('[class*="actions"]')
        if (!box) return
        for (const button of box.querySelectorAll('button[aria-label]')) {
          const label = button.getAttribute('aria-label') ?? ''
          if (!/移除|删除|Remove|Delete/i.test(label)) continue
          if (removeButtons.has(button)) continue
          removeButtons.add(button)
          listen(
            button,
            'click',
            async (event) => {
              event.preventDefault?.()
              event.stopImmediatePropagation?.()
              const item = rowItems.get(row)
              if (button.disabled || !item) return
              const accepted = await actionsRef.current.removal?.remove(item.id)
              if (accepted && !disposed && frozenIdsOf(sessionId).has(String(item.id))) {
                await actionsRef.current.thaw(String(item.id), tRef.current('frozen.thawFailed'))
                await refreshFrozenRef.current()
              }
            },
            true,
          )
        }
      }

      /**
       * Re-purpose the Host edit control: it withdraws the message back into
       * the composer, where it can be edited and sent again. The Host's inline
       * editor is never opened, so the row keeps only one "编辑" action and no
       * in-place edit state. Content that cannot be rehydrated stays disabled.
       */
      const syncNativeEdit = (row, item) => {
        if (typeof row.querySelectorAll !== 'function') return
        const edit = hostEditButtonOf(row)
        if (edit === null) return
        const plan = withdrawPlan(item?.content)
        const blocked = plan.unsupported || (plan.text === '' && plan.attachments.length === 0)
        if (!editRestores.has(edit)) {
          editRestores.set(edit, {
            disabled: edit.disabled,
            title: edit.getAttribute?.('title') ?? null,
          })
        }
        const disabled = blocked || withdrawing || !!actionsRef.current.removal?.busy()
        if (edit.disabled !== disabled) edit.disabled = disabled
        // The custom hover layer owns every tooltip. Strip the Host's native
        // `title` (its refusal text) so no browser tooltip leaks through; the
        // unsupported hint travels as an assistive description instead.
        if (edit.hasAttribute?.('title')) edit.removeAttribute?.('title')
        if (blocked) {
          const hint = tRef.current('button.attachments')
          if (edit.getAttribute?.('aria-description') !== hint)
            edit.setAttribute?.('aria-description', hint)
        } else if (edit.hasAttribute?.('aria-description')) {
          edit.removeAttribute?.('aria-description')
        }
        edit.setAttribute?.('data-dshq-edit', '')
        if (editIntercepted.has(edit)) return
        editIntercepted.add(edit)
        listen(
          edit,
          'click',
          (event) => {
            if (withdrawing) {
              event.preventDefault?.()
              event.stopImmediatePropagation?.()
              event.stopPropagation?.()
              return
            }
            if (edit.disabled) return
            const current = rowItems.get(row)
            if (current === undefined) return
            event.preventDefault?.()
            event.stopImmediatePropagation?.()
            event.stopPropagation?.()
            void withdrawThrough(edit, current)
          },
          true,
        )
      }
      /** Make host queue image thumbnails clickable. */
      const syncPreviews = (row) => {
        if (typeof row.querySelectorAll !== 'function') return
        for (const image of row.querySelectorAll('img')) {
          if (image.hasAttribute?.('data-dshq-preview') === true) continue
          image.setAttribute('data-dshq-preview', '')
          previewOriginal.set(image, image.style.cursor)
          image.style.cursor = 'zoom-in'
          listen(
            image,
            'click',
            (event) => {
              event.preventDefault?.()
              event.stopPropagation?.()
              openPreview(image)
            },
            true,
          )
        }
      }

      /**
       * Reflect the Host's held set on one live queue row: struck-through
       * text and the closed lock in both the handle and the row action. The
       * message stays queued; only the claim skips it at the turn boundary.
       * Editing (now withdrawal) stays available because withdrawing a held
       * message releases its hold.
       */
      const decorateFrozenRow = (row, item) => {
        const frozen = frozenIdsOf(sessionId).has(String(item.id))
        if (row.classList?.contains?.('dshqw-locked-row') !== frozen) {
          row.classList?.toggle?.('dshqw-locked-row', frozen)
        }
        const button = row.querySelector?.('[data-dshq-freeze]')
        if (button !== null && button !== undefined) {
          if (button.classList?.contains?.('dshqw-freeze-on') !== frozen) {
            button.classList?.toggle?.('dshqw-freeze-on', frozen)
          }
          const icon = frozen ? LOCK_ICON : QUEUE_GLYPH
          if (button.getAttribute?.('data-locked') !== String(frozen)) {
            button.setAttribute?.('data-locked', String(frozen))
            button.innerHTML = icon
          }
          const label = frozen ? tRef.current('frozen.activate') : tRef.current('freeze.tooltip')
          // The custom hover layer owns the tooltip; never write the native
          // `title` attribute (it would surface a browser tooltip on top).
          if (button.getAttribute?.('aria-label') !== label)
            button.setAttribute?.('aria-label', label)
          const pressed = frozen ? 'true' : 'false'
          if (button.getAttribute?.('aria-pressed') !== pressed)
            button.setAttribute?.('aria-pressed', pressed)
        }
      }

      const sync = () => {
        if (disposed || dragging) return
        for (const [node, off] of listeners) {
          if (node.isConnected !== false) continue
          for (const dispose of off) dispose()
          listeners.delete(node)
          removeButtons.delete(node)
          editRestores.delete(node)
          previewOriginal.delete(node)
        }
        const queueNow = mutableRef.current === true ? queueRef.current : []
        // Any in-flight queue mutation owns the row controls: a withdrawal or
        // removal must not race another row action (the composer draft is a
        // single, wholesale-replaced slot).
        const busy = withdrawing || !!actionsRef.current.removal?.busy()
        if (!busy) {
          for (const button of busyDisabled)
            if (button.isConnected !== false) button.disabled = false
          busyDisabled.clear()
        }
        for (const dock of docksOf(sessionId)) {
          const header = dock.querySelector?.('.v1kfCW_header[aria-controls][aria-expanded]')
          // The dock is presented as one flat, always-expanded list: the Host's
          // collapse affordance is disabled instead of mirrored. A collapsed
          // Host dock is expanded in place, and the flat stylesheet keeps the
          // list visible even while React re-renders a collapsed state.
          if (
            header?.getAttribute('aria-expanded') === 'false' &&
            !header.disabled &&
            !expandingHeaders.has(header)
          ) {
            expandingHeaders.add(header)
            header.click()
          }
          if (!header || header.getAttribute('aria-expanded') === 'true') {
            if (header) expandingHeaders.delete(header)
            if (!dock.hasAttribute('data-dshq-flat')) dock.setAttribute('data-dshq-flat', '')
            // The Host renders `hidden` on a collapsed list; the flat dock never
            // collapses, so drop it for both layout and assistive technology.
            const list = dock.querySelector?.('.v1kfCW_list')
            if (list?.hasAttribute?.('hidden') === true) list.removeAttribute?.('hidden')
            decoratedDocks.add(dock)
          }
          const rows = hostRowsOf(dock)
          for (let index = 0; index < rows.length; index += 1) {
            const item = queueNow[index]
            if (item === undefined) continue
            const row = rows[index]
            ensureRow(row, item)
            syncNativeEdit(row, item)
            syncPreviews(row)
            decorateFrozenRow(row, item)
            syncNativeActions(row)
            if (busy)
              for (const button of row.querySelectorAll('button')) {
                if (!button.disabled) {
                  busyDisabled.add(button)
                  button.disabled = true
                }
              }
          }
        }
        for (const dock of decoratedDocks)
          if (dock.isConnected === false) decoratedDocks.delete(dock)
      }

      refreshFrozenRef.current = async () => {
        const ids = await actionsRef.current.readFrozen?.(tRef.current('freeze.failed'))
        if (Array.isArray(ids)) {
          const set = frozenIdsOf(sessionId)
          set.clear()
          for (const id of ids) set.add(String(id))
        }
        sync()
      }

      /** Whether a DOM node is, contains, or sits inside a queue dock. */
      const touchedDock = (node) => {
        if (node === null || node === undefined || node.nodeType !== 1) return false
        if (node.matches?.('[data-queue-dock]') === true) return true
        if (
          node.closest?.('[data-queue-dock]') !== null &&
          node.closest?.('[data-queue-dock]') !== undefined
        )
          return true
        const inner = node.querySelector?.('[data-queue-dock]')
        return inner !== null && inner !== undefined
      }

      // Only dock traffic re-syncs. The sync runs in the observer callback
      // (a microtask right after React commits) rather than in a later
      // animation frame, so freshly rendered rows get their actions before
      // the browser paints and the dock does not flash or shift.
      const observer = new MutationObserver((mutations) => {
        if (disposed) return
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            if (touchedDock(mutation.target)) {
              sync()
              return
            }
            continue
          }
          if (mutation.target === document.body || touchedDock(mutation.target)) {
            sync()
            return
          }
          for (const node of mutation.addedNodes ?? []) {
            if (touchedDock(node)) {
              sync()
              return
            }
          }
          for (const node of mutation.removedNodes ?? []) {
            if (touchedDock(node)) {
              sync()
              return
            }
          }
        }
      })
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'hidden', 'aria-label'],
      })
      const offRemoval = actions.removal?.subscribe(sync)
      const offRemovalSources = (actions.removalSources ?? [])
        .map((source) =>
          source?.subscribe?.(() => {
            actions.removal?.changed()
            schedule()
          }),
        )
        .filter(Boolean)
      sync()
      void refreshFrozenRef.current()
      return () => {
        disposed = true
        observer.disconnect()
        offRemoval?.()
        for (const off of offRemovalSources) off()
        for (const button of busyDisabled)
          if (button.isConnected !== false) button.disabled = false
        busyDisabled.clear()
        removeButtons.clear()
        for (const dock of decoratedDocks) dock.removeAttribute('data-dshq-flat')
        decoratedDocks.clear()
        cancelFrame()
        cancelDrag()
        for (const off of listeners.values()) for (const dispose of off) dispose()
        listeners.clear()
        for (const dock of docksOf(sessionId)) {
          for (const row of hostRowsOf(dock)) {
            row.removeAttribute?.('data-dshq-row')
            row.classList?.remove?.('dshqw-locked-row')
          }
          for (const button of dock.querySelectorAll?.(
            '[data-dshq-freeze], [data-dshq-handle]',
          ) ?? [])
            button.remove?.()
        }
        for (const [edit, original] of editRestores) {
          if (edit.isConnected === false) continue
          if (edit.disabled !== original.disabled) edit.disabled = original.disabled
          if (original.title === null) edit.removeAttribute?.('title')
          else if (edit.getAttribute?.('title') !== original.title)
            edit.setAttribute?.('title', original.title)
          edit.removeAttribute?.('data-dshq-edit')
        }
        editRestores.clear()
        for (const [image, cursor] of previewOriginal) {
          image.removeAttribute?.('data-dshq-preview')
          image.style.cursor = cursor
        }
        previewOriginal.clear()
      }
    }, [sessionId, queueMutable])

    if (preview === null) return null
    return h(ImageLightbox, {
      src: preview.src,
      alt: preview.alt,
      labels: { dialog: t('preview.title'), close: t('preview.close') },
      onClose: () => setPreview(null),
    })
  }

  /** Presentation only; colors and elevation come from the Host theme. */
  const CSS = `
/* The leading message icon doubles as the lock toggle. It looks like the
   Host's icon buttons (28px circle, 16px icon, hover pill, focus ring) so the
   row keeps one leading control while dragging stays on the separate grip. */
.dshqw-lockToggle {
  box-sizing: border-box;
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  corner-shape: round;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshqw-lockToggle > svg { width: 16px; height: 16px; }
.dshqw-lockToggle:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshqw-lockToggle:disabled { cursor: default; opacity: .45; }
.dshqw-lockToggle:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
/* The queue is one flat, always-expanded list: the Host dock header (count and
   collapse chevron) is removed, and its collapsed list state is forced open so
   the row actions stay reachable even if React re-renders a collapsed list. */
[data-queue-dock][data-dshq-flat] .v1kfCW_header { display: none; }
[data-queue-dock][data-dshq-flat] .v1kfCW_list[hidden] { display: block; }
[data-queue-dock][data-dshq-flat] .v1kfCW_panel { padding: 2px 0; border-radius: 16px 16px 0 0; }
[data-queue-dock][data-dshq-flat] .v1kfCW_panel::before { background: var(--dsw-specific-input-major); backdrop-filter: none; }
[data-queue-dock][data-dshq-flat] .v1kfCW_list { max-height: 180px; }
[data-queue-dock][data-dshq-flat] .v1kfCW_row { border-radius: 0; box-shadow: none; }
.dshqw-handle {
  box-sizing: border-box;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  corner-shape: round;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
[data-queue-dock] [data-dshq-row] {
  min-height: 36px;
  gap: 8px;
  padding: 4px 8px;
}
[data-queue-dock] [data-dshq-row] [class*="actions"] { gap: 2px; }
[data-queue-dock] [data-dshq-row] [class*="preview"] { font-size: 14px; line-height: 22px; }
[data-queue-dock] [data-dshq-row] [class*="thumb"] { width: 28px; height: 28px; border-radius: 6px; }
.dshqw-handle { gap: 1px; cursor: grab; touch-action: none; }
.dshqw-handle > svg { flex: none; }
.dshqw-grip { opacity: 0; }
[data-dshq-row]:hover .dshqw-grip,
[data-dshq-row]:focus-within .dshqw-grip,
.dshqw-drag-source .dshqw-grip,
.dshqw-drag-ghost .dshqw-grip { opacity: 1; }
@media (hover: none) { .dshqw-grip { opacity: 1; } }
[data-queue-dock] [data-dshq-row].dshqw-drag-source,
.dshqw-drag-ghost,
.dshqw-drag-source .dshqw-handle {
  cursor: grabbing;
  user-select: none;
}
[data-queue-dock] .dshqw-handle:is(:hover,:active) { background: transparent; }
.dshqw-handle:disabled {
  cursor: default;
  opacity: .45;
}
.dshqw-handle:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshqw-drag-source {
  opacity: .28;
}
.dshqw-drag-ghost {
  position: fixed;
  z-index: 140;
  box-sizing: border-box;
  pointer-events: none;
  opacity: .72;
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  box-shadow: var(--dsw-elevation-soft);
  overflow: hidden;
}
.dshqw-drop-before { box-shadow: inset 0 2px 0 var(--dsw-alias-state-business-primary); }
.dshqw-drop-after { box-shadow: inset 0 -2px 0 var(--dsw-alias-state-business-primary); }
.dshqw-merge-target { outline: 2px dashed var(--dsw-alias-state-business-primary); outline-offset: -2px; border-radius: 8px; }
.dshqw-drop-composer { outline: 2px dashed var(--dsw-alias-state-business-primary) !important; outline-offset: 2px; }
.dshqw-freeze-on {
  opacity: 1;
  color: var(--dsw-alias-label-primary);
}
.dshqw-freeze-on > svg {
  color: var(--dsw-alias-state-business-primary);
}
[data-queue-dock] .dshqw-locked-row [class*="preview"] {
  text-decoration: line-through;
  opacity: .55;
}
/* Decorated rows use the combined queue-status and grip control. */
[data-queue-dock] [data-dshq-row] > [class*="lead"] {
  display: none;
}
[data-queue-dock] .dshqw-locked-row [class*="attachments"] {
  opacity: .55;
}
`

  /**
   * Register the queue-row decoration.
   * @param {object} ctx - Client root context.
   */
  function apply(ctx) {
    const removers = new WeakMap(),
      ownedRemovers = new Map()
    ctx.effect(() => {
      const prune = () => {
        for (const [controller, entry] of ownedRemovers)
          if (ctx.sessions.binding(entry.id) !== entry.binding) {
            controller.dispose()
            removers.delete(entry.binding)
            ownedRemovers.delete(controller)
          }
      }
      const off = ctx.sessions.list?.subscribe?.(prune)
      return () => {
        off?.()
        for (const controller of ownedRemovers.keys()) controller.dispose()
        ownedRemovers.clear()
      }
    }, 'queue-withdraw: removal owners')
    ctx.effect(
      () => () => {
        for (const dispose of hookDisposers) dispose()
        hookDisposers.clear()
        draftFiles.clear()
        pendingDraftFiles.clear()
        trackedDraftAttachments.clear()
        frozenIdsBySession.clear()
        memoryCache.length = 0
        if (cacheDbPromise !== undefined) void cacheDbPromise.then((db) => db?.close())
        cacheDbPromise = undefined
      },
      'queue-withdraw: owned hooks and caches',
    )
    ctx.effect(() => {
      const uiSession = typeof ctx.get === 'function' ? ctx.get('uiSession') : undefined
      const current = uiSession?.current
      if (current === undefined || typeof current.subscribe !== 'function') return () => {}
      let previous = sessionIdOfValue(current.value)
      const unsubscribe = current.subscribe(() => {
        const next = sessionIdOfValue(current.value)
        if (next === previous) return
        if (previous !== undefined) saveTrackedDraftFiles(previous)
        previous = next
      })
      return () => unsubscribe?.()
    }, 'queue-withdraw: draft attachment switch tracking')
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'queue-withdraw: dictionaries')
    ctx.effect(() => {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function')
        return () => {}
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-queue-withdraw'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => {
        style.remove?.()
      }
    }, 'queue-withdraw: styles')

    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'queue-withdraw',
          order: 21,
          locale: NS,
          inject: (sessionId) => {
            let conversation
            let shell
            try {
              const scope = ctx.sessions.scope(sessionId)
              conversation = scope?.get('conversation')
              shell = conversation?.input?.for?.(scope)
            } catch {
              conversation = undefined
              shell = undefined
            }
            const notify = (level, text) => {
              try {
                shell?.notify?.(level, text)
              } catch {
                // A disposed scope simply loses the non-critical notice.
              }
            }
            const binding = ctx.sessions.binding(sessionId)
            const session = binding?.session
            const removalInbox = session?.projections?.faceOf?.('inbox')
            const generation = ctx.connection?.generation
            let removal = binding && removers.get(binding)
            if (binding && !removal) {
              const translate = ctx.locale.bind(NS)
              removal = createRemovalController({
                read: () => {
                  const state = session?.getSnapshot?.()
                  return {
                    current: ctx.sessions.binding(sessionId) === binding,
                    ready:
                      state?.openState === 'open' &&
                      state.removed !== true &&
                      (state.subagent === null || state.subagent?.address?.mode === 'continuable'),
                    connected: generation?.getSnapshot() !== undefined,
                    generation: generation?.getSnapshot(),
                    inbox: removalInbox?.getSnapshot(),
                  }
                },
                remove: (id) => session.updateQueue(id, { kind: 'remove' }),
                notice: (level, key, detail = '') => {
                  if (ctx.sessions.binding(sessionId) === binding)
                    notify(level, translate(key, { detail }))
                },
              })
              removers.set(binding, removal)
              ownedRemovers.set(removal, { id: sessionId, binding })
            }
            const saveDraftAttachmentsNow = () => {
              try {
                const ids = shell?.snapshot?.attachmentIds
                if (Array.isArray(ids) && ids.length === 0 && tracker.preservePending) {
                  if (tracker.restoreRequested && !tracker.restoring) void restoreDraftAttachments()
                  return
                }
                if (Array.isArray(ids)) {
                  const live = new Set(ids)
                  const previous = trackedDraftAttachments.get(sessionId) ?? []
                  for (const id of previous) if (!live.has(id)) draftFiles.delete(id)
                  for (const draft of conversation?.resolveDraftAttachments?.(ids) ?? []) {
                    draftFiles.set(draft.id, draft.file)
                    const upload = conversation?.fileUploads?.getSnapshot?.()?.[draft.id]
                    if (draft.kind === 'file' && upload?.status === 'ready')
                      rememberFiles(sessionId, [draft.file], upload.file)
                  }
                  trackedDraftAttachments.set(sessionId, [...ids])
                }
              } catch {
                // ignored
              }
              saveTrackedDraftFiles(sessionId)
            }
            const tracker = shellTrackers.get(shell) ?? {
              preservePending:
                pendingDraftFiles.has(sessionId) &&
                (shell?.snapshot?.attachmentIds?.length ?? 0) === 0,
              restoreRequested: false,
              restoring: false,
            }
            if (shell !== undefined && shell !== null) shellTrackers.set(shell, tracker)
            async function restoreDraftAttachments() {
              tracker.restoreRequested = true
              if (tracker.restoring) return false
              const files = pendingDraftFiles.get(sessionId)
              if (files === undefined || files.length === 0) return false
              const snapshot = shell?.snapshot
              if (
                !Array.isArray(snapshot?.attachmentIds) ||
                ['adjudicating', 'submitting'].includes(snapshot.phase)
              )
                return false
              if (snapshot.attachmentIds.length > 0) {
                tracker.preservePending = false
                saveDraftAttachmentsNow()
                return true
              }
              if (
                typeof conversation?.createDrafts !== 'function' ||
                typeof shell?.actions?.addAttachments !== 'function'
              )
                return false
              let ids = []
              tracker.restoring = true
              try {
                ids = conversation
                  .createDrafts(sessionId, files)
                  .map((draft) => draft?.id)
                  .filter((id) => typeof id === 'string')
                if (ids.length !== files.length || shell.actions.addAttachments(ids) !== true)
                  throw new Error('attachment restore rejected')
                tracker.preservePending = false
                pendingDraftFiles.delete(sessionId)
                saveDraftAttachmentsNow()
                return true
              } catch {
                for (const id of ids) {
                  try {
                    conversation?.releaseDraftAttachment?.(id)
                  } catch {
                    /* disposed */
                  }
                  draftFiles.delete(id)
                }
                return false
              } finally {
                tracker.restoring = false
              }
            }
            // InputShell publishes attachment edits synchronously. Subscribe to
            // its public store instead of replacing receiver-sensitive methods.
            if (typeof shell?.state?.subscribe === 'function' && !observedShells.has(shell)) {
              observedShells.add(shell)
              saveDraftAttachmentsNow()
              const unsubscribe = shell.state.subscribe(saveDraftAttachmentsNow)
              const unsubscribeUploads =
                conversation?.fileUploads?.subscribe?.(saveDraftAttachmentsNow)
              hookDisposers.add(() => {
                unsubscribe()
                unsubscribeUploads?.()
                observedShells.delete(shell)
                shellTrackers.delete(shell)
              })
            }
            return {
              sessionId,
              actions: {
                removal,
                removalSources: [session, removalInbox, generation].filter(Boolean),
                /** Drop cache records for queue file references that left the queue. */
                forgetCached: (refs) => {
                  void forgetCachedRefs(sessionId, refs)
                },
                /** Remember the files currently attached to this composer before unmount. */
                saveDraftAttachments: saveDraftAttachmentsNow,
                /** Re-add files saved from this session's previous composer mount. */
                restoreDraftAttachments,
                /**
                 * Persist one complete next-turn order through the Host route.
                 * @param {string[]} order - every live queue id in the desired order.
                 * @param {string} failure - localized failure notice.
                 * @returns {Promise<boolean>} whether the Host applied the order.
                 */
                reorder: async (order, failure) => {
                  try {
                    const response = await fetch(REORDER_PATH, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ sessionId, order }),
                    })
                    const body = await response.json?.()
                    if (response.ok !== true || body?.ok !== true) {
                      notify('error', failure)
                      return false
                    }
                    return true
                  } catch {
                    notify('error', failure)
                    return false
                  }
                },
                /**
                 * Merge the dragged queue message into the receiving one and
                 * remove the source. The combined content is written through the
                 * edit route so every image/file attachment block survives the
                 * merge (the Host merge route only concatenates raw blocks and
                 * loses attachment previews for queued items).
                 * @param {object} target - receiving queue item.
                 * @param {object} source - dragged queue item.
                 * @param {string} failure - failure notice.
                 * @returns {Promise<boolean>} whether both steps were applied.
                 */
                mergeInto: async (target, source, failure) => {
                  const targetId = String(target?.id ?? '')
                  const sourceId = String(source?.id ?? '')
                  if (targetId === '' || sourceId === '' || targetId === sourceId) return false
                  const text = [textOfContent(target.content), textOfContent(source.content)]
                    .filter((value) => value !== '')
                    .join('\n')
                  const blocks = [...(target.content ?? []), ...(source.content ?? [])]
                    .filter(
                      (block) =>
                        block !== null &&
                        typeof block === 'object' &&
                        (block.type === 'image' || block.type === 'file') &&
                        block.attachment !== null &&
                        typeof block.attachment === 'object',
                    )
                    .map((block) => ({ type: block.type, attachment: block.attachment }))
                  try {
                    const response = await fetch(UPDATE_PATH, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        sessionId,
                        action: 'edit',
                        itemId: targetId,
                        text,
                        blocks,
                        files: [],
                      }),
                    })
                    const body = await response.json?.()
                    if (response.ok !== true || body?.ok !== true) {
                      notify('error', failure)
                      return false
                    }
                  } catch {
                    notify('error', failure)
                    return false
                  }
                  const binding = ctx.sessions.binding(sessionId)
                  const session = binding?.session
                  if (session === undefined || typeof session.updateQueue !== 'function') return false
                  try {
                    const removed = await session.updateQueue(sourceId, { kind: 'remove' })
                    if (removed?.ok !== true) {
                      notify('error', failure)
                      return false
                    }
                    return true
                  } catch {
                    notify('error', failure)
                    return false
                  }
                },
                /**
                 * Move one queued message into the draft and remove it from the
                 * Host queue. The draft is written before removal and restored if
                 * removal is rejected.
                 * @param {object} item - queue item with id and content.
                 * @param {string} empty - empty-content notice.
                 * @param {string} failure - failure notice.
                 * @param {string} attachment - attachment notice.
                 * @returns {Promise<boolean>} whether the item was withdrawn.
                 */
                withdraw: async (item, empty, failure, attachment, cacheMissing = attachment) => {
                  if (['adjudicating', 'submitting'].includes(shell?.snapshot?.phase)) {
                    notify('error', failure)
                    return false
                  }
                  const plan = withdrawPlan(item?.content)
                  if (plan.unsupported) {
                    notify('error', attachment)
                    return false
                  }
                  if (plan.text === '' && plan.attachments.length === 0) {
                    notify('error', empty)
                    return false
                  }
                  const binding = ctx.sessions.binding(sessionId)
                  const session = binding?.session
                  if (session === undefined || typeof session.updateQueue !== 'function') {
                    notify('error', failure)
                    return false
                  }
                  let previousDraft = ''
                  try {
                    // `snapshot.draft` is the published plain-text draft. The
                    // shell's structured `draftSnapshot` document is not text,
                    // so it must never be compared or re-published as a string.
                    const draft = shell?.snapshot?.draft
                    if (typeof draft === 'string') previousDraft = draft
                  } catch {
                    previousDraft = ''
                  }
                  let changedDraft = false
                  let replacementSnapshot
                  let attachmentsAdmitted = false
                  const addedIds = []
                  const previousIds = []
                  const removedIds = []
                  const originalText = shell?.snapshot?.draft ?? ''
                  const originalRevision = shell?.snapshot?.draftRev
                  try {
                    const ids = shell?.snapshot?.attachmentIds
                    if (Array.isArray(ids)) previousIds.push(...ids)
                  } catch {
                    /* no snapshot */
                  }
                  // Replacing a non-empty draft is destructive, so ask once. The
                  // prompt is browser-only: detached or headless shells keep the
                  // previous behaviour instead of blocking the withdrawal.
                  if (
                    (previousDraft.trim() !== '' || previousIds.length > 0) &&
                    typeof window !== 'undefined' &&
                    typeof window.confirm === 'function'
                  ) {
                    let replace = true
                    try {
                      replace = window.confirm(ctx.locale.bind(NS)('draftReplace.message')) === true
                    } catch {
                      replace = true
                    }
                    if (replace !== true) return false
                  }
                  const releaseAdded = () => {
                    for (const id of addedIds) {
                      try {
                        // Once admitted, an id may already belong to an in-flight
                        // send. Only the native shell may authorize its release.
                        if (attachmentsAdmitted && shell?.removeAttachment?.(id) !== true) continue
                        conversation?.releaseDraftAttachment?.(id)
                      } catch {
                        /* best-effort */
                      }
                    }
                  }
                  const rollback = () => {
                    releaseAdded()
                    const current = shell?.snapshot
                    if (
                      changedDraft &&
                      current?.draft === replacementSnapshot?.draft &&
                      current?.draftRev === replacementSnapshot?.draftRev &&
                      !['adjudicating', 'submitting'].includes(current?.phase)
                    ) {
                      try {
                        shell?.actions?.setDraft?.(previousDraft)
                      } catch {
                        /* best-effort restore */
                      }
                    }
                    try {
                      if (removedIds.length > 0) shell?.actions?.addAttachments?.(removedIds)
                    } catch {
                      /* best-effort restore */
                    }
                  }
                  const cachedRecords = []
                  if (plan.attachments.length > 0) {
                    try {
                      if (
                        typeof conversation?.createDrafts !== 'function' ||
                        typeof shell?.actions?.addAttachments !== 'function' ||
                        typeof File !== 'function'
                      )
                        return false
                      const files = []
                      for (const block of plan.attachments) {
                        const ref = block.ref
                        const name = typeof ref.name === 'string' ? ref.name : ''
                        const size = typeof ref.bytes === 'number' ? ref.bytes : 0
                        const cached =
                          name === '' ? null : await findCachedFile(sessionId, name, size, ref)
                        if (cached !== null) {
                          cachedRecords.push(cached)
                          files.push(fileFromCache(cached, name))
                          continue
                        }
                        if (
                          block.type !== 'image' ||
                          typeof session.readAttachment !== 'function'
                        ) {
                          notify('error', cacheMissing)
                          return false
                        }
                        const result = await session.readAttachment(ref.attachmentId)
                        if (result?.ok !== true) throw new Error('image read failed')
                        const mediaType = result.value?.attachment?.mediaType ?? ref.mediaType
                        if (typeof mediaType !== 'string' || !mediaType.startsWith('image/'))
                          throw new Error('not an image')
                        const fallbackName =
                          result.value?.attachment?.name ?? ref.name ?? 'withdrawn-image'
                        files.push(new File([result.value.data], fallbackName, { type: mediaType }))
                      }
                      const drafts = conversation.createDrafts(sessionId, files)
                      for (const draft of drafts) {
                        if (draft?.id !== undefined) addedIds.push(draft.id)
                      }
                      if (
                        addedIds.length !== files.length ||
                        shell.actions.addAttachments(addedIds) !== true
                      ) {
                        throw new Error('attachment draft rejected')
                      }
                      attachmentsAdmitted = true
                    } catch {
                      releaseAdded()
                      notify('error', failure)
                      return false
                    }
                  }
                  try {
                    // Prepare all files before changing the existing draft. A
                    // cache miss or a busy shell must leave its attachments intact.
                    const current = shell?.snapshot
                    const added = new Set(addedIds)
                    const liveIds = (current?.attachmentIds ?? []).filter((id) => !added.has(id))
                    if (
                      ['adjudicating', 'submitting'].includes(current?.phase) ||
                      current?.draft !== originalText ||
                      current?.draftRev !== originalRevision ||
                      liveIds.length !== previousIds.length ||
                      liveIds.some((id, index) => id !== previousIds[index])
                    ) {
                      throw new Error('draft changed')
                    }
                    for (const id of previousIds) {
                      if (shell?.removeAttachment?.(id) !== true) throw new Error('draft locked')
                      removedIds.push(id)
                    }
                    shell?.actions?.setDraft?.(plan.text)
                    changedDraft = true
                    replacementSnapshot = {
                      draft: shell?.snapshot?.draft,
                      draftRev: shell?.snapshot?.draftRev,
                    }
                  } catch {
                    rollback()
                    notify('error', failure)
                    return false
                  }
                  try {
                    const result = await session.updateQueue(item.id, { kind: 'remove' })
                    if (result?.ok !== true) {
                      const code = result?.error?.code
                      if (!code || /^gateway\/(?:internal|cancelled|timeout|disconnected|unavailable)$/.test(code)) {
                        for (const id of removedIds)
                          if (!shell?.snapshot?.attachmentIds?.includes(id)) conversation?.releaseDraftAttachment?.(id)
                        notify('info', ctx.locale.bind(NS)('withdraw.unknown'))
                        return false
                      }
                      rollback()
                      notify('error', failure)
                      return false
                    }
                    // The queue row disappearing and the draft appearing are the
                    // feedback; an info notice would linger in the Host's notice
                    // surface and is unnecessary for a successful withdraw.
                    for (const id of removedIds) conversation?.releaseDraftAttachment?.(id)
                    if (cachedRecords.length > 0) void forgetCachedRecords(cachedRecords).catch(() => {})
                    return true
                  } catch {
                    for (const id of removedIds) {
                      try {
                        if (!shell?.snapshot?.attachmentIds?.includes(id)) conversation?.releaseDraftAttachment?.(id)
                      } catch { /* the prepared draft remains authoritative */ }
                    }
                    notify('info', ctx.locale.bind(NS)('withdraw.unknown'))
                    return false
                  }
                },
                /**
                 * Ask the Host to skip one queued message at the turn boundary.
                 * @param {string} itemId - queue item id.
                 * @param {string} failure - failure notice.
                 * @returns {Promise<boolean>} whether the message is held.
                 */
                freeze: async (itemId, failure) => {
                  try {
                    const response = await fetch(FREEZE_PATH, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ sessionId, itemId }),
                    })
                    const body = await response.json?.()
                    if (response.ok !== true || body?.ok !== true) {
                      notify('error', failure)
                      return false
                    }
                    return true
                  } catch {
                    notify('error', failure)
                    return false
                  }
                },
                /**
                 * Release one held message so the next turn boundary sends it.
                 * @param {string} itemId - queue item id.
                 * @param {string} failure - failure notice.
                 * @returns {Promise<boolean>} whether the message is released.
                 */
                thaw: async (itemId, failure) => {
                  try {
                    const response = await fetch(THAW_PATH, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ sessionId, itemId }),
                    })
                    const body = await response.json?.()
                    if (response.ok !== true || body?.ok !== true) {
                      notify('error', failure)
                      return false
                    }
                    return true
                  } catch {
                    notify('error', failure)
                    return false
                  }
                },
                /**
                 * Read the Host's held ids for this conversation.
                 * @param {string} failure - failure notice.
                 * @returns {Promise<string[]|null>} held ids, or null on failure.
                 */
                readFrozen: async (failure) => {
                  try {
                    const response = await fetch(FROZEN_PATH, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ sessionId }),
                    })
                    const body = await response.json?.()
                    if (response.ok !== true || body?.ok !== true || !Array.isArray(body?.ids)) {
                      return null
                    }
                    return body.ids.map(String)
                  } catch {
                    return null
                  }
                },
              },
            }
          },
        },
        QueueWithdraw,
      ),
    )
  }

  return {
    /** Services this Client plugin waits for before applying. */
    inject: ['slots', 'locale', 'sessions', 'connection'],
    apply,
    __test: { createRemovalController, visibleQueue },
  }
})
