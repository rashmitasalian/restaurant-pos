export function formatKotAge(ms: number, now = Date.now()) {
  const elapsed = Math.max(0, now - ms);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) {
    return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

export function kotAgeTone(ms: number, now = Date.now()): "neutral" | "attention" | "danger" {
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 5) {
    return "neutral";
  }
  if (minutes < 15) {
    return "attention";
  }
  return "danger";
}
