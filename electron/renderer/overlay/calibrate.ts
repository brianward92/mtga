/**
 * Badge calibration helper panel (runs inside the PANEL overlay window —
 * the badge window itself is always click-through, so this window hosts the
 * interactive controls).
 *
 * Main drives visibility via 'calibrate-mode' pushes; every button sends a
 * CalibrationOp over IPC, main merges it into the working config and pushes
 * the updated ghosts to the badge window live.
 *
 * NOTE: the overlay window is focusable:false, so arrow-KEY nudging is
 * impossible by design (key events can never reach this document) — the
 * arrow BUTTONS are the nudge surface.
 */

interface CalibrateModePayload {
  active: boolean
  count: number
  arenaFound: boolean
  accessibilityIssue: boolean
}

export function initCalibratePanel(): void {
  if (!window.mtgaTracker) return

  const panel = document.getElementById('calibratePanel')
  const overlay = document.getElementById('overlay')
  const status = document.getElementById('calStatus')
  const counts = document.getElementById('calCounts')
  const saveBtn = document.getElementById('calSave')
  const cancelBtn = document.getElementById('calCancel')
  if (!panel || !overlay || !status || !counts || !saveBtn || !cancelBtn) return

  let active = false

  // Op buttons: the op JSON lives in the markup (data-op)
  panel.querySelectorAll<HTMLElement>('[data-op]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!active || !btn.dataset.op) return
      try {
        window.mtgaTracker.calibrateAdjust(JSON.parse(btn.dataset.op))
      } catch {
        // malformed markup — ignore
      }
    })
  })

  // Pack size selector (13/14/15)
  counts.querySelectorAll<HTMLElement>('[data-count]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!active) return
      window.mtgaTracker.calibrateSetCount(parseInt(btn.dataset.count ?? '14', 10))
    })
  })

  saveBtn.addEventListener('click', () => window.mtgaTracker.calibrateSave())
  cancelBtn.addEventListener('click', () => window.mtgaTracker.calibrateCancel())

  const markCount = (count: number): void => {
    counts.querySelectorAll<HTMLElement>('[data-count]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.count ?? '', 10) === count)
    })
  }

  const updateStatus = (mode: CalibrateModePayload): void => {
    if (mode.accessibilityIssue) {
      status.textContent =
        'No Accessibility permission — enable MTGA Draft Assistant in System Settings → ' +
        'Privacy & Security → Accessibility, then relaunch.'
      status.classList.add('cal-error')
    } else if (!mode.arenaFound) {
      status.textContent = 'Arena window not found — is MTGA running?'
      status.classList.add('cal-error')
    } else {
      status.textContent = `Arena window locked · adjusting ${mode.count} ghost cards`
      status.classList.remove('cal-error')
    }
  }

  /**
   * Leaving calibration in the content-hugging draft densities: re-sync the
   * window height to the (now shorter) panel content. Detected via CSS
   * classes so this module needs nothing from draft-view.
   */
  const resyncHeight = (): void => {
    if (!overlay.classList.contains('draft-mode')) return
    if (overlay.classList.contains('density-full')) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = Math.ceil(overlay.getBoundingClientRect().height)
        if (target > 0) window.mtgaTracker.overlaySetSize(null, target, false)
      })
    })
  }

  window.mtgaTracker.onCalibrateMode((data: unknown) => {
    const mode = data as CalibrateModePayload
    active = mode?.active === true
    panel.style.display = active ? 'flex' : 'none'
    overlay.classList.toggle('calibrating', active)
    if (active) {
      updateStatus(mode)
      markCount(mode.count)
    } else {
      resyncHeight()
    }
  })
}
