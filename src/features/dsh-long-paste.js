/**
 * dsh-long-paste 1.1.1 — merged feature of dsh-codex-style.
 *
 * Source: dsh-plugins/6cebd96 packages/dsh-long-paste/client.js (verbatim body).
 * The factory wrapper is provided by scripts/build-client.mjs; the body still
 * returns { inject, apply } and is only built when the feature is enabled.
 */
__DSH_FEATURE('dsh-long-paste', function (require, env) {
    const React = require('react')
    const { useEffect } = React
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'longPaste'

    /** Plain-text pastes at or above this many characters become attachments. */
    const THRESHOLD = 2000

    const zh = {
      'toast.failed': '无法把长文本添加为附件，请重试',
      'action.show': '在文本框中显示',
      'toast.expandFailed': '无法展开长文本',
      'toast.removeFailed': '无法移除临时附件，请重试',
    }

    const en = {
      'toast.failed': 'Could not add the long pasted text as an attachment; try again',
      'action.show': 'Show in text field',
      'toast.expandFailed': 'Could not expand the pasted text',
      'toast.removeFailed': 'Could not remove the temporary attachment; try again',
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

    /**
     * Name a generated attachment so the file card is readable in the rail.
     * @param {string} text - pasted text.
     * @returns {string} file name.
     */
    let pasteSequence = 0

    function attachmentName(text) {
      const count = text.length.toLocaleString('en-US')
      pasteSequence += 1
      return 'Pasted text (' + count + ' chars) ' + pasteSequence + '.txt'
    }

    /** Long pastes that still have their full text available for expansion. */
    const pastes = new Map()

    /** @param {string} name - attachment name. @returns {object|null} record. */
    function recordOf(name) {
      return pastes.get(name) ?? null
    }

    /**
     * Find the host attachment card that displays one generated file name.
     * @param {string} sessionId - owning session.
     * @param {string} name - generated file name.
     * @returns {Element|null} card-like element.
     */
    function cardOf(sessionId, name) {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null
      let owner = null
      for (const node of document.querySelectorAll('[data-conversation-session]')) {
        if (node.getAttribute?.('data-conversation-session') === sessionId) { owner = node; break }
      }
      const root = owner ?? document
      if (typeof root.querySelectorAll !== 'function') return null
      for (const node of root.querySelectorAll('[data-composer-card] *')) {
        const text = typeof node.textContent === 'string' ? node.textContent.trim() : ''
        const title = node.getAttribute?.('title') ?? ''
        const aria = node.getAttribute?.('aria-label') ?? ''
        if (text !== name && !title.includes(name) && !aria.includes(name)) continue
        return node.closest?.('button, [role="button"], [class*="attachment" i], [class*="file" i]')
          ?? node.parentElement
          ?? null
      }
      return null
    }

    /**
     * Put one "show in text field" action next to a long-paste attachment card.
     * @param {Element} card - host card.
     * @param {object} record - paste record.
     * @param {object} actions - injected actions.
     * @param {Function} t - translator.
     */
    function decorateCard(card, record, actions, t) {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return
      if (record.id === undefined) return
      const marker = 'data-dshlp-for'
      if (typeof document.querySelector === 'function'
        && document.querySelector('[' + marker + '="' + record.id + '"]') !== null) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dshlp-show'
      button.setAttribute(marker, record.id)
      button.title = t('action.show')
      button.textContent = t('action.show')
      button.addEventListener('click', (event) => {
        event.preventDefault?.()
        event.stopPropagation?.()
        void actions.showInText(record.name, t('toast.expandFailed'), t('toast.removeFailed'))
      })
      const parent = card.parentElement
      if (parent === null || parent === undefined) return
      if (typeof card.insertAdjacentElement === 'function') card.insertAdjacentElement('afterend', button)
      else parent.appendChild?.(button)
    }

    /**
     * Scan the current composer for long-paste cards and add the expansion
     * action. Runs from the observer and a slow interval because the host rail
     * can re-render while the upload state changes.
     * @param {string} sessionId - owning session.
     * @param {object} actions - injected actions.
     * @param {Function} t - translator.
     */
    function decoratePastes(sessionId, actions, t) {
      for (const record of pastes.values()) {
        if (record.sessionId !== sessionId) continue
        const card = cardOf(sessionId, record.name)
        if (card !== null && card !== undefined) decorateCard(card, record, actions, t)
      }
    }

    /**
     * Invisible per-session layer. It only installs one document capture
     * listener, so a long paste never reaches the Lexical editor.
     * @param {object} props - session id, injected actions and translator.
     * @returns {null} no React output.
     */
    function LongPasteLayer({ sessionId, actions, t }) {
      useEffect(() => {
        const onPaste = (event) => {
          if (event.defaultPrevented === true) return
          const data = event.clipboardData
          if (data === null || data === undefined) return
          if ((data.files?.length ?? 0) > 0) return
          const text = typeof data.getData === 'function' ? data.getData('text/plain') : ''
          if (typeof text !== 'string' || text.length < THRESHOLD) return
          const target = event.target
          if (ownerOf(target)?.getAttribute?.('data-conversation-session') !== sessionId) return
          if (editorOf(target) === null) return
          if (target.closest?.('[data-queue-dock]') !== null && target.closest?.('[data-queue-dock]') !== undefined) return
          event.preventDefault?.()
          event.stopPropagation?.()
          event.stopImmediatePropagation?.()
          void actions.attach(text, t('toast.failed'))
        }
        document.addEventListener('paste', onPaste, true)
        return () => document.removeEventListener('paste', onPaste, true)
      }, [sessionId, actions, t])

      useEffect(() => {
        const scan = () => decoratePastes(sessionId, actions, t)
        const observer = typeof MutationObserver === 'function' ? new MutationObserver(scan) : null
        observer?.observe(document.body, { childList: true, subtree: true })
        const interval = setInterval(scan, 500)
        scan()
        return () => {
          observer?.disconnect()
          clearInterval(interval)
          for (const button of document.querySelectorAll?.('[data-dshlp-for]') ?? []) button.remove?.()
        }
      }, [sessionId, actions, t])
      return null
    }

    /** Styles for the injected expansion action. */
    const CSS = `
.dshlp-show {
  box-sizing: border-box;
  flex: none;
  height: 22px;
  padding: 0 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}
.dshlp-show:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
`
    /** Register the long-paste layer on every session composer. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'long-paste: dictionaries')
      ctx.effect(() => {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') return () => {}
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'dsh-long-paste'
        style.textContent = CSS
        document.head?.appendChild?.(style)
        return () => style.remove?.()
      }, 'long-paste: styles')
      ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
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
          return {
            sessionId,
            actions: {
              /**
               * Add pasted long text as a browser draft file attachment.
               * @param {string} text - pasted plain text.
               * @param {string} failed - localized failure text.
               * @returns {Promise<boolean>} whether the attachment was added.
               */
              attach: async (text, failed) => {
                try {
                  if (typeof File !== 'function'
                    || typeof conversation?.createDrafts !== 'function'
                    || typeof shell?.actions?.addAttachments !== 'function') return false
                  const name = attachmentName(text)
                  const file = new File([text], name, { type: 'text/plain' })
                  const drafts = conversation.createDrafts(sessionId, [file])
                  const ids = drafts.map((draft) => draft?.id).filter((id) => typeof id === 'string')
                  if (ids.length !== 1 || shell.actions.addAttachments(ids) !== true) throw new Error('attachment rejected')
                  pastes.set(name, { sessionId, id: ids[0], name, text })
                  return true
                } catch {
                  notify(failed)
                  return false
                }
              },
              /**
               * Replace one long-paste attachment with its full text in the composer.
               * @param {string} name - generated attachment name.
               * @returns {boolean} whether the expansion succeeded.
               */
              showInText: (name, expandFailed, removeFailed) => {
                const record = recordOf(name)
                if (record === null || record.sessionId !== sessionId) return false
                let previous = ''
                try {
                  previous = typeof shell?.snapshot?.draft === 'string' ? shell.snapshot.draft : ''
                  const next = previous.trim() === '' ? record.text : previous.replace(/\s+$/, '') + '\n\n' + record.text
                  shell?.actions?.setDraft?.(next)
                } catch {
                  notify(expandFailed)
                  return false
                }
                try {
                  shell?.actions?.removeAttachment?.(record.id)
                  conversation?.releaseDraftAttachment?.(record.id)
                } catch {
                  try { shell?.actions?.setDraft?.(previous) } catch { /* best-effort rollback */ }
                  notify(removeFailed)
                  return false
                }
                pastes.delete(name)
                if (typeof document !== 'undefined') {
                  document.querySelector?.('[data-dshlp-for="' + record.id + '"]')?.remove?.()
                }
                return true
              },
            },
          }
        },
      }, LongPasteLayer)))
    }

    return {
      inject: ['slots', 'locale', 'sessions'],
      apply,
    }
})
