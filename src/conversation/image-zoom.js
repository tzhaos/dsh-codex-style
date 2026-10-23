/**
 * dsh-image-zoom — merged feature of dsh-codex-style.
 *
 * The Host image lightbox renders a fixed dialog with one `<img>`; it has no
 * zoom affordance. This layer adds cursor-anchored wheel zoom and drag panning
 * to that dialog only, leaves every other dialog untouched, and keeps the
 * image's inline transform local to the open lightbox.
 */
__DSH_FEATURE('dsh-image-zoom', function (require, env) {
  const MIN_SCALE = 1
  const MAX_SCALE = 8
  const WHEEL_STEP = 0.0025

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

  /**
   * Find the image lightbox that owns an event target.
   * The primitive renders `dialog > stage > [mask, img, close]`, so only a
   * dialog whose stage holds a direct image child is treated as a lightbox.
   * @param {unknown} target - event target.
   * @returns {{ dialog: Element, image: Element }|null} lightbox parts.
   */
  function lightboxOf(target) {
    if (target === null || target === undefined || typeof target !== 'object') return null
    if (typeof target.closest !== 'function') return null
    const dialog = target.closest('[role="dialog"][aria-modal="true"]')
    if (dialog === null || dialog === undefined) return null
    const stage = dialog.firstElementChild
    if (stage === null || stage === undefined || typeof stage.querySelector !== 'function') return null
    const image = stage.querySelector(':scope > img')
    if (image === null) return null
    return { dialog, image }
  }

  /**
   * Plan one cursor-anchored zoom step.
   * `base` is the untransformed layout rect of the image; the returned
   * translation keeps the point under the pointer in place.
   * @param {{ scale: number, tx: number, ty: number }} state - current zoom state.
   * @param {{ left: number, top: number }} base - untransformed image offset.
   * @param {{ x: number, y: number }} point - viewport point of the wheel.
   * @param {number} deltaY - wheel delta.
   * @returns {{ scale: number, tx: number, ty: number }} next state.
   */
  function planZoom(state, base, point, deltaY) {
    const nextScale = clamp(state.scale * Math.exp(-deltaY * WHEEL_STEP), MIN_SCALE, MAX_SCALE)
    if (nextScale === state.scale) return state
    if (nextScale === MIN_SCALE) return { scale: MIN_SCALE, tx: 0, ty: 0 }
    const x = point.x - base.left
    const y = point.y - base.top
    const localX = (x - state.tx) / state.scale
    const localY = (y - state.ty) / state.scale
    return {
      scale: nextScale,
      tx: x - localX * nextScale,
      ty: y - localY * nextScale,
    }
  }

  /** Paint one state onto the image, or clear the inline transform at fit size. */
  function paint(image, state) {
    if (state.scale <= MIN_SCALE && state.tx === 0 && state.ty === 0) {
      image.style.removeProperty('transform')
      image.style.removeProperty('transform-origin')
      image.style.removeProperty('cursor')
      image.style.removeProperty('will-change')
      return
    }
    image.style.transformOrigin = '0 0'
    image.style.transform = `translate(${String(state.tx)}px, ${String(state.ty)}px) scale(${String(state.scale)})`
    image.style.willChange = 'transform'
    image.style.cursor = 'grab'
  }

  /** Attach wheel zoom and drag panning to the global document. */
  function install() {
    const states = new WeakMap()
    let drag = null

    const stateOf = (parts) => {
      let state = states.get(parts.dialog)
      if (state === undefined) {
        const rect = parts.image.getBoundingClientRect()
        state = { scale: 1, tx: 0, ty: 0, base: { left: rect.left, top: rect.top } }
        states.set(parts.dialog, state)
      } else {
        const rect = parts.image.getBoundingClientRect()
        state.base = { left: rect.left - state.tx, top: rect.top - state.ty }
      }
      return state
    }

    const onWheel = (event) => {
      const parts = lightboxOf(event.target)
      if (parts === null) return
      event.preventDefault()
      event.stopPropagation()
      parts.dialog.style.overflow = 'hidden'
      const state = stateOf(parts)
      const next = planZoom(state, state.base, { x: event.clientX, y: event.clientY }, event.deltaY)
      states.set(parts.dialog, next)
      paint(parts.image, next)
    }

    const onPointerDown = (event) => {
      const parts = lightboxOf(event.target)
      if (parts === null || event.target !== parts.image) return
      if (event.button !== 0) return
      const state = states.get(parts.dialog)
      if (state === undefined || state.scale <= MIN_SCALE) return
      parts.dialog.style.overflow = 'hidden'
      drag = {
        dialog: parts.dialog,
        image: parts.image,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        tx: state.tx,
        ty: state.ty,
      }
      event.preventDefault()
      try {
        parts.image.setPointerCapture?.(event.pointerId)
      } catch {
        /* capture is an optimization only */
      }
      parts.image.style.cursor = 'grabbing'
    }

    const onPointerMove = (event) => {
      if (drag === null || event.pointerId !== drag.pointerId) return
      const state = states.get(drag.dialog)
      if (state === undefined) return
      const next = {
        scale: state.scale,
        tx: drag.tx + event.clientX - drag.x,
        ty: drag.ty + event.clientY - drag.y,
      }
      states.set(drag.dialog, next)
      paint(drag.image, next)
    }

    const endDrag = (event) => {
      if (drag === null) return
      const image = drag.image
      const pointerId = drag.pointerId
      drag = null
      image.style.cursor = 'grab'
      try {
        image.releasePointerCapture?.(pointerId)
      } catch {
        /* already released */
      }
    }

    const onDoubleClick = (event) => {
      const parts = lightboxOf(event.target)
      if (parts === null) return
      const state = states.get(parts.dialog)
      if (state === undefined) return
      states.set(parts.dialog, { scale: MIN_SCALE, tx: 0, ty: 0, base: state.base })
      paint(parts.image, { scale: MIN_SCALE, tx: 0, ty: 0 })
      event.preventDefault()
    }

    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', endDrag, true)
    document.addEventListener('pointercancel', endDrag, true)
    document.addEventListener('dblclick', onDoubleClick, true)
    return () => {
      document.removeEventListener('wheel', onWheel, { capture: true })
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', endDrag, true)
      document.removeEventListener('pointercancel', endDrag, true)
      document.removeEventListener('dblclick', onDoubleClick, true)
      drag = null
    }
  }

  /** Register the zoom layer for the lifetime of the feature. */
  function apply(ctx) {
    ctx.effect(() => install(), 'image-zoom: lightbox wheel zoom')
  }

  return {
    inject: [],
    apply,
    __test: { lightboxOf, planZoom, paint },
  }
})
