/**
 * dsh-queue-withdraw 1.11.5 — merged feature of dsh-codex-style.
 *
 * Source: dsh-plugins/6cebd96 packages/dsh-queue-withdraw/client.js.
 * The factory wrapper is provided by scripts/build-client.mjs; the body still
 * returns { inject, apply } and is only built when the feature is enabled.
 */
__DSH_FEATURE('dsh-queue-withdraw', function (require, env) {
  const React = require('react')
  const { createPortal } = require('react-dom')
  const {
    Button,
    Modal,
    Menu,
    IconEllipsisOutlineRegular,
    IconEditOutlineRegular,
  } = require('@deepseek-ai/dsh-client-ui-primitives')
  const { useEffect, useMemo, useRef, useState } = React
  const h = React.createElement

  /** Locale namespace owned by this plugin. */
  const NS = 'queueWithdraw'

  const zh = {
    'button.label': '撤回到输入栏',
    'button.tooltip': '把这条排队消息撤回输入栏',
    'button.attachments': '这条消息包含暂不支持的附件内容',
    'button.cacheMissing': '没有找到该文件附件的本地缓存，无法撤回',
    'button.cacheHint': '撤回文件附件（使用本插件的本地缓存）',
    'button.editHint': '编辑排队消息',
    'withdraw.tooltip': '撤回输入栏（替换输入框内容）',
    'menu.label': '更多操作',
    'menu.edit': '编辑消息',
    'menu.withdraw': '撤回到输入框',
    'menu.freeze': '冻结消息',
    'menu.thaw': '解冻消息',
    'steer.label': '引导',
    'remove.missing': '消息已离开队列，可能已开始发送。',
    'remove.unavailable': '会话尚未就绪，暂时无法删除。',
    'remove.writer': '删除失败：会话正由其他 DSH 实例占用。',
    'remove.ownership': '删除失败：会话当前无法修改队列。{detail}',
    'remove.failed': '删除失败：{detail}',
    'remove.unknown': '删除结果尚未确认，消息仍在队列时可重试。{detail}',
    'editor.title': '编辑排队消息',
    'editor.placeholder': '消息内容',
    'editor.addAttachment': '添加附件',
    'editor.removeAttachment': '移除附件',
    'editor.preview': '预览附件',
    'editor.attachment': '附件',
    'editor.cancel': '取消',
    'editor.save': '保存',
    'editor.failed': '保存失败，排队消息可能已变化',
    'merge.drop': '松开以合并到此消息末尾',
    'reorder.tooltip': '拖动排序排队消息',
    'reorder.failed': '排序失败，队列可能已变化',
    'merge.label': '合并',
    'merge.tooltip': '把纯文本排队消息合并成一条',
    'merge.failed': '合并失败，队列可能已变化',
    'merge.attachments': '含附件的排队消息无法合并',
    'button.empty': '这条排队消息没有可撤回的文本',
    'button.failed': '撤回失败，消息仍在队列中',
    'freeze.tooltip': '锁定，本轮结束不发送',
    'freeze.failed': '锁定失败，队列可能已变化',
    'frozen.thaw': '解锁',
    'frozen.activate': '解锁',
    'frozen.thawFailed': '解锁失败，队列可能已变化',
  }

  const en = {
    'button.label': 'Withdraw to input',
    'button.tooltip': 'Withdraw this queued message back into the composer',
    'button.attachments': 'This message contains attachment content that cannot be withdrawn',
    'button.cacheMissing':
      'No local cache was found for this file attachment; it cannot be withdrawn',
    'button.cacheHint': "Withdraw file attachment (uses this plugin's local cache)",
    'button.editHint': 'Edit queued message',
    'withdraw.tooltip': 'Withdraw to input (replaces the composer)',
    'menu.label': 'More actions',
    'menu.edit': 'Edit message',
    'menu.withdraw': 'Move to composer',
    'menu.freeze': 'Freeze message',
    'menu.thaw': 'Unfreeze message',
    'steer.label': 'Steer',
    'remove.missing': 'The message has left the queue and may have started sending.',
    'remove.unavailable': 'The session is not ready to remove messages.',
    'remove.writer': 'Could not remove: another DSH instance owns this session.',
    'remove.ownership': 'This session cannot currently modify its queue. {detail}',
    'remove.failed': 'Could not remove: {detail}',
    'remove.unknown': 'Removal is unconfirmed. Retry if the message remains queued. {detail}',
    'editor.title': 'Edit queued message',
    'editor.placeholder': 'Message content',
    'editor.addAttachment': 'Add attachment',
    'editor.removeAttachment': 'Remove attachment',
    'editor.preview': 'Preview attachment',
    'editor.attachment': 'Attachment',
    'editor.cancel': 'Cancel',
    'editor.save': 'Save',
    'editor.failed': 'Save failed; the queue may have changed',
    'merge.drop': 'Release to merge at the end of this message',
    'reorder.tooltip': 'Drag to reorder queued messages',
    'reorder.failed': 'Reorder failed; the queue may have changed',
    'merge.label': 'Merge',
    'merge.tooltip': 'Merge the queued text messages into one',
    'merge.failed': 'Merge failed; the queue may have changed',
    'merge.attachments': 'Messages with attachments cannot be merged',
    'button.empty': 'This queued message has no text to withdraw',
    'button.failed': 'Withdraw failed; the message is still queued',
    'freeze.tooltip': 'Lock: do not send it when the turn ends',
    'freeze.failed': 'Lock failed; the queue may have changed',
    'frozen.thaw': 'Unlock',
    'frozen.activate': 'Unlock',
    'frozen.thawFailed': 'Unlock failed; the queue may have changed',
  }

  /** Icon used by the injected row action. */
  /** Withdraw icon: down arrow onto the composer line. The viewBox is the
   *  glyph's tight box so it fills the 14px action box like the Host icons. */
  const WITHDRAW_ICON =
    '<svg viewBox="2.1 1.5 11.8 12.4" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.2v7"/><path d="M5.2 6.6 8 9.4 10.8 6.6"/><path d="M2.8 13.2h10.4"/></svg>'

  /** Closed lock for the per-row lock action. Tight viewBox: fills 14px. */
  const LOCK_ICON =
    '<svg viewBox="2.3 1.5 11.4 12.9" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6.9" width="10" height="6.8" rx="1.6"/><path d="M5.3 6.9V4.9a2.7 2.7 0 0 1 5.4 0v2"/></svg>'
  const UNLOCK_ICON =
    '<svg viewBox="2.3 1.5 11.4 12.9" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6.9" width="10" height="6.8" rx="1.6"/><path d="M5.3 6.9V4.9a2.7 2.7 0 0 1 5.4 0"/></svg>'

  const HANDLE_ICON =
    '<svg class="dshqw-grip" viewBox="0 0 8 16" width="8" height="16" fill="currentColor" aria-hidden="true"><circle cx="2" cy="4" r=".8"/><circle cx="6" cy="4" r=".8"/><circle cx="2" cy="8" r=".8"/><circle cx="6" cy="8" r=".8"/><circle cx="2" cy="12" r=".8"/><circle cx="6" cy="12" r=".8"/></svg><svg class="dshqw-queueGlyph" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2.5v7a2 2 0 0 0 2 2h8m-2.5-2.5 2.5 2.5-2.5 2.5M6.5 3.5H13M6.5 6.5H13"/></svg><span class="dshqw-lockGlyph">' +
    LOCK_ICON +
    '</span>'

  /** Menu actions relay to live Host controls, preserving their busy guards. */
  function QueueRowMenu({
    row,
    held,
    disabled,
    editDisabled,
    withdrawDisabled,
    freezeDisabled,
    t,
  }) {
    const [open, setOpen] = useState(false)
    const icon = (markup) =>
      h('span', { className: 'dshqw-menuIcon', dangerouslySetInnerHTML: { __html: markup } })
    return h(Menu, {
      listClassName: 'dsh-motion-surface',
      open,
      onClose: () => setOpen(false),
      portal: true,
      align: 'end',
      autoFocus: true,
      anchor: h(
        'button',
        {
          type: 'button',
          className: 'dshqw-more',
          'aria-label': t('menu.label'),
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          disabled,
          onClick: () => setOpen((value) => !value),
        },
        h(IconEllipsisOutlineRegular, { size: 14 }),
      ),
      items: [
        {
          id: 'edit',
          label: t('menu.edit'),
          icon: h(IconEditOutlineRegular, { size: 16 }),
          disabled: editDisabled,
        },
        {
          id: 'withdraw',
          label: t('menu.withdraw'),
          icon: icon(WITHDRAW_ICON),
          disabled: withdrawDisabled,
        },
        {
          id: 'freeze',
          label: t(held ? 'menu.thaw' : 'menu.freeze'),
          icon: icon(held ? UNLOCK_ICON : LOCK_ICON),
          disabled: freezeDisabled,
        },
      ],
      onSelect: (id) => {
        setOpen(false)
        if (row.isConnected === false) return
        const button =
          id === 'edit' ? hostEditButtonOf(row) : row.querySelector('[data-dshq-' + id + ']')
        if (button && !button.disabled) button.click()
      },
    })
  }

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
      if (candidate.hasAttribute?.('data-dsh-queue-withdraw') === true) continue
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

  /** Attachment edits use the host modal for focus, Escape and scroll locking. */
  function QueueEditor({ item, actions, t, onClose }) {
    const [text, setText] = useState(() => textOfContent(item.content))
    const [kept, setKept] = useState(() =>
      (item.content ?? []).filter((block) => block?.type === 'image' || block?.type === 'file'),
    )
    const [added, setAdded] = useState([])
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const input = useRef(null)
    const textarea = useRef(null)
    useEffect(() => {
      textarea.current?.focus()
    }, [])
    const close = () => {
      if (!busy) onClose()
    }
    const readFiles = async (event) => {
      const files = [...(event.target.files ?? [])]
      event.target.value = ''
      setBusy(true)
      try {
        const next = []
        for (const file of files) {
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(reader.error)
            reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
            reader.readAsDataURL(file)
          })
          if (data === '') throw new Error('empty file')
          next.push({
            name: file.name,
            mediaType: file.type,
            kind: file.type.startsWith('image/') ? 'image' : 'file',
            data,
          })
        }
        setAdded((current) => [...current, ...next])
      } catch {
        setError(t('editor.failed'))
      } finally {
        setBusy(false)
      }
    }
    const save = async () => {
      if (busy) return
      setBusy(true)
      try {
        if (await actions.updateItem(item.id, text, kept, added, t('editor.failed'))) onClose()
        else setError(t('editor.failed'))
      } finally {
        setBusy(false)
      }
    }
    const chips = (items, setter) =>
      items.map((block, index) =>
        h(
          'span',
          { className: 'dshqw-editorChip', key: index },
          block.attachment?.name ?? block.name ?? t('editor.attachment'),
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              className: 'dshqw-editorChipRemove',
              'aria-label': t('editor.removeAttachment'),
              onClick: () => setter((current) => current.filter((_value, i) => i !== index)),
            },
            '×',
          ),
        ),
      )
    return h(
      Modal,
      {
        className: 'dsh-motion-surface',
        open: true,
        title: t('editor.title'),
        closeLabel: t('editor.cancel'),
        onClose: close,
        footer: h(
          'div',
          { className: 'dshqw-editorActions' },
          h(Button, { variant: 'ghost', disabled: busy, onClick: close }, t('editor.cancel')),
          h(
            Button,
            {
              variant: 'primary',
              disabled: busy || (text.trim() === '' && kept.length + added.length === 0),
              onClick: () => {
                void save()
              },
            },
            t('editor.save'),
          ),
        ),
      },
      h(
        'div',
        { className: 'dshqw-editor' },
        h('textarea', {
          ref: textarea,
          className: 'dshqw-editorText',
          value: text,
          disabled: busy,
          'aria-label': t('editor.placeholder'),
          onChange: (event) => setText(event.target.value),
        }),
        h('div', { className: 'dshqw-editorChips' }, chips(kept, setKept), chips(added, setAdded)),
        h('input', {
          ref: input,
          type: 'file',
          multiple: true,
          hidden: true,
          onChange: (event) => {
            void readFiles(event)
          },
        }),
        h(
          Button,
          { variant: 'ghost', disabled: busy, onClick: () => input.current?.click() },
          t('editor.addAttachment'),
        ),
        error === '' ? null : h('p', { role: 'alert', className: 'dshqw-editorError' }, error),
      ),
    )
  }

  /**
   * The global decoration layer. It
   * reconciles one injected button with each host queue row.
   * @param {object} props - session id, standard hooks, injected actions and translator.
   * @returns {null} no React output.
   */
  function QueueWithdraw({ sessionId, useSession, useProjection, actions, t }) {
    const [editor, setEditor] = useState(null)
    const [preview, setPreview] = useState(null)
    const [rowMenus, setRowMenus] = useState([])
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
      const editItems = new Map()
      const editEntries = new Set()
      const editOriginal = new Map()
      const previewOriginal = new Map()
      const rowItems = new WeakMap()
      const nativeActionNodes = new Set()
      const removeButtons = new Set()
      const removalDisabled = new Set()
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
      /** Withdraw one queue item through the Host edit control. */
      const withdrawThrough = async (button, item) => {
        if (button.disabled) return
        button.disabled = true
        const accepted = await actionsRef.current.withdraw(
          item,
          tRef.current('button.empty'),
          tRef.current('button.failed'),
          tRef.current('button.attachments'),
          tRef.current('button.cacheMissing'),
        )
        if (accepted !== true) {
          button.disabled = false
          return
        }
        // A withdrawn message leaves the queue, so its lock must go too.
        const id = String(item.id)
        if (frozenIdsOf(sessionId).has(id)) {
          await actionsRef.current.thaw(id, tRef.current('frozen.thawFailed'))
          await refreshFrozenRef.current()
        }
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

      const closeEditor = () => setEditor(null)
      const openEditor = (_row, item) => setEditor({ item })
      const openPreview = (src) => {
        if (typeof src === 'string' && src !== '') setPreview(src)
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
          if (pointerEvent.clientY > rect.bottom - 14) {
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
                String(targetItem.id),
                String(current.id),
                tRef.current('merge.failed'),
              )
            }
            return
          }
          if (composerDrop !== null) {
            await actionsRef.current.withdraw(
              current,
              tRef.current('button.empty'),
              tRef.current('button.failed'),
              tRef.current('button.attachments'),
              tRef.current('button.cacheMissing'),
            )
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
       * Give each Host row one handle and one menu mount. Hidden action
       * relays retain the existing withdrawal and freeze state transitions.
       * @param {Element} row - host queue row.
       * @param {object} item - queue item currently shown by the row.
       * @returns {Element|null} the injected withdraw button.
       */
      const ensureRow = (row, item) => {
        if (typeof row.querySelector !== 'function') return null
        rowItems.set(row, item)
        const actions = row.querySelector?.('[class*="actions"]') ?? null
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
          handle.setAttribute('title', tRef.current('reorder.tooltip'))
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
        if (!row.querySelector('[data-dshq-menu]')) {
          const mount = document.createElement('span')
          mount.className = 'dshqw-menuMount'
          mount.setAttribute('data-dshq-menu', '')
          row.append(mount)
        }
        let withdraw = row.querySelector?.('[data-dshq-withdraw]')
        if (withdraw === null || withdraw === undefined) {
          withdraw = document.createElement('button')
          withdraw.type = 'button'
          withdraw.className = 'dshqw-withdraw'
          withdraw.setAttribute('data-dshq-withdraw', '')
          withdraw.setAttribute('aria-label', tRef.current('withdraw.tooltip'))
          withdraw.setAttribute('aria-hidden', 'true')
          withdraw.tabIndex = -1
          withdraw.innerHTML = WITHDRAW_ICON
          withdraw.addEventListener('click', (event) => {
            event.preventDefault?.()
            event.stopPropagation?.()
            const target = rowItems.get(row)
            if (target !== undefined) void withdrawThrough(withdraw, target)
          })
          // Appended once, at the dock's trailing edge, after the native
          // actions: the left text edge never moves when React re-creates the
          // row and this button is re-added.
          row.append?.(withdraw)
        }
        let freeze = row.querySelector?.('[data-dshq-freeze]')
        if (freeze === null || freeze === undefined) {
          freeze = document.createElement('button')
          freeze.type = 'button'
          freeze.className = 'dshqw-freeze'
          freeze.setAttribute('data-dshq-freeze', '')
          freeze.setAttribute('aria-label', tRef.current('freeze.tooltip'))
          freeze.setAttribute('title', tRef.current('freeze.tooltip'))
          freeze.setAttribute('aria-hidden', 'true')
          freeze.tabIndex = -1
          freeze.innerHTML = UNLOCK_ICON
          freeze.addEventListener('click', (event) => {
            event.preventDefault?.()
            event.stopPropagation?.()
            const target = rowItems.get(row)
            if (target !== undefined) void freezeThrough(freeze, target)
          })
          // The lock sits just before the native action cluster.
          if (actions !== null && actions !== undefined) row.insertBefore(freeze, actions)
          else row.append?.(freeze)
        }
        return withdraw
      }

      const syncNativeActions = (row) => {
        const box = row.querySelector('[class*="actions"]')
        if (!box) return
        const edit = hostEditButtonOf(row)
        for (const button of box.querySelectorAll('button[aria-label]')) {
          const label = button.getAttribute('aria-label') ?? ''
          const kind =
            button === edit
              ? 'edit'
              : /引导|插话|Steer/i.test(label)
                ? 'steer'
                : /移除|删除|Remove|Delete/i.test(label)
                  ? 'remove'
                  : null
          let wrapper = button
          while (wrapper.parentElement && wrapper.parentElement !== box)
            wrapper = wrapper.parentElement
          if (!kind) {
            wrapper.removeAttribute('data-dshq-native-action')
            continue
          }
          wrapper.setAttribute('data-dshq-native-action', kind)
          if (kind === 'steer')
            button.setAttribute('data-dshq-action-label', tRef.current('steer.label'))
          nativeActionNodes.add(wrapper)
          if (kind === 'remove' && !removeButtons.has(button)) {
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
      }

      /**
       * Leave text messages to the Host's own inline editor. Only a message
       * made purely of attachments — which the Host refuses to edit — falls
       * back to this plugin's editor.
       */
      const syncHostEdit = (row, item) => {
        if (typeof row.querySelectorAll !== 'function') return
        const plan = withdrawPlan(item?.content)
        const edit = hostEditButtonOf(row)
        if (edit === null) return
        if (plan.unsupported || plan.attachments.length === 0) {
          editItems.delete(edit)
          if (edit.hasAttribute?.('data-dshq-edit')) {
            edit.removeAttribute('data-dshq-edit')
            edit.setAttribute('aria-label', editOriginal.get(edit)?.label ?? 'Edit')
            if (plan.text !== '' && !actionsRef.current.removal?.busy() && edit.disabled !== false)
              edit.disabled = false
          }
          return
        }
        editItems.set(edit, item)
        editEntries.add(edit)
        const first = !editOriginal.has(edit)
        if (first)
          editOriginal.set(edit, {
            label: edit.getAttribute('aria-label'),
            disabled: edit.disabled,
          })
        const held =
          frozenIdsOf(sessionId).has(String(item.id)) || !!actionsRef.current.removal?.busy()
        if (edit.disabled !== held) edit.disabled = held
        edit.setAttribute('aria-label', tRef.current('button.editHint'))
        edit.setAttribute('data-dshq-edit', '')
        if (first) {
          for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'focus']) {
            listen(
              edit,
              type,
              (event) => {
                if (editItems.has(edit)) event.stopImmediatePropagation?.()
              },
              true,
            )
          }
          listen(
            edit,
            'click',
            (event) => {
              const current = editItems.get(edit)
              if (current === undefined || edit.disabled) return
              event.preventDefault?.()
              event.stopImmediatePropagation?.()
              event.stopPropagation?.()
              if (current !== undefined) openEditor(row, current)
            },
            true,
          )
        }
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
              openPreview(image.getAttribute('src') ?? '')
            },
            true,
          )
        }
      }

      /**
       * Reflect the Host's held set on one live queue row: struck-through
       * text, a closed lock at the dock's trailing edge, and a disabled edit
       * control. Withdraw and the rest of the row stay available; the message
       * itself never leaves `next-turn`, only the claim skips it.
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
          const icon = frozen ? LOCK_ICON : UNLOCK_ICON
          if (button.getAttribute?.('data-locked') !== String(frozen)) {
            button.setAttribute?.('data-locked', String(frozen))
            button.innerHTML = icon
          }
          const label = frozen ? tRef.current('frozen.activate') : tRef.current('freeze.tooltip')
          if (button.title !== label) button.title = label
          if (button.getAttribute?.('aria-label') !== label)
            button.setAttribute?.('aria-label', label)
          const pressed = frozen ? 'true' : 'false'
          if (button.getAttribute?.('aria-pressed') !== pressed)
            button.setAttribute?.('aria-pressed', pressed)
        }
        const edit = hostEditButtonOf(row)
        if (edit !== null) {
          if (frozen) {
            if (edit.disabled !== true) edit.disabled = true
            edit.setAttribute?.('data-dshq-locked', '')
          } else if (edit.hasAttribute?.('data-dshq-locked') === true) {
            if (!actionsRef.current.removal?.busy() && edit.disabled !== false)
              edit.disabled = false
            edit.removeAttribute?.('data-dshq-locked')
          }
        }
      }

      const sync = () => {
        if (disposed || dragging) return
        for (const [node, off] of listeners) {
          if (node.isConnected !== false) continue
          for (const dispose of off) dispose()
          listeners.delete(node)
          removeButtons.delete(node)
          editItems.delete(node)
          editEntries.delete(node)
          editOriginal.delete(node)
          previewOriginal.delete(node)
        }
        const queueNow = mutableRef.current === true ? queueRef.current : []
        const removal = actionsRef.current.removal?.busy()
        if (!removal) {
          for (const button of removalDisabled)
            if (button.isConnected !== false) button.disabled = false
          removalDisabled.clear()
        }
        const menus = []
        for (const dock of docksOf(sessionId)) {
          const header = dock.querySelector?.('.v1kfCW_header[aria-controls][aria-expanded]')
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
            decoratedDocks.add(dock)
          }
          const rows = hostRowsOf(dock)
          for (let index = 0; index < rows.length; index += 1) {
            const item = queueNow[index]
            if (item === undefined) continue
            const row = rows[index]
            ensureRow(row, item)
            syncHostEdit(row, item)
            syncPreviews(row)
            decorateFrozenRow(row, item)
            syncNativeActions(row)
            if (removal)
              for (const button of row.querySelectorAll('button')) {
                if (!button.disabled) {
                  removalDisabled.add(button)
                  button.disabled = true
                }
              }
            const container = row.querySelector('[data-dshq-menu]')
            if (container)
              menus.push({
                row,
                container,
                id: String(item.id),
                held: frozenIdsOf(sessionId).has(String(item.id)),
                disabled: !!removal,
                editDisabled: !!removal || (hostEditButtonOf(row)?.disabled ?? true),
                withdrawDisabled:
                  !!removal || (row.querySelector('[data-dshq-withdraw]')?.disabled ?? true),
                freezeDisabled:
                  !!removal || (row.querySelector('[data-dshq-freeze]')?.disabled ?? true),
              })
          }
        }
        setRowMenus((previous) =>
          previous.length === menus.length &&
          previous.every((entry, index) =>
            Object.keys(entry).every((key) => entry[key] === menus[index][key]),
          )
            ? previous
            : menus,
        )
        for (const node of nativeActionNodes)
          if (node.isConnected === false) nativeActionNodes.delete(node)
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
        attributeFilter: ['disabled', 'hidden'],
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
        for (const button of removalDisabled)
          if (button.isConnected !== false) button.disabled = false
        removalDisabled.clear()
        removeButtons.clear()
        for (const dock of decoratedDocks) dock.removeAttribute('data-dshq-flat')
        decoratedDocks.clear()
        cancelFrame()
        cancelDrag()
        for (const off of listeners.values()) for (const dispose of off) dispose()
        listeners.clear()
        for (const dock of docksOf(sessionId)) {
          for (const row of hostRowsOf(dock)) row.removeAttribute?.('data-dshq-row')
          for (const button of dock.querySelectorAll?.(
            '[data-dshq-withdraw], [data-dshq-freeze], [data-dshq-handle], [data-dshq-menu]',
          ) ?? [])
            button.remove?.()
        }
        for (const node of nativeActionNodes) {
          node.removeAttribute('data-dshq-native-action')
          node.removeAttribute('data-dshq-action-label')
          for (const button of node.querySelectorAll('button[aria-label]'))
            button.removeAttribute('data-dshq-action-label')
        }
        nativeActionNodes.clear()
        setRowMenus([])
        closeEditor()
        for (const edit of [...editEntries]) {
          if (edit.hasAttribute?.('data-dshq-edit') === true) {
            edit.disabled = editOriginal.get(edit)?.disabled ?? true
            const label = editOriginal.get(edit)?.label
            if (label !== undefined && label !== null) edit.setAttribute('aria-label', label)
          }
          edit.removeAttribute?.('data-dshq-edit')
        }
        for (const [image, cursor] of previewOriginal) {
          image.removeAttribute?.('data-dshq-preview')
          image.style.cursor = cursor
        }
        previewOriginal.clear()
        editOriginal.clear()
        editEntries.clear()
        editItems.clear()
      }
    }, [sessionId, queueMutable])

    if (editor === null && preview === null && rowMenus.length === 0) return null
    return h(
      React.Fragment,
      null,
      rowMenus.map(({ container, id, ...props }) =>
        createPortal(h(QueueRowMenu, { ...props, t }), container, id),
      ),
      editor === null
        ? null
        : h(QueueEditor, {
            key: String(editor.item.id),
            item: editor.item,
            actions,
            t,
            onClose: () => setEditor(null),
          }),
      preview === null
        ? null
        : h(
            Modal,
            {
              className: 'dsh-motion-surface',
              open: true,
              title: t('editor.preview'),
              closeLabel: t('editor.cancel'),
              onClose: () => setPreview(null),
            },
            h('img', { className: 'dshqw-previewImage', src: preview, alt: '' }),
          ),
    )
  }

  /** Presentation only; colors and elevation come from the Host theme. */
  const CSS = `
/* Keep business-action relays out of the row's visible action cluster. */
.dshqw-withdraw, .dshqw-freeze { display: none; }
[data-queue-dock][data-dshq-flat] .v1kfCW_header { display: none; }
[data-queue-dock][data-dshq-flat] .v1kfCW_panel { padding: 2px 0; border-radius: 16px 16px 0 0; }
[data-queue-dock][data-dshq-flat] .v1kfCW_panel::before { background: var(--dsw-specific-input-major); backdrop-filter: none; }
[data-queue-dock][data-dshq-flat] .v1kfCW_list { max-height: 180px; }
[data-queue-dock][data-dshq-flat] .v1kfCW_row { border-radius: 0; box-shadow: none; }
[data-dshq-native-action="edit"] { display: none !important; }
[data-dshq-native-action="steer"] { order: 0; }
[data-dshq-native-action="remove"] { order: 1; }
.dshqw-menuMount { display: inline-flex; align-items: center; flex: none; }
.dshqw-menuIcon { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; }
.dshqw-menuIcon > svg { width: 16px; height: 16px; }
.dshqw-more,
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
[data-dshq-native-action="steer"] button,
button[data-dshq-native-action="steer"] { display: inline-flex; align-items: center; justify-content: center; gap: 5px; width: auto; padding: 0 7px; font: inherit; }
[data-dshq-native-action="steer"] button > svg,
button[data-dshq-native-action="steer"] > svg { display: none; }
[data-dshq-native-action="steer"] button::before,
button[data-dshq-native-action="steer"]::before {
  content: ''; width: 14px; height: 14px; flex: none; background: currentColor;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3 3v2a3 3 0 0 0 3 3h7m-3-3 3 3-3 3' fill='none' stroke='black' stroke-width='1.25' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
}
[data-dshq-native-action="steer"] button::after,
button[data-dshq-native-action="steer"]::after { content: attr(data-dshq-action-label); white-space: nowrap; }
[data-dshq-row]:has(textarea, input) .dshqw-menuMount { display: none; }
[data-queue-dock] [data-dshq-row] [class*="preview"] { font-size: 14px; line-height: 22px; }
[data-queue-dock] [data-dshq-row] [class*="thumb"] { width: 28px; height: 28px; border-radius: 6px; }
.dshqw-handle { gap: 1px; cursor: grab; touch-action: none; }
.dshqw-handle > svg { flex: none; }
.dshqw-grip { opacity: 0; transition: opacity 100ms ease; }
[data-dshq-row]:hover .dshqw-grip,
[data-dshq-row]:focus-within .dshqw-grip,
.dshqw-drag-source .dshqw-grip,
.dshqw-drag-ghost .dshqw-grip { opacity: 1; }
.dshqw-lockGlyph { display: none; width: 16px; align-items: center; justify-content: center; }
.dshqw-locked-row .dshqw-queueGlyph { display: none; }
.dshqw-locked-row .dshqw-lockGlyph { display: inline-flex; color: var(--dsw-alias-label-secondary); }
@media (hover: none) { .dshqw-grip { opacity: 1; } }
[data-queue-dock] [data-dshq-row].dshqw-drag-source,
.dshqw-drag-ghost,
.dshqw-drag-source .dshqw-handle {
  cursor: grabbing;
  user-select: none;
}
[data-queue-dock] [data-dshq-row] textarea,
[data-queue-dock] [data-dshq-row] input {
  cursor: text;
  user-select: text;
}
.dshqw-more:hover:not(:disabled),
.dshqw-more[aria-expanded="true"],
.dshqw-handle:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshqw-more:disabled,
.dshqw-handle:disabled {
  cursor: default;
  opacity: .45;
}
.dshqw-more:focus-visible,
.dshqw-handle:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshqw-drag-source {
  opacity: .28;
  transition: opacity 120ms ease;
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
.dshqw-editor { display: flex; flex-direction: column; gap: 12px; min-width: 0; color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); }
.dshqw-editorText { box-sizing: border-box; width: 100%; min-height: 110px; resize: vertical; padding: 7px 8px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
.dshqw-editorChips { display: flex; flex-wrap: wrap; gap: 6px; }
.dshqw-editorChip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 6px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; font-size: 12px; line-height: 18px; }
.dshqw-editorChipRemove { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; padding: 0 3px; font: inherit; }
.dshqw-editorActions { display: flex; justify-content: flex-end; gap: 8px; }
.dshqw-editorError { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.dshqw-merge-target { outline: 2px dashed var(--dsw-alias-state-business-primary); outline-offset: -2px; border-radius: 8px; }
.dshqw-drop-composer { outline: 2px dashed var(--dsw-alias-state-business-primary) !important; outline-offset: 2px; }
.dshqw-previewImage { display: block; max-width: 100%; max-height: 70vh; margin: auto; object-fit: contain; border-radius: 8px; }
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
                 * Replace one queue item's text and attachments through the Host route.
                 * @param {string} itemId - queue item id.
                 * @param {string} text - edited text.
                 * @param {object[]} blocks - kept image/file blocks.
                 * @param {object[]} files - new uploads as base64.
                 * @param {string} failure - failure notice.
                 * @returns {Promise<boolean>} whether the Host applied the edit.
                 */
                updateItem: async (itemId, text, blocks, files, failure) => {
                  try {
                    const response = await fetch(UPDATE_PATH, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        sessionId,
                        action: 'edit',
                        itemId,
                        text,
                        blocks,
                        files,
                      }),
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
                 * Append one queued message to another and remove the source.
                 * @param {string} targetId - receiving queue item.
                 * @param {string} sourceId - dragged queue item.
                 * @param {string} failure - failure notice.
                 * @returns {Promise<boolean>} whether the Host merged them.
                 */
                mergeInto: async (targetId, sourceId, failure) => {
                  try {
                    const response = await fetch(UPDATE_PATH, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ sessionId, action: 'merge', targetId, sourceId }),
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
                    previousDraft =
                      shell?.draftSnapshot ??
                      (typeof shell?.snapshot?.draft === 'string' ? shell.snapshot.draft : '')
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
                      rollback()
                      notify('error', failure)
                      return false
                    }
                    // The queue row disappearing and the draft appearing are the
                    // feedback; an info notice would linger in the Host's notice
                    // surface and is unnecessary for a successful withdraw.
                    for (const id of removedIds) conversation?.releaseDraftAttachment?.(id)
                    if (cachedRecords.length > 0) await forgetCachedRecords(cachedRecords)
                    return true
                  } catch {
                    rollback()
                    notify('error', failure)
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
