/** Cross-area contract. Providers own operations; the toolbar owns selection DOM. */
env.selectionActions = (() => {
  const actions = new Map()
  const listeners = new Set()
  const reported = new WeakSet()
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[codex-workbench] selection subscriber failed:', error)
      }
    }
  }
  const supported = (action, context) => {
    try {
      return action.supports?.(context) !== false
    } catch (error) {
      if (!reported.has(action)) {
        reported.add(action)
        console.error('[codex-workbench] selection action unavailable:', action.id, error)
      }
      return false
    }
  }
  return {
    register(action) {
      if (actions.has(action.id)) throw new Error('Duplicate selection action: ' + action.id)
      actions.set(action.id, action)
      notify()
      return () => {
        if (actions.get(action.id) === action) {
          actions.delete(action.id)
          notify()
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    available(context) {
      const value = Object.freeze({ sessionId: context.sessionId, text: context.text })
      return [...actions.values()]
        .filter((action) => supported(action, value))
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    },
    async invoke(id, context) {
      const action = actions.get(id)
      if (action === undefined || !supported(action, context)) return false
      try {
        return (
          (await action.run(
            Object.freeze({ sessionId: context.sessionId, text: context.text }),
          )) !== false
        )
      } catch (error) {
        console.error('[codex-workbench] selection action failed:', id, error)
        return false
      }
    },
  }
})()
