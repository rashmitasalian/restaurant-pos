import { createConnection } from "net";
import { isIpv4PrinterTarget } from "../../src/shared/printerConfig";

export function isIpv4Address(value: string) {
  return isIpv4PrinterTarget(value);
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
