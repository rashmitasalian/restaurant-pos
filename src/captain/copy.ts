export type ConnectionState = "live" | "reconnecting" | "offline";

export function greetingFor(displayName?: string | null, username?: string | null) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const stripped = String(displayName || "")
    .trim()
    .replace(/^captain\s+/i, "")
    .trim();
  const first =
    stripped.split(/\s+/).find(Boolean) ||
    String(username || "")
      .trim()
      .split(/\s+/)
      .find((part) => part && part.toLowerCase() !== "captain") ||
    "";
  return first ? `${hello}, ${first}` : hello;
}

export function connectionLabel(state: ConnectionState) {
  if (state === "live") {
    return "Connected";
  }
  if (state === "reconnecting") {
    return "Reconnecting…";
  }
  return "POS unavailable";
}

export function waiterError(err: unknown, fallback: string) {
  const msg = String((err as any)?.message || err || "");
  if (
    msg === "request-timeout" ||
    /failed to fetch|networkerror|load failed|sse-failed|sse-ended/i.test(msg)
  ) {
    return "Couldn't connect to the POS. Check restaurant Wi-Fi and try again.";
  }
  if (msg === "client-op-conflict") {
    return "That action already ran with different data. Refresh and try again.";
  }
  if (msg === "kot-no-unsent-items") {
    return "No new items to send.";
  }
  if (msg === "order-not-found") {
    return "This table's order is no longer open.";
  }
  if (msg === "invalid-pairing-code") {
    return "The pairing code is wrong. Check the restaurant POS.";
  }
  if (msg === "captain-phone-only" || msg === "forbidden") {
    return "This account cannot use Captain.";
  }
  return fallback;
}

export function isAuthRequiredError(err: unknown) {
  const msg = String((err as any)?.message || err || "");
  const status = Number((err as any)?.status);
  return msg === "auth-required" || msg === "http-401" || msg.includes("http-401") || status === 401;
}
