/** Thermal slip builders for customer credit collection and open-bill statements. */

function fmtAmt(value: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateOnly(dateOnly?: string | null) {
  const raw = String(dateOnly || "").trim();
  const [y, m, d] = raw.split("-").map(Number);
  if (!y || !m || !d) {
    return raw || "—";
  }
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(ts = Date.now()) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PAD = "  ";

export function buildCreditCollectionLines(input: {
  hotelName?: string | null;
  customerName: string;
  customerPhone?: string | null;
  amount: number;
  method: string;
  outstandingAfter: number;
  allocations?: Array<{ invoiceNumber?: string | null; amount: number }>;
}): string[] {
  const method = String(input.method || "other").toUpperCase();
  const lines: string[] = [
    ...(input.hotelName ? [`BIGBOLD:${input.hotelName}`] : []),
    "SUBHEADER:PAYMENT RECEIVED",
    "SEP",
    `LEFT:${PAD}Customer: ${input.customerName}`,
    ...(input.customerPhone ? [`LEFT:${PAD}Phone: ${input.customerPhone}`] : []),
    `LEFT:${PAD}Date: ${formatDateTime()}`,
    "SEP",
    `LEFTB:${PAD}Amount: Rs ${fmtAmt(input.amount)}`,
    `LEFT:${PAD}Method: ${method}`,
    `LEFTB:${PAD}Balance now: Rs ${fmtAmt(input.outstandingAfter)}`,
  ];
  const allocations = (input.allocations || []).filter((row) => Number(row.amount) > 0);
  if (allocations.length) {
    lines.push("SEP", `LEFT:${PAD}Applied to:`);
    for (const row of allocations.slice(0, 8)) {
      const inv = row.invoiceNumber || "Open bill";
      lines.push(`LEFT:${PAD}${inv}  Rs ${fmtAmt(row.amount)}`);
    }
    if (allocations.length > 8) {
      lines.push(`LEFT:${PAD}+${allocations.length - 8} more`);
    }
  }
  lines.push("BLANK", "CENTERB:Thank you!", "CUT");
  return lines;
}

export function buildCreditStatementLines(input: {
  hotelName?: string | null;
  customerName: string;
  customerPhone?: string | null;
  outstanding: number;
  overdue: number;
  openBills: Array<{
    invoiceNumber?: string | null;
    dueDate?: string | null;
    remaining: number;
    createdAt: number;
  }>;
  lastPayment?: { amount: number; method?: string | null; createdAt: number } | null;
}): string[] {
  const lines: string[] = [
    ...(input.hotelName ? [`BIGBOLD:${input.hotelName}`] : []),
    "SUBHEADER:ACCOUNT STATEMENT",
    "SEP",
    `LEFT:${PAD}${input.customerName}`,
    ...(input.customerPhone ? [`LEFT:${PAD}${input.customerPhone}`] : []),
    `LEFT:${PAD}Printed: ${formatDateTime()}`,
    "SEP",
    `LEFTB:${PAD}Outstanding: Rs ${fmtAmt(input.outstanding)}`,
    `LEFT:${PAD}Overdue: Rs ${fmtAmt(input.overdue)}`,
    "SEP",
    `LEFT:${PAD}Open bills`,
  ];
  if (!input.openBills.length) {
    lines.push(`LEFT:${PAD}None`);
  } else {
    for (const bill of input.openBills.slice(0, 20)) {
      const inv = bill.invoiceNumber || "Bill";
      lines.push(
        `LEFT:${PAD}${inv}`,
        `LEFT:${PAD}Due ${formatDateOnly(bill.dueDate)}  Rs ${fmtAmt(bill.remaining)}`,
      );
    }
    if (input.openBills.length > 20) {
      lines.push(`LEFT:${PAD}+${input.openBills.length - 20} more open`);
    }
  }
  if (input.lastPayment) {
    lines.push(
      "SEP",
      `LEFT:${PAD}Last payment`,
      `LEFT:${PAD}${formatDateTime(input.lastPayment.createdAt)}`,
      `LEFT:${PAD}Rs ${fmtAmt(input.lastPayment.amount)} ${String(
        input.lastPayment.method || "",
      ).toUpperCase()}`,
    );
  }
  lines.push("BLANK", "CENTERB:Thank you!", "CUT");
  return lines;
}
