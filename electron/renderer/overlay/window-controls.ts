/**
 * Manual window drag + resize for the overlay.
 *
 * The frameless overlay uses explicit drag grips instead of
 * `-webkit-app-region: drag`, which swallows click events inside the region.
 * Passive appearances still use showInactive(), so draft updates do not pull
 * focus from Arena; a deliberate panel click may focus the app normally.
 *
 *   pointerdown on a grip  -> invoke overlay-drag-start (window bounds)
 *   pointermove            -> absolute setPosition via IPC, rAF-throttled
 *   pointerup/cancel       -> overlay-move-end (persists position at once)
 *
 * The bottom-right handle does the same for size (clamped in main).
 */

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Elements that must stay clickable inside a grip. */
const INTERACTIVE = 'button, a, input, select, [data-no-drag]'

function beginDrag(grip: HTMLElement, down: PointerEvent): void {
  if (down.button !== 0) return
  if ((down.target as HTMLElement).closest(INTERACTIVE)) return
  if (!window.mtgaTracker?.overlayDragStart) return

  down.preventDefault()
  grip.setPointerCapture(down.pointerId)
  grip.classList.add('dragging')

  const startScreenX = down.screenX
  const startScreenY = down.screenY
  let latestScreenX = startScreenX
  let latestScreenY = startScreenY
  let active = true
  let origin: WindowBounds | null = null
  let pending: { x: number; y: number } | null = null
  let raf = 0

  const flush = () => {
    raf = 0
    if (pending) {
      window.mtgaTracker.overlayMove(pending.x, pending.y)
      pending = null
    }
  }

  const queueLatest = () => {
    if (!origin) return
    pending = {
      x: origin.x + (latestScreenX - startScreenX),
      y: origin.y + (latestScreenY - startScreenY)
    }
    if (!raf) raf = requestAnimationFrame(flush)
  }

  const onMove = (e: PointerEvent) => {
    latestScreenX = e.screenX
    latestScreenY = e.screenY
    queueLatest()
  }

  const onUp = () => {
    active = false
    grip.removeEventListener('pointermove', onMove)
    grip.removeEventListener('pointerup', onUp)
    grip.removeEventListener('pointercancel', onUp)
    grip.classList.remove('dragging')
    if (raf) cancelAnimationFrame(raf)
    flush()
    if (origin) window.mtgaTracker.overlayMoveEnd()
  }

  grip.addEventListener('pointermove', onMove)
  grip.addEventListener('pointerup', onUp)
  grip.addEventListener('pointercancel', onUp)

  void window.mtgaTracker.overlayDragStart().then(bounds => {
    if (!active || !bounds) return
    origin = bounds
    queueLatest()
  })
}

function beginResize(handle: HTMLElement, down: PointerEvent): void {
  if (down.button !== 0) return
  if (!window.mtgaTracker?.overlayResizeStart) return

  down.preventDefault()
  down.stopPropagation()
  handle.setPointerCapture(down.pointerId)

  const startScreenX = down.screenX
  const startScreenY = down.screenY
  let latestScreenX = startScreenX
  let latestScreenY = startScreenY
  let active = true
  let origin: WindowBounds | null = null
  let pending: { width: number; height: number } | null = null
  let raf = 0

  const flush = () => {
    raf = 0
    if (pending) {
      window.mtgaTracker.overlayResize(pending.width, pending.height)
      pending = null
    }
  }

  const queueLatest = () => {
    if (!origin) return
    pending = {
      width: origin.width + (latestScreenX - startScreenX),
      height: origin.height + (latestScreenY - startScreenY)
    }
    if (!raf) raf = requestAnimationFrame(flush)
  }

  const onMove = (e: PointerEvent) => {
    latestScreenX = e.screenX
    latestScreenY = e.screenY
    queueLatest()
  }

  const onUp = () => {
    active = false
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
    if (raf) cancelAnimationFrame(raf)
    flush()
    if (origin) window.mtgaTracker.overlayResizeEnd()
  }

  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)

  void window.mtgaTracker.overlayResizeStart().then(bounds => {
    if (!active || !bounds) return
    origin = bounds
    queueLatest()
  })
}

/**
 * Wire drag grips (any element with [data-grip]) and the resize handle.
 */
export function initWindowControls(): void {
  document.querySelectorAll<HTMLElement>('[data-grip]').forEach(grip => {
    grip.addEventListener('pointerdown', e => beginDrag(grip, e))
  })

  const handle = document.getElementById('resizeHandle')
  if (handle) {
    handle.addEventListener('pointerdown', e => beginResize(handle, e))
  }
}
