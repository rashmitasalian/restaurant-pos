import fs from "fs";
import path from "path";

/**
 * Channels that are reachable before a session exists.
 * Everything else must call requireSession, requirePermission, requireMainSession,
 * or requireAdmin. requireAdmin is the settings-admin wrapper around requirePermission.
 */
const PUBLIC_CHANNELS = new Set([
  "pos:db:ready",
  "pos:auth:has-users",
  "pos:auth:create-first-admin",
  "pos:auth:login",
  "pos:auth:logout",
  "pos:auth:recovery-status",
  "pos:auth:recover-last-admin",
  "pos:branding:get-public",
  "pos:appearance:set",
  "log:write",
  "license:get-status",
  "license:get-installation-code",
  "license:copy-installation-code",
  "license:import",
]);

const SOURCE_FILES = [
  "electron/ipc/posIpc.ts",
  "electron/ipc/licenseIpc.ts",
  "electron/main.ts",
];

function handlersIn(source: string) {
  const pattern = /ipcMain\.handle\(\s*["']([^"']+)["']/g;
  const found: Array<{ channel: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    found.push({ channel: match[1], index: match.index });
  }
  return found.map((entry, index) => ({
    channel: entry.channel,
    body: source.slice(entry.index, found[index + 1]?.index ?? source.length),
  }));
}

describe("IPC authorization coverage", () => {
  it("requires a session on every channel that is not part of setup", () => {
    const missing: string[] = [];
    for (const relativePath of SOURCE_FILES) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
      for (const handler of handlersIn(source)) {
        const guarded = /require(?:Main)?Session\(|requirePermission\(|requireAdmin\(/.test(handler.body);
        if (!guarded && !PUBLIC_CHANNELS.has(handler.channel)) {
          missing.push(`${relativePath} ${handler.channel}`);
        }
      }
    }
    expect(missing).toEqual([]);
    const posIpc = fs.readFileSync(path.join(process.cwd(), "electron/ipc/posIpc.ts"), "utf8");
    expect(posIpc).toMatch(/function requireAdmin\([\s\S]*?requirePermission\(/);
  });
});
