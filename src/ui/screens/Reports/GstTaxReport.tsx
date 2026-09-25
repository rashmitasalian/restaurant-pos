import type { SalesFactsDto } from "../../../shared/pos";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Stat } from "../../components/ui/Stat";
import { exportGstWorkbook } from "./gstExport";

export function GstTaxReport({
  facts,
  loading,
  periodLabel,
  formatCurrency,
}: {
  facts: SalesFactsDto | null;
  loading: boolean;
  periodLabel: string;
  formatCurrency: (value: number) => string;
}) {
  if (loading && !facts) {
    return <div className="rpt-empty-state">Loading...</div>;
  }
  if (!facts) {
    return <div className="rpt-empty-state">Could not load GST for this range</div>;
  }

  return (
    <div className="rpt-profit">
      {!facts.hasTax ? (
        <p className="rpt-note">No GST was recorded on bills in this period.</p>
      ) : null}
      <div className="rpt-kpi-grid">
        <Stat primary label="Net Sales" value={formatCurrency(facts.netSales)} sub="Taxable value" />
        <Stat label="Invoice Count" value={facts.billCount} sub={periodLabel} />
        {facts.hasTax && (
          <>
            <Stat label="CGST" value={formatCurrency(facts.gst.cgst)} sub="Stored on each bill" />
            <Stat label="SGST" value={formatCurrency(facts.gst.sgst)} sub="Stored on each bill" />
            <Stat label="Total Tax" value={formatCurrency(facts.gst.totalTax)} sub="CGST + SGST" />
          </>
        )}
      </div>
      {facts.hasTax && facts.inclusiveResidual !== 0 && (
        <p className="rpt-note" title="Difference between stored bill total and stored taxable value plus stored tax, caused by tax-inclusive price rounding.">
          Tax-inclusive rounding residual: {formatCurrency(facts.inclusiveResidual)}
        </p>
      )}
      {facts.hasTax && (
        <div className="rpt-card" style={{ padding: 0 }}>
          <div className="rpt-section-title">Tax Rate Summary</div>
          <DataTable
            headers={["GST Rate", "Taxable Value", "CGST", "SGST", "Total Tax"]}
            rows={facts.gst.rates.map((row) => [
              row.rateLabel,
              formatCurrency(row.taxable),
              formatCurrency(row.cgst),
              formatCurrency(row.sgst),
              formatCurrency(row.totalTax),
            ])}
          />
          {facts.untaxedNetSales > 0 && (
            <p className="rpt-note">{formatCurrency(facts.untaxedNetSales)} of Net Sales had no GST recorded.</p>
          )}
        </div>
      )}
      <div className="rpt-card" style={{ padding: 0 }}>
        <div className="rpt-section-title">Invoice Register</div>
        <DataTable
          headers={
            facts.hasTax
              ? ["Invoice", "Date", "Customer", "Taxable Value", "CGST", "SGST", "Total"]
              : ["Invoice", "Date", "Customer", "Total"]
          }
          rows={facts.gst.invoices.map((row) =>
            facts.hasTax
              ? [
                  row.invoiceNumber || "—",
                  row.date,
                  row.customerName || "—",
                  formatCurrency(row.taxable),
                  row.rateLabel ? formatCurrency(row.cgst) : "—",
                  row.rateLabel ? formatCurrency(row.sgst) : "—",
                  formatCurrency(row.total),
                ]
              : [row.invoiceNumber || "—", row.date, row.customerName || "—", formatCurrency(row.total)],
          )}
        />
        {facts.gst.invoices.length === 0 && <div className="rpt-empty-state">No invoices in this range</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="primary" onClick={() => exportGstWorkbook(facts, periodLabel)} disabled={loading}>
          Export for accountant
        </Button>
      </div>
    </div>
  );
}
