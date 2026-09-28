import React from "react";
import {
  buildReceiptQrBitmap,
  normalizeReceiptNote,
  RECEIPT_QR_SAMPLE_AMOUNT,
  receiptQrRgba,
  type ReceiptQrMode,
} from "../Billing/utils/receiptQr";
import { RECEIPT_TEXT_WIDTH, wrapText } from "../Billing/utils/receiptWrap";

export function ReceiptQrPreview({
  mode,
  payload,
  note,
}: {
  mode: Exclude<ReceiptQrMode, "off">;
  payload: string | null;
  note: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const normalizedNote = normalizeReceiptNote(note);
  const noteLines = normalizedNote ? wrapText(normalizedNote, RECEIPT_TEXT_WIDTH) : [];

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload) {
      return;
    }
    const raster = buildReceiptQrBitmap(payload);
    const ctx = canvas.getContext("2d");
    if (!raster || !ctx) {
      return;
    }
    const image = ctx.createImageData(raster.width, raster.height);
    image.data.set(receiptQrRgba(raster));
    ctx.putImageData(image, 0, 0);
  }, [payload]);

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 10,
        border: "1px dashed var(--pos-border,var(--pos-line))",
        background: "var(--pos-surface)",
        display: "grid",
        justifyItems: "center",
        gap: 8,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pos-tx-sub)" }}>
        {mode === "pay" ? "Sample payment QR" : "Sample feedback QR"}
      </div>
      {mode === "pay" ? (
        <div style={{ fontSize: 13, fontWeight: 700 }}>₹{RECEIPT_QR_SAMPLE_AMOUNT.toFixed(2)}</div>
      ) : null}
      <div style={{ fontSize: 13, fontWeight: 700 }}>Thank you! Visit again.</div>
      {noteLines.map((line) => (
        <div key={line} style={{ fontSize: 13 }}>
          {line}
        </div>
      ))}
      {payload ? (
        <canvas
          ref={canvasRef}
          width={240}
          height={240}
          aria-label={mode === "pay" ? "Sample payment QR code" : "Sample feedback QR code"}
          style={{ width: 160, height: 160, imageRendering: "pixelated" }}
        />
      ) : (
        <div style={{ fontSize: 12, color: "var(--pos-tx-sub)" }}>
          The QR appears here once the {mode === "pay" ? "UPI ID" : "feedback link"} is valid.
        </div>
      )}
      {payload ? (
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.45,
            color: "var(--pos-tx-sub)",
            wordBreak: "break-all",
            maxWidth: 420,
          }}
        >
          {payload}
        </div>
      ) : null}
    </div>
  );
}
