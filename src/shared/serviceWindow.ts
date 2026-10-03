/** Local calendar day, same boundary the POS uses until a business-day setting exists. */
export function startOfLocalDay(now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

/**
 * Current service is operational, not "opened today".
 * Unsent work always counts. Otherwise the last activity must fall on this business day.
 */
export function isCurrentService(
  activityAt: number | null | undefined,
  unsentCount: number,
  now = Date.now(),
) {
  if (Number(unsentCount) > 0) {
    return true;
  }
  const at = Number(activityAt || 0);
  if (!Number.isFinite(at) || at <= 0) {
    return false;
  }
  return at >= startOfLocalDay(now);
}
