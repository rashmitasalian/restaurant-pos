import React from "react";
import { QRCodeCanvas } from "qrcode.react";

type QRCodeCardProps = {
  value: string;
  title: string;
  exportRef: React.RefObject<HTMLCanvasElement | null>;
};

export function QRCodeCard({ value, title, exportRef }: QRCodeCardProps) {
  return (
    <div className="pm-qr-frame">
      <QRCodeCanvas
        value={value}
        size={288}
        level="M"
        marginSize={4}
        bgColor="#ffffff"
        fgColor="#111827"
        title={title}
      />
      <QRCodeCanvas
        ref={exportRef}
        className="pm-qr-export"
        value={value}
        size={1024}
        level="M"
        marginSize={4}
        bgColor="#ffffff"
        fgColor="#111827"
        title=""
        aria-hidden="true"
      />
    </div>
  );
}
