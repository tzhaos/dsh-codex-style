/** Empty-composer continuation through DSH's ordinary prompt admission. */
__DSH_FEATURE('dsh-continue', function (require, env) {
  const React = require('react')
  const { createPortal } = require('react-dom')
  const { Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')
  const { useLayoutEffect, useRef, useState } = React
  const h = React.createElement
  const NS = 'continueConversation'
  const STORAGE_PREFIX = 'dsh.codexStyle.continue.'
  const zh = {
    label: '继续',
    pending: '正在继续',
    uncertain: '等待确认',
    unknown: '继续请求的结果尚未确认。连接恢复后会核对，请勿重复发送。',
    failed: '继续失败，请稍后重试。',
    prompt: '继续',
  }
  const en = {
    label: 'Continue',
    pending: 'Continuing',
    uncertain: 'Awaiting confirmation',
    unknown:
      'The continue request is unconfirmed. It will be reconciled after reconnection; do not resend it.',
    failed: 'Could not continue. Try again later.',
    prompt: 'Continue.',
  }

  /** Fail closed until both the Session and the composer have settled. */
  function eligible(state) {
    const { session, input } = state
    return (
      !!session &&
      !!input &&
      state.current === true &&
      state.connected === true &&
      session.openState === 'open' &&
      session.blank === false &&
      session.running === false &&
      session.removed === false &&
      session.subagent === null &&
      session.awaitingFirstTurn !== true &&
      (session.pendingSubmissions?.length ?? 0) === 0 &&
      !state.blocked &&
      !state.interaction &&
      !state.quotes &&
      ['next-turn', 'next-step'].every((target) => (state.inbox?.[target]?.length ?? 0) === 0) &&
      input.phase === 'plain' &&
      typeof input.draft === 'string' &&
      input.draft.trim() === '' &&
      Array.isArray(input.attachmentIds) &&
      input.attachmentIds.length === 0
    )
  }

  function eventsOf(binding) {
    return binding.eventSource?.getSnapshot?.()?.entries ?? []
  }

  const eventOf = (entry) => entry.event ?? entry
  const logOf = (state) =>
    typeof state.events === 'function' ? state.events() : (state.events ?? [])
  const historyGap = (state, request) => {
    const entries = logOf(state)
    return (
      entries.length > 0 && eventOf(entries[0]).seq > (request.cursor ?? request.fromSeq ?? 0) + 1
    )
  }
  const queued = (state, request) =>
    !!request &&
    ['next-turn', 'next-step'].some((name) =>
      (state.inbox?.[name] ?? []).some((item) => item.source?.rpcId === request.id),
    )

  /** Track one occurrence through durable positional splices, then its Turn. */
  function evidence(state, request) {
    if (historyGap(state, request)) return false
    const entries = logOf(state)
    let low = 0,
      high = entries.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (eventOf(entries[mid]).seq <= (request.cursor ?? request.fromSeq ?? 0)) low = mid + 1
      else high = mid
    }
    for (let index = low; index < entries.length; index++) {
      const event = eventOf(entries[index])
      request.cursor = event.seq
      if (event.type === 'turn/start') request.currentTurn = event.data.turn
      else if (event.type === 'agent/inbox/spliced') {
        const { target, start, removedCount = 0, inserted = [], outcome } = event.data
        const match = inserted.findIndex((item) => item.source?.rpcId === request.id)
        const slot = request.slot
        if (match >= 0) request.slot = { target, index: start + match, id: inserted[match].id }
        else if (slot?.target === target && slot.index >= start) {
          if (slot.index < start + removedCount) {
            request.slot = null
            if (outcome === 'canceled') return true
            request.claimedTurn = request.currentTurn
          } else request.slot = { ...slot, index: slot.index + inserted.length - removedCount }
        }
      } else if (event.type === 'user/message' && event.data?.source?.rpcId === request.id) {
        request.claimedTurn = request.currentTurn
      } else if (event.type === 'turn/end') {
        if (request.claimedTurn !== undefined && event.data.turn === request.claimedTurn)
          return true
        if (event.data.turn === request.currentTurn) request.currentTurn = undefined
      }
    }
    return false
  }

  /** One admission owner shared by every mounted view of the same binding. */
  function createController(ports) {
    let request = ports.load?.() ?? null
    if (request) request = { ...request, phase: 'uncertain' }
    let flight = null
    let cancelFlight = () => {}
    let historyFlight = null
    let historyAttempt = null
    let disposed = false
    const listeners = new Set()
    const publish = () => {
      for (const listener of [...listeners]) listener()
    }
    const forget = () => {
      const id = request?.id
      request = null
      ports.save?.(null, id)
    }
    const reconcile = () => {
      if (!request) return
      const { cursor: _cursor, ...before } = request
      if (evidence(ports.read(), request)) {
        forget()
        return
      }
      const { cursor: _nextCursor, ...after } = request
      if (JSON.stringify(before) !== JSON.stringify(after)) ports.save?.(request)
    }
    const recover = () => {
      const state = ports.read()
      if (
        !request ||
        disposed ||
        !state.connected ||
        state.session?.openState !== 'open' ||
        state.session.loadingOlder ||
        !ports.recover ||
        historyFlight ||
        !historyGap(state, request)
      )
        return
      const boundary = request.cursor ?? request.fromSeq ?? 0
      const key = (state.generation?.id ?? '') + ':' + boundary + ':' + eventOf(logOf(state)[0]).seq
      if (historyAttempt === key) return
      historyAttempt = key
      historyFlight = Promise.resolve()
        .then(() => ports.recover(boundary))
        .catch(() => {})
        .finally(() => {
          historyFlight = null
          if (!disposed) {
            reconcile()
            publish()
          }
        })
    }
    return {
      snapshot() {
        reconcile()
        return {
          available: eligible(ports.read()),
          pending: flight !== null || request?.phase === 'accepted',
          uncertain: request?.phase === 'uncertain',
          queued: queued(ports.read(), request),
        }
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      changed() {
        if (!disposed) {
          reconcile()
          recover()
          publish()
        }
      },
      async run(text, ready = () => true) {
        reconcile()
        if (disposed || flight || request || !eligible(ports.read()) || !ready()) return false
        const entries = logOf(ports.read())
        const fromSeq = entries.length ? eventOf(entries.at(-1)).seq : 0
        const operation = { id: ports.id(), phase: 'admitting', fromSeq, cursor: fromSeq }
        request = operation
        ports.save?.(operation)
        // Set the latch before invoking a method that can publish synchronously.
        flight = operation
        publish()
        const abort = new AbortController()
        let timer
        try {
          if (!eligible(ports.read()) || !ready()) {
            forget()
            return false
          }
          const expired = new Promise((resolve) => {
            cancelFlight = () => {
              abort.abort()
              resolve({ ok: false, error: { code: 'gateway/timeout' } })
            }
            timer = (ports.setTimeout ?? setTimeout)(cancelFlight, 30000)
          })
          const result = await Promise.race([
            ports.prompt(text, operation.id, abort.signal),
            expired,
          ])
          if (disposed || request !== operation) return result?.ok === true
          reconcile()
          if (request !== operation) return true
          if (result?.ok === true) operation.phase = 'accepted'
          else if (
            result?.ok === false &&
            typeof result.error?.code === 'string' &&
            !/^gateway\/(?:internal|cancelled|timeout|disconnected|unavailable)$/.test(
              result.error.code,
            )
          ) {
            forget()
            ports.notice?.('error', 'failed')
            return false
          } else {
            operation.phase = 'uncertain'
            ports.notice?.('info', 'unknown')
          }
          ports.save?.(operation)
          reconcile()
          return result?.ok === true
        } catch {
          if (!disposed && request === operation) {
            reconcile()
            if (request === operation) {
              operation.phase = 'uncertain'
              ports.save?.(operation)
              ports.notice?.('info', 'unknown')
            }
          }
          return false
        } finally {
          if (timer !== undefined) (ports.clearTimeout ?? clearTimeout)(timer)
          cancelFlight = () => {}
          if (flight === operation) flight = null
          if (!disposed) publish()
        }
      },
      dispose() {
        disposed = true
        if (request) ports.save?.({ ...request, phase: 'uncertain' })
        cancelFlight()
        listeners.clear()
      },
    }
  }

  /** Persist only an unresolved identity; no draft text or attachment data. */
  function storage(sessionId) {
    const key = STORAGE_PREFIX + sessionId
    return {
      load() {
        try {
          const value = JSON.parse(sessionStorage.getItem(key) ?? 'null')
          if (!value || typeof value.id !== 'string' || value.id.length > 100) return null
          return {
            id: value.id,
            phase: value.phase,
            fromSeq: Number.isSafeInteger(value.fromSeq) ? value.fromSeq : 0,
            cursor: Number.isSafeInteger(value.cursor) ? value.cursor : 0,
            currentTurn: Number.isSafeInteger(value.currentTurn) ? value.currentTurn : undefined,
            claimedTurn: Number.isSafeInteger(value.claimedTurn) ? value.claimedTurn : undefined,
            slot:
              value.slot &&
              ['next-turn', 'next-step'].includes(value.slot.target) &&
              Number.isSafeInteger(value.slot.index) &&
              typeof value.slot.id === 'string'
                ? value.slot
                : null,
          }
        } catch {
          return null
        }
      },
      save(value, expectedId) {
        try {
          if (value) sessionStorage.setItem(key, JSON.stringify(value))
          else if (
            !expectedId ||
            JSON.parse(sessionStorage.getItem(key) ?? 'null')?.id === expectedId
          )
            sessionStorage.removeItem(key)
        } catch {
          /* The in-memory admission latch remains authoritative in this view. */
        }
      },
    }
  }

  function ContinueButton({ sessionId, controller, sources, t }) {
    const anchor = useRef(null)
    const [surface, setSurface] = useState(null)
    const [, refresh] = useState(0)
    const state = controller.snapshot()
    useLayoutEffect(() => {
      const changed = () => {
        controller.changed()
        refresh((value) => value + 1)
      }
      const off = [
        controller.subscribe(() => refresh((value) => value + 1)),
        ...sources.map((source) => source?.subscribe?.(changed)).filter(Boolean),
      ]
      changed()
      return () => {
        for (const dispose of off) dispose()
      }
    }, [controller, sources])
    useLayoutEffect(() => {
      const card = anchor.current?.closest('[data-composer-card]')
      if (!card) return
      let mounted = null
      const update = () => {
        const button = [...card.querySelectorAll('button.RlGAzG_primary')]
          .filter((node) => !node.hasAttribute('data-dsh-continue'))
          .at(-1)
        if (mounted?.button === button) return
        if (mounted) {
          mounted.button.removeAttribute('data-dshc-hidden')
          mounted.mount.remove()
        }
        mounted = null
        if (button?.parentElement) {
          const mount = document.createElement('span')
          mount.className = 'dshc-mount'
          button.parentElement.insertBefore(mount, button)
          mounted = { button, mount, card }
        }
        setSurface(mounted)
      }
      const observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.type === 'attributes'))
          refresh((value) => value + 1)
        update()
      })
      observer.observe(card, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['contenteditable', 'data-composer-composing'],
      })
      update()
      return () => {
        observer.disconnect()
        if (mounted) {
          mounted.button.removeAttribute('data-dshc-hidden')
          mounted.mount.remove()
        }
      }
    }, [sessionId])
    const ready = () =>
      !!surface?.card.isConnected &&
      surface.card.querySelector('[contenteditable="true"]') !== null &&
      surface.card.querySelector('[data-composer-composing]') === null &&
      surface.card.closest('[inert]') === null
    const visible = state.available && !state.queued && ready()
    useLayoutEffect(() => {
      if (!surface) return
      surface.button.toggleAttribute('data-dshc-hidden', visible)
      return () => surface.button.removeAttribute('data-dshc-hidden')
    }, [surface, visible])
    const label = t(state.uncertain ? 'uncertain' : state.pending ? 'pending' : 'label')
    return h(
      React.Fragment,
      null,
      h('span', { ref: anchor, 'data-dshc-anchor': sessionId }),
      !visible || !surface
        ? null
        : createPortal(
            h(
              Tooltip,
              {
                label: t(state.uncertain ? 'unknown' : 'label'),
                portal: true,
                side: 'top',
                delayMs: 500,
              },
              h(
                'button',
                {
                  type: 'button',
                  className: 'RlGAzG_primary dshc-button',
                  'data-dsh-continue': '',
                  'aria-label': label,
                  'aria-busy': state.pending || undefined,
                  disabled: state.pending || state.uncertain,
                  onMouseDown: (event) => {
                    if (event.button === 0) event.preventDefault()
                  },
                  onClick: () => {
                    surface.card.querySelector('[contenteditable="true"]')?.focus()
                    void controller.run(t('prompt'), ready)
                  },
                },
                h(
                  'svg',
                  {
                    width: 16,
                    height: 16,
                    viewBox: '0 0 16 16',
                    fill: 'currentColor',
                    'aria-hidden': true,
                  },
                  h('path', {
                    d: 'M4.6 2.7c-.9-.5-2 .1-2 1.2v8.2c0 1.1 1.1 1.7 2 1.2l7.3-4.1c1-.5 1-1.9 0-2.4Z',
                  }),
                ),
              ),
            ),
            surface.mount,
          ),
    )
  }

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'continue: locale')
    ctx.effect(() => {
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-continue'
      style.textContent =
        '[data-dshc-hidden] { display: none !important; } .dshc-mount { display: contents; } .dshc-button > svg { display: block; flex: none; transform: translateX(1px); }'
      document.head.append(style)
      return () => style.remove()
    }, 'continue: styles')
    const controllers = new WeakMap()
    const owned = new Map()
    ctx.effect(() => {
      const prune = () => {
        for (const [controller, entry] of owned)
          if (ctx.sessions.binding(entry.id) !== entry.binding) {
            controller.dispose()
            controllers.delete(entry.binding)
            owned.delete(controller)
          }
      }
      const off = ctx.sessions.list?.subscribe?.(prune)
      return () => {
        off?.()
        for (const controller of owned.keys()) controller.dispose()
        owned.clear()
      }
    }, 'continue: admission owners')
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.input.overlay', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.overlay',
              id: 'continue',
              locale: NS,
              order: 60,
              inject(sessionId) {
                const binding = ctx.sessions.binding(sessionId)
                const scope = ctx.sessions.scope(sessionId)
                const conversation = scope?.get('conversation')
                const shell = conversation?.input?.for?.(scope)
                if (!binding || !shell)
                  throw new Error('Continue requires a retained Session and input shell')
                const block = conversation.blocks?.storeFor?.(sessionId)
                const inbox = binding.session.projections?.faceOf?.('inbox')
                const generation = ctx.connection.generation
                const status = ctx.uiSession.sessionStatus
                const read = () => ({
                  current: ctx.sessions.binding(sessionId) === binding,
                  connected: generation.getSnapshot() !== undefined,
                  generation: generation.getSnapshot(),
                  session: binding.session.getSnapshot(),
                  input: shell.snapshot,
                  blocked: block?.getSnapshot(),
                  interaction: status?.getSnapshot().get(sessionId)?.pendingInteraction,
                  quotes: env.selectionQuoteState?.has(sessionId) === true,
                  events: () => eventsOf(binding),
                  inbox: inbox?.getSnapshot(),
                })
                let controller = controllers.get(binding)
                if (!controller) {
                  const persisted = storage(sessionId)
                  controller = createController({
                    read,
                    ...persisted,
                    id: () => crypto.randomUUID(),
                    recover: (seq) => binding.session.loadThrough(seq),
                    prompt: (text, requestId, signal) =>
                      binding.session.prompt([{ type: 'text', text }], 'queue', signal, requestId),
                    notice: (level, key) => {
                      if (ctx.sessions.binding(sessionId) === binding)
                        shell.notify(level, ctx.locale.bind(NS)(key))
                    },
                  })
                  controllers.set(binding, controller)
                  owned.set(controller, { id: sessionId, binding })
                }
                return {
                  sessionId,
                  controller,
                  sources: [
                    binding.session,
                    shell.state,
                    binding.eventSource,
                    inbox,
                    generation,
                    status,
                    block,
                    env.selectionQuoteState,
                  ].filter(Boolean),
                }
              },
            },
            ContinueButton,
          ),
        ),
      'continue: primary action',
    )
  }
  return {
    inject: ['slots', 'locale', 'sessions', 'connection', 'uiSession'],
    apply,
    __test: { eligible, evidence, createController },
  }
})
