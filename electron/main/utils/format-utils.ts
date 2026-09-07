/**
 * Draft event names: "PremierDraft_SOS_20260421", "QuickDraft_DSK_20260811",
 * "TradDraft_...". Returns null for non-draft events.
 */
export function parseDraftEventName(eventName: string): { set: string; format: string } | null {
  if (!eventName) return null

  // Format_SET_YYYYMMDD (date may carry extra suffixes on special events)
  const match = eventName.match(/^([A-Za-z]+)_([A-Za-z0-9]{2,6})_(\d{6,8})/)
  if (match && /draft|sealed/i.test(match[1])) {
    return { set: match[2].toUpperCase(), format: match[1] }
  }

  // Arena Direct sealed: ArenaDirect_OTJ_Sealed_20240726
  const direct = eventName.match(/^ArenaDirect_([A-Za-z0-9]{2,6})_(Sealed|Draft)_(\d{6,8})/)
  if (direct) return { set: direct[1].toUpperCase(), format: `ArenaDirect${direct[2]}` }

  // Fallback: any Draft/Sealed event with a recognizable set code segment
  if (/draft|sealed/i.test(eventName)) {
    const parts = eventName.split('_')
    const setPart = parts.find(p => /^[A-Z0-9]{3,4}$/.test(p))
    if (setPart) {
      return { set: setPart.toUpperCase(), format: parts[0] }
    }
  }

  return null
}

