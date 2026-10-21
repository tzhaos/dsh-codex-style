/** Shared strict Remote contract; sessionId receives DSH's session-resource authorization. */
export function createGitContribution() {
  const text = (name, limit) => ({
    mode: 'strict',
    typeSymbol: 'dsh-codex-style#git.' + name,
    create: () => ({
      parse(value) {
        if (typeof value !== 'string' || !value || value.length > limit || /[\0\r\n]/.test(value))
          throw new TypeError('Invalid ' + name)
        return value
      },
    }),
  })
  const parseResult = (value) => {
    if (!value || typeof value !== 'object' || typeof value.ok !== 'boolean')
      throw new TypeError('Invalid Git result')
    if (!value.ok) {
      if (typeof value.reason !== 'string') throw new TypeError('Invalid Git failure')
      return value
    }
    const repo = value.repository
    if (
      !repo ||
      typeof repo.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(repo.token) ||
      !(repo.branch === null || typeof repo.branch === 'string') ||
      typeof repo.head !== 'string' ||
      typeof repo.dirty !== 'boolean' ||
      typeof repo.writable !== 'boolean' ||
      !Array.isArray(repo.branches) ||
      repo.branches.length > 20000 ||
      repo.branches.some(
        (branch) => !branch || typeof branch.name !== 'string' || typeof branch.inUse !== 'boolean',
      )
    )
      throw new TypeError('Invalid Git repository')
    return value
  }
  const result = {
    mode: 'strict',
    typeSymbol: 'dsh-codex-style#git.Result',
    create: () => ({ parse: parseResult }),
    decode: parseResult,
  }
  const parameter = (name, limit) => ({
    name,
    wire: name,
    source: 'json',
    codec: text(name, limit),
    strictCodec: text(name, limit),
  })
  const descriptor = (method, parameters) => ({
    id: 'dsh-codex-style#codexGit/' + method,
    service: 'codexGit',
    namespace: 'codexGit',
    method,
    invocation: { kind: 'direct' },
    parameters,
    cancellation: { parameter: 'signal' },
    result,
  })
  return {
    package: 'dsh-codex-style-git',
    descriptors: [
      descriptor('list', [parameter('sessionId', 256)]),
      descriptor('switch', [
        parameter('sessionId', 256),
        parameter('branch', 1024),
        parameter('expectedHead', 64),
      ]),
    ],
  }
}
