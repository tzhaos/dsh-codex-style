/**
 * dsh-composer-history 1.2.0 — merged feature of dsh-codex-style.
 *
 * Source: dsh-plugins/6cebd96 packages/dsh-composer-history/client.js.
 * The factory wrapper is provided by scripts/build-client.mjs; the body still
 * returns { inject, apply } and is only built when the feature is enabled.
 */
__DSH_FEATURE('dsh-composer-history', function (require, env) {
  const React = require('react')
  const { createPortal } = require('react-dom')
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
  const { Tooltip, MenuSurface, IconClockOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular } =
    primitives
  const { useEffect, useMemo, useRef, useState } = React
  const h = React.createElement

  /** Locale namespace owned by this plugin. */
  const NS = 'composerHistory'

  const zh = {
    'button.label': '输入历史',
    'button.shortcut': '↑ 取回上一条',
    'panel.title': '输入历史',
    'panel.search': '搜索历史输入…',
    'panel.empty': '当前会话还没有可用的历史输入',
    'panel.emptySearch': '没有匹配的历史输入',
    'panel.count': '{count} 条',
    'panel.hint': '↑↓ 选择 · Enter 填入 · Esc 关闭',
    'panel.clear': '清空',
    'panel.clearConfirm': '清空当前会话的全部历史输入？',
    'panel.clearConfirmAction': '清空',
    'panel.clearCancel': '取消',
    'settings.tab': '输入历史',
    'settings.title': '输入历史',
    'settings.intro':
      '管理由本插件记录的历史输入。删除或清空只影响插件在浏览器本地的记录，不会修改会话消息。',
    'settings.empty': '还没有可管理的历史输入',
    'settings.count': '{count} 条记录',
    'settings.session': '会话',
    'settings.unknownSession': '未知会话',
    'settings.expand': '展开',
    'settings.collapse': '收起',
    'settings.delete': '删除',
    'settings.clear': '清空全部历史',
    'settings.clearConfirm': '确认清空全部历史输入？此操作会隐藏现有会话历史，不能撤销。',
    'settings.confirmClear': '确认清空',
    'settings.cancel': '取消',
  }

  const en = {
    'button.label': 'Prompt history',
    'button.shortcut': '↑ recalls previous',
    'panel.title': 'Prompt history',
    'panel.search': 'Search previous prompts…',
    'panel.empty': 'No prompt history in this conversation yet',
    'panel.emptySearch': 'No matching prompts',
    'panel.count': '{count} items',
    'panel.hint': '↑↓ select · Enter insert · Esc close',
    'panel.clear': 'Clear',
    'panel.clearConfirm': 'Clear all prompt history in this conversation?',
    'panel.clearConfirmAction': 'Clear',
    'panel.clearCancel': 'Cancel',
    'settings.tab': 'Prompt history',
    'settings.title': 'Prompt history',
    'settings.intro':
      'Manage the prompt history recorded by this plugin. Deleting or clearing only affects browser-local records; conversation messages are not modified.',
    'settings.empty': 'No prompt history to manage yet',
    'settings.count': '{count} records',
    'settings.session': 'Conversation',
    'settings.unknownSession': 'Unknown conversation',
    'settings.expand': 'Expand',
    'settings.collapse': 'Collapse',
    'settings.delete': 'Delete',
    'settings.clear': 'Clear all history',
    'settings.clearConfirm':
      'Clear all prompt history? This hides existing conversation history and cannot be undone.',
    'settings.confirmClear': 'Clear all',
    'settings.cancel': 'Cancel',
  }

  /**
   * Extract the text carried by one user message event.
   * @param {unknown} content - Session content blocks.
   * @returns {string} concatenated text, trimmed.
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
   * Read user prompts from one live Session event window.
   * Only real user submissions are included; runtime context, skill catalogs,
   * approvals and turn notifications are also user-role events but must not
   * appear as prompt history.
   * @param {object|undefined} binding - retained Session binding.
   * @param {string} sessionId - owning conversation id.
   * @returns {Array<{id: string, key: string, sessionId: string, text: string, time: number}>} newest first.
   */
  function readPrompts(binding, sessionId) {
    const prompts = []
    try {
      const entries = binding?.eventSource?.getSnapshot?.()?.entries
      if (!Array.isArray(entries)) return prompts
      for (const record of entries) {
        const event = record?.event ?? record
        if (event === null || event === undefined || event.type !== 'user/message') continue
        if (event.data?.source?.kind !== 'user') continue
        const text = textOfContent(event.data?.content)
        if (text === '') continue
        const id = String(event.seq ?? prompts.length)
        prompts.push({
          id,
          key: sessionId + ':' + id,
          sessionId,
          text,
          time: typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0,
        })
      }
    } catch {
      return []
    }
    return prompts.reverse().slice(0, 100)
  }

  /**
   * Apply deletion and clear cutoffs to one prompt list.
   * @param {Array<object>} prompts - raw prompts.
   * @param {object} managed - managed state.
   * @returns {Array<object>} visible prompts.
   */
  function visiblePrompts(prompts, managed) {
    const hidden = new Set(managed.hidden)
    return prompts.filter((prompt) => {
      if (hidden.has(prompt.key)) return false
      if (managed.clearedAt > 0 && prompt.time <= managed.clearedAt) return false
      const sessionCutoff = managed.clearedSessions[prompt.sessionId] ?? 0
      return prompt.time > sessionCutoff
    })
  }

  /**
   * Merge visible prompts into the settings record cache.
   * @param {object} managed - current managed state.
   * @param {string} sessionId - owning conversation.
   * @param {string} title - conversation title.
   * @param {Array<object>} prompts - visible prompts.
   * @returns {object|null} next state when something changed.
   */
  function mergeRecords(managed, sessionId, title, prompts) {
    const records = new Map(managed.records.map((record) => [record.key, record]))
    let changed = false
    for (const prompt of prompts) {
      const previous = records.get(prompt.key)
      const next = {
        key: prompt.key,
        sessionId,
        title: typeof title === 'string' && title !== '' ? title : sessionId,
        text: prompt.text,
        time: prompt.time,
      }
      if (
        previous === undefined ||
        previous.text !== next.text ||
        previous.title !== next.title ||
        previous.time !== next.time
      ) {
        records.set(prompt.key, next)
        changed = true
      }
    }
    if (!changed) return null
    return {
      ...managed,
      records: [...records.values()]
        .sort((left, right) => right.time - left.time)
        .slice(0, RECORD_LIMIT),
    }
  }

  /** @param {string} text - prompt body. @returns {string} a compact preview. */
  function previewOf(text) {
    return text.replace(/\s+/g, ' ').trim()
  }

  /** Browser-local storage for deleted/cleared history and the manageable record cache. */
  const STORAGE_KEY = 'dsh.composerHistory.managedSettings'
  const RECORD_LIMIT = 500
  const HIDDEN_LIMIT = 1000
  /** Empty managed-state value. */
  const EMPTY_MANAGED = Object.freeze({
    clearedAt: 0,
    clearedSessions: {},
    hidden: [],
    records: [],
  })

  /**
   * Validate one persisted managed-state value.
   * @param {unknown} value - parsed localStorage value.
   * @returns {object} normalized managed state.
   */
  function normalizeManaged(value) {
    const source = value !== null && typeof value === 'object' ? value : {}
    const records = Array.isArray(source.records) ? source.records : []
    const hidden = Array.isArray(source.hidden) ? source.hidden : []
    const clearedSessions =
      source.clearedSessions !== null && typeof source.clearedSessions === 'object'
        ? source.clearedSessions
        : {}
    return {
      clearedAt:
        typeof source.clearedAt === 'number' && Number.isFinite(source.clearedAt)
          ? source.clearedAt
          : 0,
      clearedSessions: Object.fromEntries(
        Object.entries(clearedSessions).filter(
          ([key, time]) =>
            typeof key === 'string' && typeof time === 'number' && Number.isFinite(time),
        ),
      ),
      hidden: hidden.filter((key) => typeof key === 'string').slice(-HIDDEN_LIMIT),
      records: records
        .filter(
          (record) =>
            record !== null &&
            typeof record === 'object' &&
            typeof record.key === 'string' &&
            typeof record.sessionId === 'string' &&
            typeof record.text === 'string' &&
            typeof record.time === 'number',
        )
        .slice(0, RECORD_LIMIT),
    }
  }

  /** @returns {object} persisted managed state, or an empty value. */
  function readManagedSettings() {
    try {
      const raw = window.localStorage?.getItem?.(STORAGE_KEY)
      return raw === null || raw === undefined
        ? normalizeManaged(EMPTY_MANAGED)
        : normalizeManaged(JSON.parse(raw))
    } catch {
      return normalizeManaged(EMPTY_MANAGED)
    }
  }

  /**
   * Persist managed state; storage failure leaves the in-memory snapshot intact.
   * @param {object} value - next managed state.
   */
  function writeManagedSettings(value) {
    try {
      window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(value))
    } catch {
      // A quota/private-mode failure must not make the panel unusable.
    }
  }

  /**
   * Create the small shared snapshot store used by the composer and settings tab.
   * @param {object} initial - initial managed state.
   * @returns {object} getSnapshot/subscribe/set.
   */
  function createManagedStore(initial) {
    let snapshot = initial
    const listeners = new Set()
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      set: (next) => {
        snapshot = next
        for (const listener of listeners) listener()
      },
    }
  }

  /**
   * Subscribe a component to a snapshot store.
   * @param {object} store - managed store.
   * @returns {object} current managed state.
   */
  function useStoreValue(store) {
    const [value, setValue] = useState(store.getSnapshot())
    useEffect(() => {
      setValue(store.getSnapshot())
      return store.subscribe(() => {
        setValue(store.getSnapshot())
      })
    }, [store])
    return value
  }

  /**
   * The history trigger and its searchable palette. It is registered into the
   * composer's tool row, so it participates in that row's layout and theme.
   * @param {object} props - injected history/draft actions, session id and locale.
   * @returns {object} trigger and optional portal palette.
   */
  function ComposerHistory({ sessionId, actions, t }) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [entries, setEntries] = useState([])
    const [selected, setSelected] = useState(0)
    const [anchor, setAnchor] = useState(null)
    const [confirmClear, setConfirmClear] = useState(false)
    const triggerRef = useRef(null)
    const panelRef = useRef(null)
    const searchRef = useRef(null)
    /** Shell-like recall cycle: entries, position, original draft and last applied text. */
    const recallRef = useRef(null)

    const filtered = useMemo(() => {
      const needle = query.trim().toLowerCase()
      if (needle === '') return entries
      return entries.filter((entry) => entry.text.toLowerCase().includes(needle))
    }, [entries, query])

    const close = () => {
      setOpen(false)
      setQuery('')
      setConfirmClear(false)
    }

    const openPanel = () => {
      const trigger = triggerRef.current
      if (trigger === null || typeof trigger.getBoundingClientRect !== 'function') return
      const rect = trigger.getBoundingClientRect()
      setAnchor({
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      })
      setEntries(actions.readHistory())
      setQuery('')
      setSelected(0)
      setConfirmClear(false)
      setOpen(true)
    }

    /** Start or advance the direct ↑ recall cycle. @returns whether the key was consumed. */
    const recallPrevious = () => {
      const current = actions.readDraft()
      const active = recallRef.current
      if (active !== null && active !== undefined) {
        if (current !== active.lastText) {
          // The user edited the recalled prompt; the next ↑ starts fresh.
          recallRef.current = null
        } else {
          const nextIndex = active.index + 1
          if (nextIndex >= active.entries.length) return true
          const entry = active.entries[nextIndex]
          actions.setDraft(entry.text)
          recallRef.current = { ...active, index: nextIndex, lastText: entry.text }
          return true
        }
      }
      if (current.trim() !== '') return false
      const entries = actions.readHistory()
      if (entries.length === 0) return false
      actions.setDraft(entries[0].text)
      recallRef.current = { entries, index: 0, originalDraft: current, lastText: entries[0].text }
      return true
    }

    /** Move back toward the current draft with ↓. @returns whether the key was consumed. */
    const recallNext = () => {
      const active = recallRef.current
      if (active === null || active === undefined) return false
      const current = actions.readDraft()
      if (current !== active.lastText) {
        // Editing cancels the cycle rather than overwriting the edit.
        recallRef.current = null
        return false
      }
      if (active.index > 0) {
        const entry = active.entries[active.index - 1]
        actions.setDraft(entry.text)
        recallRef.current = { ...active, index: active.index - 1, lastText: entry.text }
        return true
      }
      actions.setDraft(active.originalDraft)
      recallRef.current = null
      return true
    }

    useEffect(() => {
      if (!open) return undefined
      const focusTimer = window.setTimeout(() => {
        searchRef.current?.focus?.()
      }, 0)
      return () => {
        window.clearTimeout(focusTimer)
      }
    }, [open])

    useEffect(() => {
      if (!open) return undefined
      const onPointerDown = (event) => {
        const target = event.target
        if (panelRef.current?.contains?.(target)) return
        if (triggerRef.current?.contains?.(target)) return
        close()
      }
      document.addEventListener('pointerdown', onPointerDown, true)
      return () => {
        document.removeEventListener('pointerdown', onPointerDown, true)
      }
    }, [open])

    useEffect(() => {
      if (!open) return undefined
      const onKeyDown = (event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation?.()
        close()
      }
      document.addEventListener('keydown', onKeyDown, true)
      return () => {
        document.removeEventListener('keydown', onKeyDown, true)
      }
    }, [open])

    useEffect(() => {
      const onKeyDown = (event) => {
        if (open || event.defaultPrevented || event.isComposing) return
        if (typeof document === 'undefined') return
        const target = event.target
        const active = document.activeElement
        if (
          target !== null &&
          target !== undefined &&
          typeof target.closest === 'function' &&
          target.closest('[data-composer-seat]') === null
        )
          return
        if (
          active === null ||
          active === undefined ||
          typeof active.closest !== 'function' ||
          active.closest('[data-composer-seat]') === null
        )
          return
        const owner = active.closest('[data-conversation-session]')
        if (
          owner !== null &&
          owner !== undefined &&
          owner.getAttribute?.('data-conversation-session') !== sessionId
        )
          return
        const chord = (event.ctrlKey || event.metaKey) && event.key === 'ArrowUp'
        const plainUp =
          event.key === 'ArrowUp' &&
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        const plainDown =
          event.key === 'ArrowDown' &&
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        if (chord) {
          event.preventDefault()
          event.stopPropagation?.()
          openPanel()
          return
        }
        if (plainUp) {
          if (!recallPrevious()) return
          event.preventDefault()
          event.stopPropagation?.()
          return
        }
        if (plainDown && recallNext()) {
          event.preventDefault()
          event.stopPropagation?.()
        }
      }
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function')
        return undefined
      document.addEventListener('keydown', onKeyDown, true)
      return () => {
        document.removeEventListener('keydown', onKeyDown, true)
      }
    }, [open, sessionId, actions])

    useEffect(() => {
      if (!open) return
      const list = panelRef.current?.querySelector?.('.dshch-item[aria-selected="true"]')
      list?.scrollIntoView?.({ block: 'nearest' })
    }, [open, selected])

    const apply = (entry) => {
      close()
      try {
        actions.setDraft(entry.text)
      } catch {
        return
      }
      window.setTimeout(() => {
        const seat = triggerRef.current
          ?.closest?.('[data-conversation-session]')
          ?.querySelector?.('[data-composer-seat]')
        const editable = seat?.querySelector?.('[contenteditable="true"]')
        editable?.focus?.()
      }, 0)
    }

    const onSearchKeyDown = (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelected((current) => Math.min(current + 1, Math.max(0, filtered.length - 1)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelected((current) => Math.max(current - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const entry = filtered[selected]
        if (entry !== undefined) apply(entry)
      }
    }

    const trigger = h(
      Tooltip,
      {
        label: t('button.label') + ' · ' + t('button.shortcut'),
        side: 'top',
        delayMs: 400,
      },
      h(
        'button',
        {
          ref: triggerRef,
          type: 'button',
          className: 'dshch-trigger',
          'aria-label': t('button.label'),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'data-dsh-composer-history': 'trigger',
          onMouseDown: (event) => {
            event.preventDefault?.()
          },
          onClick: () => {
            if (open) close()
            else openPanel()
          },
        },
        h(IconClockOutlineRegular, { size: 14 }),
      ),
    )

    let palette = null
    if (open && anchor !== null) {
      const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
      const width = Math.min(360, Math.max(0, viewportWidth - 24))
      const left = Math.min(Math.max(12, anchor.left + anchor.width / 2 - width / 2), Math.max(12, viewportWidth - width - 12))
      const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
      const bottom = Math.max(8, viewportHeight - anchor.top + 10)
      palette = createPortal(
        h(
          MenuSurface,
          {
            ref: panelRef,
            className: 'dshch-panel',
            role: 'dialog',
            'aria-label': t('panel.title'),
            style: { left: left + 'px', bottom: bottom + 'px', width: width + 'px' },
          },
          h(
            'div',
            { className: 'dshch-search' },
            h(IconSearchOutlineRegular, { size: 14 }),
            h('input', {
              ref: searchRef,
              type: 'text',
              value: query,
              placeholder: t('panel.search'),
              'aria-label': t('panel.search'),
              spellCheck: false,
              onChange: (event) => {
                setQuery(event.target.value)
                setSelected(0)
              },
              onKeyDown: onSearchKeyDown,
            }),
          ),
          h(
            'div',
            { className: 'dshch-list', role: 'listbox', 'aria-label': t('panel.title') },
            filtered.length === 0
              ? h(
                  'div',
                  { className: 'dshch-empty' },
                  t(query.trim() === '' ? 'panel.empty' : 'panel.emptySearch'),
                )
              : filtered.map((entry, index) =>
                  h(
                    'button',
                    {
                      key: entry.id,
                      type: 'button',
                      role: 'option',
                      className: 'dshch-item',
                      'aria-selected': index === selected,
                      onMouseEnter: () => {
                        setSelected(index)
                      },
                      onClick: () => {
                        apply(entry)
                      },
                    },
                    h('span', { className: 'dshch-text' }, previewOf(entry.text)),
                  ),
                ),
          ),
          h(
            'div',
            { className: 'dshch-footer' },
            h('span', null, t('panel.count', { count: filtered.length })),
            confirmClear
              ? h(
                  'span',
                  { className: 'dshch-confirm' },
                  h('span', null, t('panel.clearConfirm')),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshch-clearConfirm',
                      onClick: () => {
                        actions.clearHistory()
                        setEntries([])
                        setSelected(0)
                        setConfirmClear(false)
                      },
                    },
                    t('panel.clearConfirmAction'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshch-clearCancel',
                      onClick: () => {
                        setConfirmClear(false)
                      },
                    },
                    t('panel.clearCancel'),
                  ),
                )
              : h(
                  'span',
                  { className: 'dshch-hint' },
                  h('span', { className: 'dshch-keyHints' }, t('panel.hint')),
                  entries.length === 0
                    ? null
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshch-clear',
                          onClick: () => {
                            setConfirmClear(true)
                          },
                        },
                        t('panel.clear'),
                      ),
                ),
          ),
        ),
        document.body,
      )
    }

    return h(React.Fragment, null, trigger, palette)
  }

  /**
   * Settings tab: inspect managed prompt records, delete one, or clear all.
   * @param {object} props - managed store, actions and translator.
   * @returns {object} settings surface.
   */
  function SettingsPanel({ settings, actions, t, embedded = false }) {
    const managed = useStoreValue(settings)
    const [expanded, setExpanded] = useState(null)
    const [confirmClear, setConfirmClear] = useState(false)
    useEffect(() => {
      actions.refresh?.()
    }, [])
    const records = managed.records
    return h(
      'section',
      { className: 'dshch-settings' },
      embedded ? null : h('h2', { className: 'dshch-settings-title' }, t('settings.title')),
      h('p', { className: 'dshch-settings-intro' }, t('settings.intro')),
      h(
        'div',
        { className: 'dshch-settings-summary' },
        t('settings.count', { count: records.length }),
      ),
      records.length === 0
        ? h('div', { className: 'dshch-settings-empty' }, t('settings.empty'))
        : h(
            'div',
            { className: 'dshch-settings-list' },
            records.map((record) => {
              const open = expanded === record.key
              return h(
                'div',
                { key: record.key, className: 'dshch-settings-item' },
                h(
                  'div',
                  { className: 'dshch-settings-head' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshch-settings-toggle',
                      'aria-expanded': open,
                      onClick: () => {
                        setExpanded(open ? null : record.key)
                      },
                    },
                    h(
                      'span',
                      { className: 'dshch-settings-session' },
                      record.title === '' ? t('settings.unknownSession') : record.title,
                    ),
                    record.time > 0
                      ? h(
                          'span',
                          { className: 'dshch-settings-time' },
                          new Date(record.time).toLocaleString(),
                        )
                      : null,
                    h(
                      'span',
                      { className: 'dshch-settings-action' },
                      open ? t('settings.collapse') : t('settings.expand'),
                    ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshch-settings-delete',
                      onClick: () => {
                        actions.deleteRecord(record.key)
                      },
                    },
                    h(IconTrashOutlineRegular, { size: 14 }),
                    t('settings.delete'),
                  ),
                ),
                h(
                  'div',
                  {
                    className: open
                      ? 'dshch-settings-text dshch-settings-open'
                      : 'dshch-settings-text',
                  },
                  record.text,
                ),
              )
            }),
          ),
      h(
        'div',
        { className: 'dshch-settings-footer' },
        confirmClear
          ? h(
              React.Fragment,
              null,
              h('span', { className: 'dshch-settings-confirmText' }, t('settings.clearConfirm')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshch-settings-confirm',
                  onClick: () => {
                    actions.clearAll()
                    setConfirmClear(false)
                  },
                },
                t('settings.confirmClear'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshch-settings-cancel',
                  onClick: () => {
                    setConfirmClear(false)
                  },
                },
                t('settings.cancel'),
              ),
            )
          : h(
              'button',
              {
                type: 'button',
                className: 'dshch-settings-clear',
                disabled: records.length === 0,
                onClick: () => {
                  setConfirmClear(true)
                },
              },
              t('settings.clear'),
            ),
      ),
    )
  }

  /** Presentation only; colors and elevation come from the host theme. */
  const CSS = `
.dshch-trigger {
  box-sizing: border-box;
  display: inline-flex;
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
.dshch-trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshch-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dshch-panel {
  position: fixed;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px;
  max-height: min(360px, 60vh);
  overflow: hidden;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--dsw-radius-lg);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
.dshch-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  color: var(--dsw-alias-label-tertiary);
  flex: none;
}
.dshch-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}
.dshch-search input::placeholder {
  color: var(--dsw-alias-label-tertiary);
}
.dshch-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}
.dshch-item {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 34px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  text-align: left;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dshch-item:hover,
.dshch-item[aria-selected="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshch-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
}
.dshch-empty {
  padding: 20px 12px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
  font-size: 13px;
  line-height: 20px;
}
.dshch-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  flex: none;
}
.dshch-hint {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-align: right;
}
.dshch-keyHints { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.dshch-clear,
.dshch-clearConfirm,
.dshch-clearCancel {
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  padding: 2px 6px;
  cursor: pointer;
}
.dshch-clear:hover,
.dshch-clearConfirm:hover,
.dshch-clearCancel:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshch-clearConfirm {
  color: var(--dsw-alias-state-error-primary);
}
.dshch-confirm {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
  justify-content: flex-end;
  text-align: right;
}
.dshch-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 2px 0 20px;
}
.dshch-settings-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}
.dshch-settings-intro {
  margin: 0;
  max-width: 720px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dshch-settings-summary {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dshch-settings-empty {
  padding: 24px 12px;
  border: .5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
  font-size: 13px;
}
.dshch-settings-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.dshch-settings-item {
  box-sizing: border-box;
  min-width: 0;
  overflow: hidden;
  border: .5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.dshch-settings-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}
.dshch-settings-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshch-settings-toggle:hover .dshch-settings-session {
  color: var(--dsw-alias-label-primary);
}
.dshch-settings-session {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshch-settings-time {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}
.dshch-settings-action {
  flex: none;
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}
.dshch-settings-delete {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}
.dshch-settings-delete:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshch-settings-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  padding: 0 10px 10px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  word-break: break-word;
}
.dshch-settings-text.dshch-settings-open {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
}
.dshch-settings-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 28px;
}
.dshch-settings-clear,
.dshch-settings-confirm,
.dshch-settings-cancel {
  padding: 5px 9px;
  border: .5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}
.dshch-settings-clear:hover,
.dshch-settings-confirm:hover,
.dshch-settings-cancel:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshch-settings-confirm {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}
.dshch-settings-clear:disabled {
  cursor: default;
  opacity: .5;
}
.dshch-settings-confirmText {
  flex: 1 1 100%;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
`

  /**
   * Register the history trigger in the composer tool row.
   * @param {object} ctx - Client root context.
   */
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'composer-history: dictionaries')
    const t = ctx.locale.bind(NS)
    ctx.effect(() => {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function')
        return () => {}
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-composer-history'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => {
        style.remove?.()
      }
    }, 'composer-history: styles')

    const managedStore = createManagedStore(readManagedSettings())
    /** Persist and publish one managed-state snapshot. */
    const commitManaged = (next) => {
      writeManagedSettings(next)
      managedStore.set(next)
    }
    const titleOf = (sessionId) => {
      const row = ctx.sessions.list?.getSnapshot?.()?.byId?.[sessionId]
      const title = row?.title ?? row?.displayTitle
      return typeof title === 'string' && title !== '' ? title : sessionId
    }
    /**
     * Read one conversation's visible history and refresh its settings records.
     * @param {string} sessionId - conversation id.
     * @param {object|undefined} binding - Session binding.
     * @returns {Array<object>} newest first.
     */
    const readHistoryFor = (sessionId, binding) => {
      const managed = managedStore.getSnapshot()
      const visible = visiblePrompts(readPrompts(binding, sessionId), managed)
      const merged = mergeRecords(managed, sessionId, titleOf(sessionId), visible)
      if (merged !== null) commitManaged(merged)
      return visible
    }
    /**
     * Clear one conversation's history from this plugin by cutting off every
     * previously recorded prompt (Host messages are not modified).
     * @param {string} sessionId - conversation id.
     */
    const clearHistoryFor = (sessionId) => {
      const managed = managedStore.getSnapshot()
      const cutoff = Date.now()
      commitManaged({
        ...managed,
        clearedSessions: {
          ...managed.clearedSessions,
          [sessionId]: Math.max(cutoff, managed.clearedSessions[sessionId] ?? 0),
        },
        records: managed.records.filter((record) => record.sessionId !== sessionId),
        hidden: managed.hidden.filter((key) => !key.startsWith(sessionId + ':')),
      })
    }
    /** Rebuild the settings record cache from currently retained Sessions. */
    const refreshRecords = () => {
      let managed = managedStore.getSnapshot()
      const state = ctx.sessions.list?.getSnapshot?.()
      const ids = Array.isArray(state?.ids) ? state.ids : Object.keys(state?.byId ?? {})
      for (const id of ids) {
        let binding
        try {
          binding = ctx.sessions.binding(id)
        } catch {
          binding = undefined
        }
        if (binding === undefined) continue
        const visible = visiblePrompts(readPrompts(binding, id), managed)
        managed = mergeRecords(managed, id, titleOf(id), visible) ?? managed
      }
      if (managed !== managedStore.getSnapshot()) commitManaged(managed)
    }
    const deleteRecord = (key) => {
      const managed = managedStore.getSnapshot()
      if (!managed.records.some((record) => record.key === key)) return
      commitManaged({
        ...managed,
        hidden: [...new Set([...managed.hidden, key])].slice(-HIDDEN_LIMIT),
        records: managed.records.filter((record) => record.key !== key),
      })
    }
    const clearAll = () => {
      commitManaged({ ...EMPTY_MANAGED, clearedAt: Date.now() })
    }

    ctx.slots.inject('conversation.input.left', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.left',
          id: 'composer-history.trigger',
          order: 40,
          locale: NS,
          inject: (sessionId) => {
            let binding
            let shell
            try {
              binding = ctx.sessions.binding(sessionId)
              const scope = ctx.sessions.scope(sessionId)
              const conversation = scope?.get('conversation')
              shell = conversation?.input?.for?.(scope)
            } catch {
              binding = undefined
              shell = undefined
            }
            return {
              sessionId,
              actions: {
                /** @returns {Array<{id: string, text: string}>} newest visible first. */
                readHistory: () => readHistoryFor(sessionId, binding),
                /** Hide all history recorded before this moment for this conversation. */
                clearHistory: () => {
                  clearHistoryFor(sessionId)
                },
                /** @returns {string} current draft text, or an empty string without a shell. */
                readDraft: () => {
                  try {
                    return typeof shell?.snapshot?.draft === 'string' ? shell.snapshot.draft : ''
                  } catch {
                    return ''
                  }
                },
                /** @param {string} text - text to place into the composer. */
                setDraft: (text) => {
                  try {
                    shell?.actions?.setDraft?.(text)
                  } catch {
                    // A disposed scope leaves the compositor unchanged; the panel
                    // still closes so a stale click cannot wedge the UI.
                  }
                },
              },
            }
          },
        },
        ComposerHistory,
      ),
    )

    // Merged settings shell: this page becomes the prompt-history tab in
    // Settings -> Codex Style instead of a standalone Built-in plugins tab.
    env.registerSettingsPage({
      id: 'dsh-composer-history',
      title: () => t('settings.title'),
      render: () =>
        h(SettingsPanel, {
          embedded: true,
          settings: managedStore,
          actions: {
            refresh: refreshRecords,
            deleteRecord,
            clearAll,
          },
          t,
        }),
    })
  }

  return {
    /** Services this Client plugin waits for before applying. */
    inject: ['slots', 'locale', 'sessions'],
    apply,
  }
})
