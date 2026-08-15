/**
 * Draft event names: "PremierDraft_SOS_20260421", "QuickDraft_DSK_20260811",
 * "TradDraft_...". Returns null for non-draft events.
 */
export function parseDraftEventName(eventName: string): { set: string; format: string } | null {
  if (!eventName) return null

  // Format_SET_YYYYMMDD (date may carry extra suffixes on special events)
  const match = eventName.match(/^([A-Za-z]+)_([A-Za-z0-9]{2,6})_(\d{6,8})/)
  if (match && match[1].toLowerCase().includes('draft')) {
    return { set: match[2].toUpperCase(), format: match[1] }
  }

  // Fallback: any Draft event with a recognizable set code segment
  if (eventName.toLowerCase().includes('draft')) {
    const parts = eventName.split('_')
    const setPart = parts.find(p => /^[A-Z0-9]{3,4}$/.test(p))
    if (setPart) {
      return { set: setPart.toUpperCase(), format: parts[0] }
    }
  }

  return null
}

