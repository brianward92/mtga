/**
 * Model display naming (pure logic — unit tested).
 *
 * The bundled DraftFM foundation model is identified by a path-like id such
 * as "_foundation/v20260809_final_d256". The HUD shows a friendly product
 * name for known releases and falls back to the id's version segment.
 */

/** Known model ids → product names. */
const KNOWN_MODELS: Readonly<Record<string, string>> = {
  '_foundation/v20260809_final_d256': 'DraftFM v1.0'
}

/**
 * Footer display tag: the version segment of the model id
 * ("SOS/PremierDraft/v20260703" -> "v20260703"); the full id goes in the
 * tooltip. Ids without a path keep their full text.
 */
function modelVersionTag(id: string): string {
  const segments = id.split('/').filter(Boolean)
  return segments[segments.length - 1] || id
}

/**
 * Friendly display name for a model id: a known release maps to its product
 * name ("DraftFM v1.0"); anything else under _foundation/ (or any other id)
 * becomes "DraftFM <version segment>"; a missing id is just "DraftFM".
 */
export function modelDisplayName(id: string | null | undefined): string {
  if (!id) return 'DraftFM'
  const known = KNOWN_MODELS[id]
  if (known) return known
  const tag = modelVersionTag(id)
  return tag ? `DraftFM ${tag}` : 'DraftFM'
}

/** Compact provenance shown in the HUD footer for the active set bundle. */
export function bundleProvenance(snapshot: { model: string | null; scryfall: string | null }): string {
  return [
    snapshot.model ? `DraftFM ${snapshot.model}` : '',
    snapshot.scryfall ? `Scryfall ${snapshot.scryfall}` : ''
  ].filter(Boolean).join(' · ')
}
