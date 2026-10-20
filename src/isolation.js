/**
 * Per-feature runtime for the merged bundle: build, dependency resolution,
 * error-boundary wrapping, quarantine and status reporting.
 *
 * The requirement is that one merged feature can fail without taking the others
 * down. Isolation happens on three levels:
 *
 *   1. build      — a feature whose lazy builder throws is reported and skipped;
 *   2. apply      — every feature applies on its own disposable scope, so a
 *                   throwing `apply`/effect is quarantined with its listeners
 *                   and slot registrations removed, and the rest keep running;
 *   3. render     — every component a feature registers in a slot is wrapped in
 *                   a React error boundary owned by that feature. A render or
 *                   lifecycle crash renders nothing for that feature, schedules
 *                   a quarantine and leaves the host tree and other features up.
 *
 * Features may declare `requires: [featureId, ...]` in the module they return.
 * A dependent feature is skipped when a required feature failed to build or was
 * quarantined; a hard dependency therefore fails closed instead of corrupting
 * the UI. Platform modules and services listed in `dsh.client.inject` remain
 * the bundle-level hard dependency.
 *
 * The package checks drive the same code with a synthetic feature table through
 * the `__DSH_CODEX_STYLE_FEATURES__` / `__DSH_CODEX_STYLE_ISOLATION__` test
 * hooks, so isolation is exercised without loading the host.
 */

/**
 * Create the per-feature runtime for one bundle materialization.
 * @param {Function} require - bundle module require function.
 * @param {object} env - shared feature environment from the bundle prologue.
 * @param {{ id: string, build: Function }[]} featureTable - lazy feature table.
 * @returns {object} runtime with build/apply/status/report helpers.
 */
function __dshCreateRuntime(require, env, featureTable) {
  /** @type {string[] | null} check-only feature filter, absent in the shipped page. */
  const filter = typeof __DSH_CODEX_STYLE_FEATURES__ !== 'undefined'
    && Array.isArray(__DSH_CODEX_STYLE_FEATURES__)
    ? __DSH_CODEX_STYLE_FEATURES__
    : null
  /** @type {boolean} render/apply isolation; legacy single-feature checks can opt out. */
  const isolationEnabled = filter === null
    || (typeof __DSH_CODEX_STYLE_ISOLATION__ !== 'undefined' && __DSH_CODEX_STYLE_ISOLATION__ === true)

  const table = new Map()
  for (const feature of featureTable) table.set(feature.id, feature)

  /** @type {Map<string, object>} successfully built feature modules. */
  const modules = new Map()
  /** @type {string[]} build order of the modules that survived dependency checks. */
  const order = []
  /** @type {Map<string, object>} live disposable scopes for applied features. */
  const scopes = new Map()
  /** @type {Set<string>} features quarantined after a failure. */
  const quarantined = new Set()
  /** @type {Map<string, Function>} per-feature React error boundary components. */
  const boundaries = new Map()
  let React = null

  /**
   * Read React lazily; the shipped page always has it available.
   * @returns {object} React module.
   */
  function react() {
    if (React === null) React = require('react')
    return React
  }

  /**
   * One-line message from an unknown error, bounded for storage and display.
   * @param {unknown} error - thrown value.
   * @returns {string} message.
   */
  function messageOf(error) {
    try {
      const text = error !== null && typeof error === 'object'
        ? String(error.stack ?? error.message ?? error)
        : String(error)
      return text.split('\n')[0].slice(0, 400)
    } catch {
      return 'unknown error'
    }
  }

  /**
   * Log one feature failure. Returns the bounded message for status records.
   * @param {string} id - feature id.
   * @param {string} phase - build, apply, effect, slot, label, render, dependency or cleanup.
   * @param {unknown} error - thrown value.
   * @returns {string} message.
   */
  function report(id, phase, error) {
    const message = messageOf(error)
    console.error('[dsh-codex-style] feature "' + id + '" ' + phase + ' failed:', error)
    return message
  }

  /** @param {string} id - feature id. @returns {boolean} whether the check filter selects it. */
  function selected(id) {
    return filter === null || filter.includes(id)
  }

  /** @param {string} id - feature id. @returns {object|undefined} built module. */
  function moduleOf(id) {
    return modules.get(id)
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  /**
   * Build one feature lazily. A builder error is reported and skipped.
   * @param {string} id - feature id.
   * @returns {boolean} whether the feature built.
   */
  function buildFeature(id) {
    if (modules.has(id)) return true
    const feature = table.get(id)
    if (feature === undefined || !selected(id)) return false
    try {
      const built = feature.build(require, env)
      const dependencies = Array.isArray(built.requires)
        ? built.requires.filter((dependency) => typeof dependency === 'string')
        : []
      modules.set(id, {
        ...built,
        id,
        requires: dependencies,
        inject: Array.isArray(built.inject) ? built.inject : [],
        apply: typeof built.apply === 'function' ? built.apply : () => {},
      })
      order.push(id)
      return true
    } catch (error) {
      env.recordFailure(id, 'build', report(id, 'build', error))
      return false
    }
  }

  /**
   * Drop features whose declared dependencies did not build. Iterates because a
   * skipped dependency may cascade to its own dependents.
   */
  function pruneDependencies() {
    if (!isolationEnabled) return
    let changed = true
    while (changed) {
      changed = false
      for (const id of [...order]) {
        const module = modules.get(id)
        if (module === undefined) continue
        for (const dependency of module.requires) {
          if (!selected(dependency) || table.get(dependency) === undefined) continue
          if (modules.has(dependency)) continue
          modules.delete(id)
          const index = order.indexOf(id)
          if (index >= 0) order.splice(index, 1)
          env.markSkipped(id, dependency)
          changed = true
          break
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rendering boundary
  // -------------------------------------------------------------------------

  /**
   * React error boundary owned by one feature: a render/lifecycle crash renders
   * nothing for that feature and schedules a quarantine of its scope.
   * @param {string} id - feature id.
   * @returns {Function} boundary component class.
   */
  function boundaryFor(id) {
    const existing = boundaries.get(id)
    if (existing !== undefined) return existing
    const ReactModule = react()

    class FeatureErrorBoundary extends ReactModule.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      /** @returns {{ failed: boolean }} state that suppresses the crashed subtree. */
      static getDerivedStateFromError() {
        return { failed: true }
      }

      /**
       * Schedule the quarantine outside the render phase.
       * @param {unknown} error - thrown value.
       */
      componentDidCatch(error) {
        deferQuarantine(id, error)
      }

      /** @returns {object|null} children until the first error. */
      render() {
        return this.state.failed ? null : this.props.children
      }
    }

    boundaries.set(id, FeatureErrorBoundary)
    return FeatureErrorBoundary
  }

  /**
   * Wrap a slot component in its feature's error boundary. Props are forwarded
   * unchanged so host-injected values keep working.
   * @param {string} id - feature id.
   * @param {Function} Component - component registered by the feature.
   * @returns {Function} isolated component.
   */
  function wrapComponent(id, Component) {
    const Boundary = boundaryFor(id)
    const ReactModule = react()
    function IsolatedFeatureComponent(props) {
      return ReactModule.createElement(Boundary, null, ReactModule.createElement(Component, props))
    }
    IsolatedFeatureComponent.displayName = 'CodexStyleIsolated(' +
      (typeof Component.displayName === 'string' ? Component.displayName : '') +
      (typeof Component.name === 'string' ? Component.name : 'Component') + ')'
    return IsolatedFeatureComponent
  }

  // -------------------------------------------------------------------------
  // Disposable per-feature scope
  // -------------------------------------------------------------------------

  /**
   * Build one feature's disposable context facade.
   * @param {object} host - the real client context.
   * @param {string} id - feature id.
   * @returns {object} scope with `proxy`, `dispose`, `errorCount` and `firstError`.
   */
  function createScope(host, id) {
    /** @type {Function[]} */
    const disposers = []
    /** @type {{ phase: string, error: unknown }[]} */
    const errors = []
    let disposed = false

    /** @param {Function} dispose - disposer to release. */
    function safeDispose(dispose) {
      try {
        dispose()
      } catch (error) {
        console.error('[dsh-codex-style] feature "' + id + '" cleanup failed:', error)
      }
    }

    /** @param {Function} dispose - disposer to run now or when the scope is disposed. */
    function track(dispose) {
      if (typeof dispose !== 'function') return
      if (disposed) {
        safeDispose(dispose)
        return
      }
      disposers.push(dispose)
    }

    /** @param {string} phase - failing phase. @param {unknown} error - thrown value. */
    function fail(phase, error) {
      errors.push({ phase, error })
      env.recordFailure(id, phase, report(id, phase, error))
      deferQuarantine(id, error, phase)
    }

    /** @param {Function} factory - effect body. @param {string} label - cordis effect label. */
    function effect(factory, label) {
      if (disposed) return () => {}
      let dispose = () => {}
      try {
        dispose = host.effect(() => {
          try {
            const cleanup = factory()
            return () => {
              if (typeof cleanup === 'function') {
                try {
                  cleanup()
                } catch (error) {
                  fail('cleanup', error)
                }
              }
            }
          } catch (error) {
            fail('effect', error)
            return () => {}
          }
        }, typeof label === 'string' ? label : 'codex-style: ' + id)
      } catch (error) {
        fail('effect', error)
      }
      track(dispose)
      return dispose
    }

    /**
     * Wrap slot registration options so a throwing label or inject callback is
     * reported and yields a safe fallback instead of breaking the host render.
     * @param {object} options - slot registration options.
     * @returns {object} wrapped options.
     */
    function wrapOptions(options) {
      if (options === null || typeof options !== 'object') return options
      const next = { ...options }
      if (typeof options.label === 'function') {
        next.label = (...args) => {
          try {
            return options.label(...args)
          } catch (error) {
            fail('label', error)
            return ''
          }
        }
      }
      if (typeof options.inject === 'function') {
        next.inject = (...args) => {
          try {
            return options.inject(...args)
          } catch (error) {
            fail('inject', error)
            return {}
          }
        }
      }
      return next
    }

    const slots = {
      /** @param {object} options - slot options. @param {Function} component - feature component. */
      register(options, component) {
        const nextOptions = wrapOptions(options)
        const nextComponent = isolationEnabled && typeof component === 'function'
          ? wrapComponent(id, component)
          : component
        const dispose = host.slots.register(nextOptions, nextComponent)
        track(dispose)
        return dispose
      },
      /**
       * Defer to the host slot lifecycle; the callback is guarded and its
       * disposer is owned by this scope.
       * @param {string} name - slot name. @param {Function} callback - registration callback.
       */
      inject(name, callback) {
        const dispose = host.slots.inject(name, (...args) => {
          if (disposed) return () => {}
          try {
            const cleanup = callback(...args)
            track(cleanup)
            return cleanup
          } catch (error) {
            fail('slot', error)
            return () => {}
          }
        })
        track(dispose)
        return dispose
      },
      /** @param {string} name - slot name. @returns {number} ledger version. */
      getVersion(name) { return host.slots.getVersion(name) },
      /** @param {string} name - slot name. @returns {object[]} slot entries. */
      entries(name) { return host.slots.entries(name) },
      /** @param {string} name - slot name. @param {Function} listener - ledger listener. */
      subscribe(name, listener) { return host.slots.subscribe(name, listener) },
    }

    /** @param {string|string[]} deps - service names. @param {Function} callback - injected body. */
    function inject(deps, callback) {
      let dispose = () => {}
      try {
        dispose = host.inject(deps, (inner) => {
          if (disposed) return
          try {
            callback(scopeFacade(inner))
          } catch (error) {
            fail('inject', error)
          }
        })
      } catch (error) {
        fail('inject', error)
      }
      track(dispose)
      return dispose
    }

    /**
     * Facade over a context (root or nested inject context) that owns the
     * feature's registrations. Nested facades share this scope's tracking.
     * @param {object} context - context to wrap.
     * @returns {object} facaded context.
     */
    function scopeFacade(context) {
      return new Proxy(context, {
        get(target, property) {
          if (property === 'effect') return effect
          if (property === 'slots') return slots
          if (property === 'inject') return inject
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }

    const proxy = scopeFacade(host)

    return {
      proxy,
      /** Release every registration this feature made. */
      dispose() {
        if (disposed) return
        disposed = true
        for (const dispose of disposers.reverse()) safeDispose(dispose)
        disposers.length = 0
      },
      /** @returns {number} recorded in-scope failures. */
      errorCount() { return errors.length },
      /** @returns {{phase: string, error: unknown}|null} first failure. */
      firstError() { return errors.length > 0 ? errors[0] : null },
    }
  }

  // -------------------------------------------------------------------------
  // Quarantine
  // -------------------------------------------------------------------------

  /**
   * Quarantine one feature: report it, dispose its scope and quarantine its
   * dependents. Safe to call repeatedly and from render callbacks.
   * @param {string} id - feature id.
   * @param {unknown} error - thrown value.
   * @param {string} phase - failing phase.
   */
  function quarantine(id, error, phase) {
    if (quarantined.has(id)) return
    quarantined.add(id)
    const scope = scopes.get(id)
    scopes.delete(id)
    if (scope !== undefined) scope.dispose()
    env.recordQuarantine(id, phase, report(id, phase, error))
    for (const [otherId, module] of modules) {
      if (otherId === id) continue
      if (!module.requires.includes(id)) continue
      quarantine(otherId, new Error('required feature "' + id + '" is quarantined'), 'dependency')
    }
  }

  /** @param {string} id - feature id. @param {unknown} error - thrown value. @param {string} [phase] - failing phase. */
  function deferQuarantine(id, error, phase = 'render') {
    if (typeof setTimeout === 'function') {
      setTimeout(() => quarantine(id, error, phase), 0)
    } else {
      Promise.resolve().then(() => quarantine(id, error, phase))
    }
  }

  // -------------------------------------------------------------------------
  // Build + apply
  // -------------------------------------------------------------------------

  /**
   * Build every selected feature in table order, then drop unresolvable
   * dependents.
   * @returns {string[]} built feature ids in bundle order.
   */
  function buildAll() {
    for (const feature of featureTable) buildFeature(feature.id)
    pruneDependencies()
    return order.slice()
  }

  /** @param {object} module - built feature. @param {Set<string>} applied - applied ids. @param {Set<string>} skipped - skipped ids. @returns {string|null} missing dependency. */
  function missingDependency(module, applied, skipped) {
    for (const dependency of module.requires) {
      if (!selected(dependency) || table.get(dependency) === undefined) continue
      if (!modules.has(dependency) || skipped.has(dependency) || !applied.has(dependency)) return dependency
    }
    return null
  }

  /**
   * Apply every built feature, each on its own disposable scope.
   * @param {object} ctx - client root context.
   */
  function applyAll(ctx) {
    const applied = new Set()
    const skipped = new Set()
    const enabled = env.readEnabledFeatures()
    for (const id of order) {
      const module = modules.get(id)
      if (module === undefined) continue
      if (module.id !== env.settingsFeatureId && enabled[module.id] === false) continue
      const missing = missingDependency(module, applied, skipped)
      if (missing !== null) {
        skipped.add(id)
        env.markSkipped(id, missing)
        continue
      }
      if (!isolationEnabled) {
        try {
          module.apply(ctx)
          applied.add(id)
          env.clearFailure(id)
        } catch (error) {
          env.recordFailure(id, 'apply', report(id, 'apply', error))
        }
        continue
      }
      const scope = createScope(ctx, id)
      let failed = false
      try {
        module.apply(scope.proxy)
      } catch (error) {
        env.recordFailure(id, 'apply', report(id, 'apply', error))
        failed = true
      }
      const scopeError = scope.firstError()
      if (scopeError !== null) {
        report(id, scopeError.phase, scopeError.error)
        env.recordFailure(id, scopeError.phase, messageOf(scopeError.error))
        failed = true
      }
      if (failed) {
        scope.dispose()
        quarantined.add(id)
        continue
      }
      scopes.set(id, scope)
      applied.add(id)
      env.clearFailure(id)
    }
  }

  return {
    filter,
    isolationEnabled,
    /** @returns {string[]} built feature ids in bundle order. */
    builtIds() { return order.slice() },
    /** @returns {object[]} built feature modules in bundle order. */
    builtModules() { return order.map((id) => modules.get(id)).filter((module) => module !== undefined) },
    /** @returns {boolean} whether a feature is quarantined. */
    isQuarantined(id) { return quarantined.has(id) },
    buildAll,
    applyAll,
    quarantine,
  }
}
