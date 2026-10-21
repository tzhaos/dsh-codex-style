/** Git branch navigation over DSH's authenticated, Host-routed Remote. */
__DSH_FEATURE('dsh-git-switch', function (require, env) {
  const React = require('react')
  const {
    Menu,
    MenuItemButton,
    Tooltip,
    IconBranchOutlineRegular,
    IconChevronDownOutlineRegular,
    IconCheckOutlineRegular,
  } = require('@deepseek-ai/dsh-client-ui-primitives')
  const { useCallback, useEffect, useLayoutEffect, useRef, useState } = React
  const h = React.createElement
  const NS = 'gitBranches'
  const zh = {
    label: 'Git 分支',
    loading: '正在读取 Git…',
    search: '搜索本地分支',
    refresh: '刷新分支',
    current: '当前分支',
    detached: '分离 HEAD',
    unborn: '尚无提交',
    empty: '没有匹配的本地分支',
    switching: '正在切换…',
    dirty: '工作区有未提交修改，请处理后再切换。',
    'branch-in-use': '该分支正在其他工作树中使用。',
    running: '工作区有会话或任务正在执行，结束后再切换。',
    'not-repository': '当前目录不是 Git 仓库。',
    'no-directory': '请先选择工作区。',
    'session-unavailable': '会话尚未就绪，请刷新后重试。',
    'git-unavailable': '未找到 Git，请安装后重试。',
    'git-failed': 'Git 操作失败，请刷新或在终端查看。',
    'too-large': 'Git 返回内容过多，请在终端处理。',
    busy: '仓库正在处理其他操作，请稍后刷新。',
    'read-only': '当前会话为只读模式，无法切换分支。',
    stale: '仓库状态已变化，请重新选择分支。',
    'branch-not-found': '分支已不存在，请刷新后重试。',
    'in-progress': '仓库正在合并或变基，请完成后再切换。',
    timeout: 'Git 操作超时，请刷新后重试。',
    cancelled: 'Git 操作已取消。',
    'switch-unknown': '切换结果待确认，请刷新分支状态后再操作。',
    limited: '仅显示前 200 项，请缩小搜索范围。',
    'in-use': '其他工作树占用',
    filters: '检出过滤器不会自动运行；需要过滤器时请在终端切换。',
    error: '无法连接 Git 服务，请刷新后重试。',
  }
  const en = {
    label: 'Git branches',
    loading: 'Reading Git…',
    search: 'Search local branches',
    refresh: 'Refresh branches',
    current: 'Current branch',
    detached: 'Detached HEAD',
    unborn: 'No commits yet',
    empty: 'No matching local branches',
    switching: 'Switching…',
    dirty: 'The worktree has uncommitted changes. Resolve them before switching.',
    'branch-in-use': 'This branch is checked out in another worktree.',
    running: 'A session or task is active in this worktree. Wait until it finishes.',
    'not-repository': 'This directory is not a Git repository.',
    'no-directory': 'Choose a workspace first.',
    'session-unavailable': 'The session is not ready. Refresh and try again.',
    'git-unavailable': 'Git was not found. Install it and try again.',
    'git-failed': 'Git failed. Refresh or inspect the repository in a terminal.',
    'too-large': 'Git returned too much output. Use a terminal.',
    busy: 'Another repository operation is in progress. Refresh shortly.',
    'read-only': 'This session is read-only. Branch switching is unavailable.',
    stale: 'The repository changed. Select the branch again.',
    'branch-not-found': 'The branch no longer exists. Refresh and try again.',
    'in-progress': 'Finish the current merge or rebase before switching.',
    timeout: 'Git timed out. Refresh and try again.',
    cancelled: 'Git operation canceled.',
    'switch-unknown': 'The switch outcome is unconfirmed. Refresh before another operation.',
    limited: 'Showing the first 200 matches. Narrow your search.',
    'in-use': 'In another worktree',
    filters: 'Checkout filters do not run automatically. Use a terminal when filters are required.',
    error: 'Could not reach Git. Refresh and try again.',
  }

  function GitBranchButton({ sessionId, actions, useSession, useSessions, t }) {
    const cwd = useSessions((state) => state.byId[sessionId]?.cwd)
    const running = useSession(
      (state) => state.running || state.removed || state.pendingSubmissions?.length > 0,
    )
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [state, setState] = useState({ repository: null, loading: true, error: null })
    const [switching, setSwitching] = useState(false)
    const mounted = useRef(true),
      request = useRef(null),
      revision = useRef(0),
      pending = useRef(null)
    const search = useRef(null)
    useLayoutEffect(() => {
      if (open) search.current?.focus({ preventScroll: true })
    }, [open])
    const refresh = useCallback(async () => {
      if (pending.current?.generation === revision.current) return
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      const generation = ++revision.current
      setState((current) => ({ ...current, loading: true }))
      try {
        const result = await actions.list(controller.signal)
        if (!mounted.current || generation !== revision.current) return
        setState({
          cwd,
          repository: result.ok ? result.repository : null,
          loading: false,
          error: result.ok ? null : result.reason,
        })
      } catch {
        if (mounted.current && generation === revision.current && !controller.signal.aborted)
          setState({ repository: null, loading: false, error: 'error' })
      }
    }, [actions, cwd])
    useEffect(() => {
      mounted.current = true
      setSwitching(false)
      setState({ repository: null, loading: true, error: null })
      void refresh()
      const onFocus = () => {
        if (document.visibilityState !== 'hidden') void refresh()
      }
      window.addEventListener('focus', onFocus)
      return () => {
        mounted.current = false
        revision.current++
        request.current?.abort()
        window.removeEventListener('focus', onFocus)
      }
    }, [refresh])
    const select = async (branch) => {
      const repository = state.repository
      if (
        !repository ||
        pending.current?.generation === revision.current ||
        running ||
        repository.dirty ||
        repository.writable === false ||
        state.loading
      )
        return
      const operation = { generation: ++revision.current }
      pending.current = operation
      const current = () => mounted.current && revision.current === operation.generation
      setSwitching(true)
      request.current?.abort()
      try {
        const result = await actions.switch(branch, repository.token)
        if (!current()) return
        if (result.ok) {
          setState({ cwd, repository: result.repository, loading: false, error: null })
          setOpen(false)
        } else {
          setState((current) => ({ ...current, error: result.reason }))
          // A failed/late acknowledgement never triggers a second switch.
          const fresh = await actions.list()
          if (current())
            setState((current) => ({
              ...current,
              repository: fresh.ok ? fresh.repository : null,
              error: result.reason,
            }))
        }
      } catch {
        if (current()) setState({ repository: null, loading: false, error: 'switch-unknown' })
      } finally {
        if (pending.current === operation) pending.current = null
        if (current()) setSwitching(false)
      }
    }
    const repository = state.cwd === cwd ? state.repository : null
    if (!repository) return null
    const matches = (repository?.branches ?? []).filter((branch) =>
      branch.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    const disabled =
      switching || state.loading || running || repository?.dirty || repository?.writable === false
    const reason =
      state.error ??
      (running
        ? 'running'
        : repository?.dirty
          ? 'dirty'
          : repository?.writable === false
            ? 'read-only'
            : null)
    const label =
      repository.branch ??
      (repository.head ? t('detached') + ' ' + repository.head.slice(0, 7) : t('unborn'))
    return h(Menu, {
      open,
      onClose: () => setOpen(false),
      portal: true,
      side: 'top',
      align: 'end',
      listClassName: 'dshgit-menu',
      anchor: h(
        Tooltip,
        {
          label: switching ? t('switching') : state.error ? t(state.error) : t('label'),
          portal: true,
          side: 'top',
          delayMs: 500,
        },
        h(
          'button',
          {
            type: 'button',
            className: 'dshgit-trigger',
            'aria-label': t('label'),
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            disabled: switching,
            onClick: () => {
              setOpen((value) => !value)
              if (!open) {
                setQuery('')
                void refresh()
              }
            },
          },
          h(IconBranchOutlineRegular, { size: 16 }),
          h('span', { className: 'dshgit-name' }, label),
          h(IconChevronDownOutlineRegular, { size: 12 }),
        ),
      ),
      children: [
        h(
          'div',
          { className: 'dshgit-search', key: 'search' },
          h('input', {
            ref: search,
            type: 'search',
            value: query,
            'aria-label': t('search'),
            placeholder: t('search'),
            onChange: (event) => setQuery(event.target.value),
            disabled: switching,
          }),
        ),
        reason
          ? h(
              'div',
              { key: 'notice', role: state.error ? 'alert' : 'status', className: 'dshgit-notice' },
              t(reason),
            )
          : null,
        repository?.filtersDisabled
          ? h('div', { key: 'filters', className: 'dshgit-notice' }, t('filters'))
          : null,
        state.loading
          ? h('div', { key: 'loading', role: 'status', className: 'dshgit-notice' }, t('loading'))
          : null,
        ...matches.slice(0, 200).map((branch) =>
          h(
            MenuItemButton,
            {
              key: branch.name,
              disabled: disabled || branch.inUse || branch.name === repository.branch,
              onSelect: () => {
                void select(branch.name)
              },
            },
            h(
              'span',
              { className: 'dshgit-branch' },
              h('span', { className: 'dshgit-name' }, branch.name),
              branch.inUse
                ? h('span', { className: 'dshgit-hint' }, t('in-use'))
                : branch.name === repository.branch
                  ? h(IconCheckOutlineRegular, { size: 16 })
                  : null,
            ),
          ),
        ),
        !state.loading && !matches.length
          ? h('div', { key: 'empty', className: 'dshgit-notice' }, t('empty'))
          : null,
        matches.length > 200
          ? h('div', { key: 'limited', className: 'dshgit-notice' }, t('limited'))
          : null,
      ],
      footer: [{ id: 'refresh', label: t('refresh'), disabled: switching }],
      onSelect: (id) => {
        if (id === 'refresh') void refresh()
      },
    })
  }
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-switch: locale')
    let mounting
    const ready = () =>
      (mounting ??= ctx.remote.$mount(env.gitContribution).catch((error) => {
        mounting = undefined
        throw error
      }))
    const unwrap = (result) => {
      if (!result.ok) throw new Error('Git Remote unavailable')
      return result.value
    }
    ctx.effect(() => {
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-git-switch'
      style.textContent = `.dshgit-trigger{display:inline-flex;align-items:center;justify-content:center;gap:6px;max-width:180px;min-width:0;height:28px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}.dshgit-trigger:hover,.dshgit-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}.dshgit-trigger:disabled{opacity:.5;cursor:default}.dshgit-trigger>svg{flex:none}.dshgit-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshgit-menu{width:320px;max-width:calc(100vw - 24px)}.dshgit-search{padding:4px 6px 8px}.dshgit-search input{box-sizing:border-box;width:100%;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;outline:none}.dshgit-search input:focus-visible,.dshgit-trigger:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color)}.dshgit-notice{padding:6px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:normal}.dshgit-branch{display:flex;align-items:center;gap:8px;min-width:0;justify-content:space-between}.dshgit-branch>svg{flex:none}.dshgit-hint{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}`
      document.head.append(style)
      return () => style.remove()
    }, 'git-switch: styles')
    const inject = (sessionId) => ({
      sessionId,
      actions: {
        async list(signal) {
          await ready()
          return unwrap(await ctx.remote.codexGit.list(sessionId, signal))
        },
        async switch(branch, expectedHead) {
          await ready()
          return unwrap(await ctx.remote.codexGit.switch(sessionId, branch, expectedHead))
        },
      },
    })
    // DSH mounts this slot only in the new-chat panel.
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.hero.options', () =>
          ctx.slots.register(
            {
              name: 'conversation.hero.options',
              id: 'git-branches',
              locale: NS,
              order: 60,
              inject,
            },
            GitBranchButton,
          ),
        ),
      'git-switch: conversation.hero.options',
    )
  }
  return { inject: ['slots', 'locale', 'remote'], apply }
})
