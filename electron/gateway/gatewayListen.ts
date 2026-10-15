export const GATEWAY_PORT_ATTEMPTS = 10;

export function describeGatewayListenFailure(error: unknown, fromPort: number, attempts: number) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const tried = Math.max(1, Math.trunc(attempts) || 1);
  const lastPort = fromPort + tried - 1;
  if (code === "EADDRINUSE") {
    const ports = tried > 1 && lastPort !== fromPort ? `Ports ${fromPort}–${lastPort}` : `Port ${fromPort}`;
    return `${ports} already in use. Close the other program using ${tried > 1 ? "them" : "it"}, then try again.`;
  }
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "Captain could not start.";
}
