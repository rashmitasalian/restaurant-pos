jest.mock("electron", () => ({
  app: { getPath: jest.fn(() => "C:\\tmp") },
  dialog: {
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn(),
  },
  ipcMain: { handle: jest.fn() },
}));

jest.mock("../services/sessionManager", () => ({
  createMainSession: jest.fn(),
  destroyMainSession: jest.fn(),
  getMainSession: jest.fn(),
  refreshMainSession: jest.fn(),
}));

jest.mock("../services/posService", () => ({
  posService: {
    getUserByUsername: jest.fn(),
    addPrintJob: jest.fn(),
    listPrintJobs: jest.fn(),
    listGroceryItems: jest.fn(),
    createGroceryItem: jest.fn(),
    getFoodCostSummary: jest.fn(),
    listAttendance: jest.fn(),
    upsertAttendanceRows: jest.fn(),
  },
}));

jest.mock("../services/updateService", () => ({
  updateService: {
    appInfo: jest.fn(),
    checkForUpdates: jest.fn(),
    prepareUpdate: jest.fn(),
    launchPreparedUpdate: jest.fn(),
    getStatus: jest.fn(),
    processStartupState: jest.fn(),
    rollbackLast: jest.fn(),
    exportDiagnostics: jest.fn(),
  },
}));

import { ipcMain } from "electron";
import { registerPosIpc } from "./posIpc";
import { posService } from "../services/posService";
import { getMainSession } from "../services/sessionManager";
import { updateService } from "../services/updateService";

const handleMock = ipcMain.handle as jest.Mock;
const getSessionMock = getMainSession as jest.Mock;
const getUserMock = posService.getUserByUsername as jest.Mock;
const addPrintJobMock = posService.addPrintJob as jest.Mock;
const listPrintJobsMock = posService.listPrintJobs as jest.Mock;
const listGroceryItemsMock = posService.listGroceryItems as jest.Mock;
const createGroceryItemMock = posService.createGroceryItem as jest.Mock;
const getFoodCostSummaryMock = posService.getFoodCostSummary as jest.Mock;
const listAttendanceMock = posService.listAttendance as jest.Mock;
const upsertAttendanceRowsMock = posService.upsertAttendanceRows as jest.Mock;
const appInfoMock = updateService.appInfo as jest.Mock;
const checkForUpdatesMock = updateService.checkForUpdates as jest.Mock;
const prepareUpdateMock = updateService.prepareUpdate as jest.Mock;
const launchPreparedUpdateMock = updateService.launchPreparedUpdate as jest.Mock;
const getStatusMock = updateService.getStatus as jest.Mock;
const processStartupStateMock = updateService.processStartupState as jest.Mock;
const rollbackLastMock = updateService.rollbackLast as jest.Mock;
const exportDiagnosticsMock = updateService.exportDiagnostics as jest.Mock;

function handlerFor(channel: string) {
  const registration = handleMock.mock.calls.find(([name]) => name === channel);
  if (!registration) {
    throw new Error(`Missing IPC registration: ${channel}`);
  }
  return registration[1];
}

function invoke(channel: string, ...args: any[]) {
  return handlerFor(channel)({ sender: { id: 1 } }, "token", ...args);
}

function expectForbidden(channel: string, ...args: any[]) {
  return expect(Promise.resolve().then(() => invoke(channel, ...args))).rejects.toThrow("forbidden");
}

describe("print queue IPC access", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerPosIpc(() => null);
    getSessionMock.mockReturnValue({ token: "token", username: "cashier" });
  });

  it("allows authenticated cashiers to enqueue print jobs", () => {
    getUserMock.mockReturnValue({
      username: "cashier",
      role: "cashier",
      active: true,
      requirePasswordChange: false,
    });
    addPrintJobMock.mockReturnValue({ _id: "print-job:1" });

    const result = handlerFor("pos:print-queue:add")(
      { sender: { id: 1 } },
      "token",
      { printerName: "Kitchen", jobType: "kot", content: "KOT" },
    );

    expect(result).toEqual({ _id: "print-job:1" });
    expect(addPrintJobMock).toHaveBeenCalledTimes(1);
  });

  it("blocks cashier access to print queue management", () => {
    getUserMock.mockReturnValue({
      username: "cashier",
      role: "cashier",
      active: true,
      requirePasswordChange: false,
    });

    expect(() => invoke("pos:print-queue:list")).toThrow("forbidden");
    expect(listPrintJobsMock).not.toHaveBeenCalled();
  });

  it("allows admins to manage the print queue", () => {
    getSessionMock.mockReturnValue({ token: "token", username: "admin" });
    getUserMock.mockReturnValue({
      username: "admin",
      role: "admin",
      active: true,
      requirePasswordChange: false,
    });
    listPrintJobsMock.mockReturnValue([{ _id: "print-job:1" }]);

    expect(invoke("pos:print-queue:list")).toEqual([{ _id: "print-job:1" }]);
  });

  it("allows authenticated users to read app info", () => {
    getUserMock.mockReturnValue({
      username: "cashier",
      role: "cashier",
      active: true,
      requirePasswordChange: false,
    });
    appInfoMock.mockReturnValue({ version: "1.0.0" });

    expect(invoke("pos:app:info")).toEqual({ version: "1.0.0" });
  });

  it.each([
    ["pos:updates:check", []],
    ["pos:updates:prepare", [{ allowBusinessActivity: true }]],
    ["pos:updates:launch", []],
    ["pos:updates:status", []],
    ["pos:updates:startup-health", []],
    ["pos:updates:rollback", [{ confirmed: true }]],
    ["pos:support:export-diagnostics", []],
  ])("blocks cashier access to %s", async (channel, args) => {
    getUserMock.mockReturnValue({
      username: "cashier",
      role: "cashier",
      active: true,
      requirePasswordChange: false,
    });

    await expectForbidden(channel, ...(args as any[]));
    expect(checkForUpdatesMock).not.toHaveBeenCalled();
    expect(prepareUpdateMock).not.toHaveBeenCalled();
    expect(launchPreparedUpdateMock).not.toHaveBeenCalled();
    expect(getStatusMock).not.toHaveBeenCalled();
    expect(processStartupStateMock).not.toHaveBeenCalled();
    expect(rollbackLastMock).not.toHaveBeenCalled();
    expect(exportDiagnosticsMock).not.toHaveBeenCalled();
  });

  it("blocks cashiers from grocery APIs and food cost reports", async () => {
    getUserMock.mockReturnValue({
      username: "cashier",
      role: "cashier",
      active: true,
      requirePasswordChange: false,
    });

    await expectForbidden("pos:grocery:items:list");
    await expectForbidden("pos:grocery:items:create", { name: "Tomato" });
    await expectForbidden("pos:reports:food-cost-summary", { from: 1, to: 2 });
    expect(listGroceryItemsMock).not.toHaveBeenCalled();
    expect(createGroceryItemMock).not.toHaveBeenCalled();
    expect(getFoodCostSummaryMock).not.toHaveBeenCalled();
  });

  it("blocks cashiers from attendance APIs", async () => {
    getUserMock.mockReturnValue({
      username: "cashier",
      role: "cashier",
      active: true,
      requirePasswordChange: false,
    });

    await expectForbidden("pos:attendance:list", { date: "2026-08-01" });
    await expectForbidden("pos:attendance:upsert", {
      attendanceDate: "2026-08-01",
      rows: [],
    });
    expect(listAttendanceMock).not.toHaveBeenCalled();
    expect(upsertAttendanceRowsMock).not.toHaveBeenCalled();
  });

  it("allows admins to use grocery APIs and food cost reports", async () => {
    getSessionMock.mockReturnValue({ token: "token", username: "admin" });
    getUserMock.mockReturnValue({
      username: "admin",
      role: "admin",
      active: true,
      requirePasswordChange: false,
    });
    listGroceryItemsMock.mockReturnValue([{ id: "grocery-item:1" }]);
    createGroceryItemMock.mockReturnValue({ id: "grocery-item:2" });
    getFoodCostSummaryMock.mockReturnValue({ grocerySpend: 100 });

    expect(invoke("pos:grocery:items:list")).toEqual([{ id: "grocery-item:1" }]);
    expect(invoke("pos:grocery:items:create", { name: "Milk" })).toEqual({ id: "grocery-item:2" });
    expect(invoke("pos:reports:food-cost-summary", { from: 1, to: 2 })).toEqual({
      grocerySpend: 100,
    });
  });

  it("allows admins to use attendance APIs", async () => {
    getSessionMock.mockReturnValue({ token: "token", username: "admin" });
    getUserMock.mockReturnValue({
      username: "admin",
      role: "admin",
      active: true,
      requirePasswordChange: false,
    });
    listAttendanceMock.mockReturnValue([{ id: "attendance:1" }]);
    upsertAttendanceRowsMock.mockReturnValue([{ id: "attendance:1" }]);

    expect(invoke("pos:attendance:list", { date: "2026-08-01" })).toEqual([
      { id: "attendance:1" },
    ]);
    expect(
      invoke("pos:attendance:upsert", { attendanceDate: "2026-08-01", rows: [] }),
    ).toEqual([{ id: "attendance:1" }]);
  });

  it.each([
    ["pos:updates:check", checkForUpdatesMock, [], { updateAvailable: false }],
    ["pos:updates:prepare", prepareUpdateMock, [{ allowBusinessActivity: true }], { ok: true }],
    ["pos:updates:launch", launchPreparedUpdateMock, [], { ok: true }],
    ["pos:updates:status", getStatusMock, [], { state: { status: "prepared" } }],
    ["pos:updates:startup-health", processStartupStateMock, [], { status: "successful" }],
    ["pos:updates:rollback", rollbackLastMock, [{ confirmed: true }], { ok: true }],
    ["pos:support:export-diagnostics", exportDiagnosticsMock, [], { ok: true }],
  ])("allows admins to call %s", async (channel, serviceMock, args, result) => {
    getSessionMock.mockReturnValue({ token: "token", username: "admin" });
    getUserMock.mockReturnValue({
      username: "admin",
      role: "admin",
      active: true,
      requirePasswordChange: false,
    });
    serviceMock.mockReturnValue(result);

    await expect(Promise.resolve(invoke(channel, ...(args as any[])))).resolves.toEqual(result);
    expect(serviceMock).toHaveBeenCalledTimes(1);
  });
});
