import { createConnection } from "net";

export function isIpv4Address(value: string) {
  const parts = String(value || "").trim().split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) {
        return false;
      }
      const value = Number(part);
      return value >= 0 && value <= 255;
    })
  );
}

export function printViaNetworkRaw(host: string, port: number, escPosBuffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = createConnection({ host, port, timeout: 7000 }, () => {
      socket.write(escPosBuffer, (err?: Error | null) => {
        if (err) {
          finish(err);
          return;
        }
        socket.end();
      });
    });

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        try {
          socket.destroy();
        } catch {
          // Ignore cleanup failures.
        }
        reject(error);
        return;
      }
      resolve();
    };

    socket.on("close", (hadError: boolean) => {
      if (!hadError) {
        finish();
      }
    });
    socket.on("timeout", () => {
      finish(new Error("network-printer-timeout"));
    });
    socket.on("error", finish);
  });
}
