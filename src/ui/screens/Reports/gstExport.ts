import * as XLSX from "xlsx";
import type { SalesFactsDto } from "../../../shared/pos";

function sheetName(name: string) {
  return name.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "Sheet";
}

export function exportGstWorkbook(facts: SalesFactsDto, periodLabel: string) {
  const workbook = XLSX.utils.book_new();
  const summary: Array<Array<string | number>> = [
    ["Period", periodLabel],
    ["Net Sales", facts.netSales],
    ["CGST", facts.gst.cgst],
    ["SGST", facts.gst.sgst],
    ["Total Tax", facts.gst.totalTax],
    ["Invoice Count", facts.billCount],
    ["Untaxed Net Sales", facts.untaxedNetSales],
  ];
  if (facts.inclusiveResidual !== 0) {
    summary.push(["Tax-inclusive rounding residual", facts.inclusiveResidual]);
  }
  if (!facts.hasTax) {
    summary.push(["Note", "No GST was recorded on bills in this period."]);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), sheetName("Summary"));

  const rates: Array<Array<string | number>> = facts.gst.rates.length
    ? [
        ["GST Rate", "Taxable Value", "CGST", "SGST", "Total Tax"],
        ...facts.gst.rates.map((row) => [row.rateLabel, row.taxable, row.cgst, row.sgst, row.totalTax]),
      ]
    : [["No GST was recorded"]];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rates), sheetName("Tax Rate Summary"));

  const invoices: Array<Array<string | number | null>> = facts.hasTax
    ? [
        ["Invoice", "Date", "Customer", "Taxable Value", "CGST", "SGST", "Total"],
        ...facts.gst.invoices.map((row) => [
          row.invoiceNumber || "",
          row.date,
          row.customerName || "",
          row.taxable,
          row.cgst,
          row.sgst,
          row.total,
        ]),
      ]
    : [
        ["Invoice", "Date", "Customer", "Total"],
        ...facts.gst.invoices.map((row) => [
          row.invoiceNumber || "",
          row.date,
          row.customerName || "",
          row.total,
        ]),
      ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(invoices), sheetName("Invoice Register"));

  const fileName = `gst-summary-${periodLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
