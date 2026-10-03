import fs from "fs";
import os from "os";
import path from "path";

jest.mock("electron", () => ({
  BrowserWindow: { fromWebContents: jest.fn(() => null) },
  clipboard: { writeText: jest.fn() },
  dialog: { showOpenDialog: jest.fn() },
  ipcMain: { handle: jest.fn() },
}));

jest.mock("../licensing/licenseService", () => ({
  importRuntimeLicense: jest.fn(),
  installationCodeForRenderer: jest.fn(),
  licenseStatusForRenderer: jest.fn(),
}));

import { ipcMain } from "electron";
import { registerLicenseIpc } from "./licenseIpc";
import { importRuntimeLicense } from "../licensing/licenseService";

const handleMock = ipcMain.handle as jest.Mock;
const importMock = importRuntimeLicense as jest.Mock;

function handlerFor(channel: string) {
  const registration = handleMock.mock.calls.find(([name]) => name === channel);
  if (!registration) {
    throw new Error(`Missing IPC registration: ${channel}`);
  }
  return registration[1];
}

describe("license IPC", () => {
  const licensePath = path.join(os.tmpdir(), `pos-license-ipc-${process.pid}.rnlc`);

  beforeEach(() => {
    handleMock.mockClear();
    importMock.mockReset();
    fs.writeFileSync(licensePath, "{}\n");
  });

  afterEach(() => {
    fs.rmSync(licensePath, { force: true });
  });

  it("starts POS services after a valid import", async () => {
    const onLicensed = jest.fn().mockResolvedValue(undefined);
    const onStartupError = jest.fn();
    registerLicenseIpc(onLicensed, onStartupError);
    importMock.mockReturnValue({
      ok: true,
      evaluation: {
        openDatabase: true,
        licenseId: "RN-2026-000001",
        customerName: "Example Restaurant",
      },
    });

    const result = await handlerFor("license:import")({ sender: {} }, licensePath);

    expect(onLicensed).toHaveBeenCalledTimes(1);
    expect(onStartupError).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      licenseId: "RN-2026-000001",
      customerName: "Example Restaurant",
    });
  });

  it("keeps the license and shows a restart message when the database fails after import", async () => {
    const onLicensed = jest.fn().mockRejectedValue(new Error("sqlite"));
    const onStartupError = jest.fn();
    registerLicenseIpc(onLicensed, onStartupError);
    importMock.mockReturnValue({
      ok: true,
      evaluation: {
        openDatabase: true,
        licenseId: "RN-2026-000001",
        customerName: "Example Restaurant",
      },
    });

    const result = await handlerFor("license:import")({ sender: {} }, licensePath);

    expect(onStartupError).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      reason: "startup-failed",
      message:
        "This license is valid, but RestoNiti could not start. Restart the app. If it happens again, contact RestoNiti support.",
    });
  });
});
