import type { SalesFactsDto } from "../../../shared/pos";
import { sanitizeSheetName, writeXlsxFile, type XlsxSheet } from "../../../shared/xlsxWrite";

export function exportGstWorkbook(facts: SalesFactsDto, periodLabel: string) {
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
  const sheets: XlsxSheet[] = [{ name: sanitizeSheetName("Summary"), rows: summary }];

  const rates: Array<Array<string | number>> = facts.gst.rates.length
    ? [
        ["GST Rate", "Taxable Value", "CGST", "SGST", "Total Tax"],
        ...facts.gst.rates.map((row) => [row.rateLabel, row.taxable, row.cgst, row.sgst, row.totalTax]),
      ]
    : [["No GST was recorded"]];
  sheets.push({ name: sanitizeSheetName("Tax Rate Summary"), rows: rates });

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
  sheets.push({ name: sanitizeSheetName("Invoice Register"), rows: invoices });

  const fileName = `gst-summary-${periodLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.xlsx`;
  writeXlsxFile(fileName, sheets);
}
