import React from "react";
import { getRestaurant } from "../api/getRestaurantMenu";
import { QRCodeCard } from "../components/QRCodeCard";
import type { Restaurant } from "../types/menu";
import { downloadQrPng, getPublicMenuUrl, isLocalhostMenuUrl, printQr } from "../utils/qr";

type QRMenuProps = {
  slug: string | null;
};

export function QRMenu({ slug }: QRMenuProps) {
  const [restaurant, setRestaurant] = React.useState<Restaurant | null | undefined>(undefined);
  const [copied, setCopied] = React.useState(false);
  const exportRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    if (!slug) {
      setRestaurant(null);
      return;
    }
    setRestaurant(getRestaurant(slug));
  }, [slug]);

  if (restaurant === undefined) {
    return (
      <div className="pm-page">
        <div className="pm-shell">
          <main className="pm-status" aria-busy="true">
            <p className="pm-status-title">Loading QR</p>
            <p className="pm-status-copy">Just a moment.</p>
          </main>
        </div>
      </div>
    );
  }

  if (!restaurant || !slug) {
    return (
      <div className="pm-page">
        <div className="pm-shell">
          <main className="pm-status">
            <p className="pm-status-kicker">RestoNiti</p>
            <h1 className="pm-status-title">Restaurant not found</h1>
            <p className="pm-status-copy">This menu is unavailable or the link may be incorrect.</p>
          </main>
        </div>
      </div>
    );
  }

  const menuUrl = getPublicMenuUrl(restaurant.slug);
  const localhostQr = isLocalhostMenuUrl(menuUrl);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(menuUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const canvas = exportRef.current;
    if (!canvas) {
      return;
    }
    downloadQrPng(canvas, `${restaurant.slug}-menu-qr.png`);
  };

  return (
    <div className="pm-page pm-qr-page">
      <div className="pm-shell pm-qr-shell">
        <article className="pm-qr-poster">
          <p className="pm-status-kicker">RestoNiti</p>
          <h1 className="pm-qr-name">{restaurant.name}</h1>
          <p className="pm-qr-headline">Scan to view our menu</p>
          <QRCodeCard
            value={menuUrl}
            title={`QR code for ${restaurant.name} menu`}
            exportRef={exportRef}
          />
          <p className="pm-qr-hint">Scan this QR code with your phone</p>
          <p className="pm-qr-hint-sub">No app required</p>
          <div className="pm-qr-url">
            <p className="pm-qr-url-label">Menu URL</p>
            <p className="pm-qr-url-value">{menuUrl}</p>
            <button type="button" className="pm-qr-copy" onClick={() => void copyLink()}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          {localhostQr ? (
            <p className="pm-qr-local-note">
              This QR uses a local address, so another phone cannot open it. Open this page from
              your computer&apos;s network URL, or set VITE_PUBLIC_MENU_BASE_URL to the live menu
              domain.
            </p>
          ) : null}
          <div className="pm-qr-actions">
            <button type="button" className="pm-qr-btn" onClick={download}>
              Download QR
            </button>
            <button type="button" className="pm-qr-btn pm-qr-btn-secondary" onClick={printQr}>
              Print QR
            </button>
          </div>
          <p className="pm-qr-powered">Powered by RestoNiti</p>
        </article>
      </div>
    </div>
  );
}
