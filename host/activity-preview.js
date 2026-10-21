/** Small wire projection over visible message appends; no Agent or follow stream. */
export const ACTIVITY_PREVIEW_KEY = 'codexActivityPreview'

export function boundedPreview(content) {
  if (!Array.isArray(content)) return ''
  let raw = '',
    budget = 2048
  for (let index = 0; index < Math.min(content.length, 64) && budget > 0; index++) {
    const block = content[index]
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    const text = block.text.slice(0, budget)
    raw += text
    budget -= text.length
  }
  raw = raw.replace(/\s+/gu, ' ').trim()
  let preview = '',
    count = 0
  for (const point of raw) {
    if (++count > 240) break
    const code = point.codePointAt(0)
    if (code >= 0xd800 && code <= 0xdfff) continue
    preview += point
  }
  return preview
}

const schema = {
  parse(value) {
    if (value === null) return null
    if (
      !value ||
      typeof value !== 'object' ||
      !['user', 'assistant'].includes(value.role) ||
      typeof value.text !== 'string' ||
      value.text.length > 480 ||
      [...value.text].length > 240 ||
      !Number.isSafeInteger(value.seq) ||
      value.seq < 0 ||
      !Number.isFinite(value.time)
    )
      throw new TypeError('Invalid activity preview')
    return { role: value.role, text: value.text, seq: value.seq, time: value.time }
  },
}

export function createActivityPreviewProjection() {
  return {
    key: ACTIVITY_PREVIEW_KEY,
    stateVersion: 1,
    stateSchema: schema,
    init: () => null,
    apply(state, event) {
      if (event.surfaceOp !== 'append') return state
      const user = event.type === 'user/message' && event.data.source?.kind === 'user'
      const assistant = event.type === 'assistant/message'
      if (!user && !assistant) return state
      const text = boundedPreview(user ? event.data.content : event.data.message.content)
      if (assistant && text === '') return state
      return { role: user ? 'user' : 'assistant', text, seq: event.seq, time: event.time }
    },
    wire: { viewSchema: schema, view: (state) => state },
  }
}

export function registerActivityPreview(ctx) {
  // The optional native contribution owns its registration and checkpoint cells.
  ctx.inject?.(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(createActivityPreviewProjection())
  })
}
