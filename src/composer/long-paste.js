/**
 * dsh-long-paste 2.0.0 — merged feature of dsh-codex-style.
 *
 * Plain-text pastes at or above the threshold are written by the Host into the
 * plugin's temporary paste folder and inserted as a native `@path` file
 * reference, so the composer shows an ordinary file chip whose click opens the
 * side-panel preview. The Host empties that folder once per DSH start and prunes
 * the oldest files past its cap, so the pasteboard never grows without bound.
 */
__DSH_FEATURE('dsh-long-paste', function (require, env) {
  const React = require('react')
  const { useEffect } = React

  /** Locale namespace owned by this plugin. */
  const NS = 'longPaste'

  /** Same-origin Host route that stores one pasted text. */
  const PASTEBOARD_PATH = '/dsh-codex-style/pasteboard'

  /** Plain-text pastes at or above this many characters become file chips. */
  const THRESHOLD = 2000

  const zh = {
    'toast.failed': '无法把长文本保存为临时文件并加入输入框，请重试',
  }

  const en = {
    'toast.failed': 'Could not save the long pasted text as a temporary file; try again',
  }

  /** @param {unknown} target - event target. @returns {Element|null} composer owner. */
  function ownerOf(target) {
    if (target === null || target === undefined || typeof target !== 'object') return null
    return target.closest?.('[data-conversation-session]') ?? null
  }

  /** @param {unknown} target - event target. @returns {Element|null} editable composer. */
  function editorOf(target) {
    if (target === null || target === undefined || typeof target !== 'object') return null
    return target.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"]') ?? null
  }

  /** @param {string} path @returns {string} path inside a reference mention. */
  function mentionOf(path) {
    return /\s/u.test(path) ? '@"' + path.replace(/"/g, '\\"') + '"' : '@' + path
  }

  /** @param {string} path @returns {string} final path segment. */
  function labelOf(path) {
    const trimmed = path.replace(/[\\/]+$/, '')
    const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
    return trimmed.slice(index + 1) || trimmed
  }

  /**
   * Build the Host reference chip for one saved temporary file.
   * @param {{ path: string, name?: string }} saved - Host response.
   * @returns {{ mention: string, reference: object }} mention and reference.
   */
  function referenceOf(saved) {
    const mention = mentionOf(saved.path)
    return {
      mention,
      reference: {
        source: 'reference',
        ref: mention,
        label: typeof saved.name === 'string' && saved.name !== '' ? saved.name : labelOf(saved.path),
        appearance: 'file',
        clipboardText: mention,
      },
    }
  }

  /**
   * Ask the Host to persist one pasted text.
   * @param {string} text - pasted plain text.
   * @returns {Promise<{ path: string, name?: string }>} saved file identity.
   */
  async function savePaste(text) {
    const response = await fetch(PASTEBOARD_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const payload = await response.json()
    if (payload?.ok !== true || typeof payload.path !== 'string' || payload.path === '') {
      throw new Error('pasteboard rejected the text')
    }
    return { path: payload.path, name: payload.name }
  }

  /**
   * Invisible per-session layer. It only installs one document capture
   * listener, so a long paste never reaches the Lexical editor.
   * @param {object} props - session id and injected actions.
   * @returns {null} no React output.
   */
  function LongPasteLayer({ sessionId, actions, t }) {
    useEffect(() => {
      const onPaste = (event) => {
        if (event.defaultPrevented === true) return
        if (!actions.canEdit()) return
        const data = event.clipboardData
        if (data === null || data === undefined) return
        if ((data.files?.length ?? 0) > 0) return
        const text = typeof data.getData === 'function' ? data.getData('text/plain') : ''
        if (typeof text !== 'string' || text.length < THRESHOLD) return
        const target = event.target
        if (ownerOf(target)?.getAttribute?.('data-conversation-session') !== sessionId) return
        if (editorOf(target) === null) return
        if (
          target.closest?.('[data-queue-dock]') !== null &&
          target.closest?.('[data-queue-dock]') !== undefined
        )
          return
        event.preventDefault?.()
        event.stopPropagation?.()
        event.stopImmediatePropagation?.()
        void actions.attach(text, t('toast.failed'))
      }
      document.addEventListener('paste', onPaste, true)
      return () => document.removeEventListener('paste', onPaste, true)
    }, [sessionId, actions, t])
    return null
  }

  /** Register the long-paste layer on every session composer. */
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'long-paste: dictionaries')
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'long-paste.layer',
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
                const notify = (text) => {
                  try {
                    shell?.notify?.('error', text)
                  } catch {
                    // A disposed scope loses the non-critical notice.
                  }
                }
                const restoreInline = (text) => {
                  try {
                    if (typeof shell?.actions?.setDraft !== 'function') return false
                    const previous =
                      typeof shell?.snapshot?.draft === 'string' ? shell.snapshot.draft : ''
                    shell.actions.setDraft(
                      previous.trim() === ''
                        ? text
                        : previous.replace(/\s+$/, '') + '\n\n' + text,
                    )
                    return true
                  } catch {
                    return false
                  }
                }
                return {
                  sessionId,
                  actions: {
                    canEdit: () => !['adjudicating', 'submitting'].includes(shell?.snapshot?.phase),
                    /**
                     * Store a long paste as a temporary Host file and insert it
                     * as a native file reference chip.
                     * @param {string} text - pasted plain text.
                     * @param {string} failed - localized failure text.
                     * @returns {Promise<boolean>} whether the chip was inserted.
                     */
                    attach: async (text, failed) => {
                      try {
                        const saved = await savePaste(text)
                        if (typeof shell?.addFiles !== 'function')
                          throw new Error('composer unavailable')
                        const built = referenceOf(saved)
                        if (shell.addFiles([built.reference], []) !== true)
                          throw new Error('composer refused the reference')
                        return true
                      } catch {
                        // The default paste was already suppressed; put the text
                        // back inline so a failed save never loses the paste.
                        if (!restoreInline(text)) notify(failed)
                        return false
                      }
                    },
                  },
                }
              },
            },
            LongPasteLayer,
          ),
        ),
      'long-paste: composer layer',
    )
  }

  return {
    inject: ['slots', 'locale', 'sessions'],
    apply,
    __test: { mentionOf, labelOf, referenceOf, savePaste },
  }
})
