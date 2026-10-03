import fs from "fs";
import path from "path";

export type LedgerRow = {
  licenseId: string;
  customer: string;
  installationPublicKeyHash: string;
  machineHash: string;
  issuedAt: string;
  replacementCount: number;
  status: "active" | "replaced";
  replaces?: string;
  notes: string;
};

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export function readLedger(filePath: string): LedgerRow[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LedgerRow);
}

export function nextLicenseId(rows: LedgerRow[], now = new Date()): string {
  const year = now.getUTCFullYear();
  const prefix = `RN-${year}-`;
  let max = 0;
  for (const row of rows) {
    if (!row.licenseId.startsWith(prefix)) {
      continue;
    }
    const value = Number(row.licenseId.slice(prefix.length));
    if (Number.isInteger(value) && value > max) {
      max = value;
    }
  }
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

/** Warnings for the vendor before issuing. Does not block a new restaurant with a similar name. */
export function issuanceWarnings(
  rows: LedgerRow[],
  input: { customer: string; machineHash: string; installationPublicKeyHash: string; replaces?: string },
): string[] {
  const warnings: string[] = [];
  const sameCode = rows.find(
    (row) =>
      row.status === "active" &&
      row.machineHash === input.machineHash &&
      row.installationPublicKeyHash === input.installationPublicKeyHash,
  );
  if (sameCode) {
    warnings.push(`This installation code already has active license ${sameCode.licenseId}.`);
  }
  const customerKey = input.customer.trim().toLowerCase();
  const sameName = rows.filter(
    (row) => row.status === "active" && row.customer.trim().toLowerCase() === customerKey,
  );
  if (!input.replaces && sameName.length > 0) {
    warnings.push(
      `"${input.customer}" already has active license ${sameName
        .map((row) => row.licenseId)
        .join(", ")}. For a replacement PC, pass --replaces <licenseId>.`,
    );
  }
  return warnings;
}

export function assertReplaceable(rows: LedgerRow[], replaces: string) {
  const previous = rows.find((row) => row.licenseId === replaces);
  if (!previous) {
    throw new LedgerError(`No ledger row for ${replaces}.`);
  }
  if (previous.status !== "active") {
    throw new LedgerError(`${replaces} is already marked replaced.`);
  }
}

export function recordIssuance(
  filePath: string,
  input: Omit<LedgerRow, "replacementCount" | "status" | "notes" | "replaces"> & {
    notes?: string;
    replaces?: string;
  },
): LedgerRow {
  const rows = readLedger(filePath);
  if (rows.some((row) => row.licenseId === input.licenseId)) {
    throw new LedgerError(`License id ${input.licenseId} is already in the ledger.`);
  }
  let replacementCount = 0;
  if (input.replaces) {
    assertReplaceable(rows, input.replaces);
    const previous = rows.find((row) => row.licenseId === input.replaces)!;
    previous.status = "replaced";
    replacementCount = previous.replacementCount + 1;
  }
  const saved: LedgerRow = {
    licenseId: input.licenseId,
    customer: input.customer,
    installationPublicKeyHash: input.installationPublicKeyHash,
    machineHash: input.machineHash,
    issuedAt: input.issuedAt,
    replacementCount,
    status: "active",
    ...(input.replaces ? { replaces: input.replaces } : {}),
    notes: input.notes ?? "",
  };
  rows.push(saved);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
    mode: 0o600,
  });
  fs.renameSync(tempPath, filePath);
  return saved;
}
