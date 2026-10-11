/** Default outdoor runs need no repeated label. Use API-selected Garmin
 * classification; the browser never infers a type from raw provider content. */
export function activitySubtypeLabel(type: string, subtype: string | null, classification?: { subtype: string | null } | null): string {
  const value = type === 'run' ? classification?.subtype ?? subtype : subtype;
  if (!value || value === 'unknown' || (type === 'run' && value === 'outdoor')) return '';
  return value === 'track' ? 'Track' : value === 'treadmill' ? 'Treadmill' : value;
}
