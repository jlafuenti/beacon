/**
 * Google Keep sub-items. HA's todo model has no parent field, so the forked
 * google_keep_sync integration publishes `item_parents` ({ childUid: parentUid })
 * as a state attribute on each todo entity. Lists without it render flat.
 */
/** Accept only a plain { childUid: parentUid } map of strings; anything else means "no nesting". */
export function parseItemParents(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [child, parent] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof parent === 'string' && parent) out[child] = parent;
  }
  return out;
}

/** UIDs in `section` whose parent is also in `section`. */
export function indentedUids(section: { uid: string }[], parents: Record<string, string>): Set<string> {
  const present = new Set(section.map(i => i.uid));
  return new Set(section.filter(i => parents[i.uid] && present.has(parents[i.uid])).map(i => i.uid));
}
