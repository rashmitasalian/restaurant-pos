import React from "react";

type Variant = "auth" | "page" | "manage";

type Props = {
  variant?: Variant;
  label?: string;
};

export function PageLoadingFallback({ variant = "page", label }: Props) {
  const statusLabel =
    label ||
    (variant === "auth"
      ? "Signing you in"
      : variant === "manage"
        ? "Opening Manage"
        : "Loading page");

  if (variant === "auth") {
    return (
      <div className="page-loader page-loader-auth" role="status" aria-live="polite">
        <div className="page-loader-brand" aria-hidden="true">
          <span className="page-loader-mark" />
          <span className="page-loader-wordmark">
            <span>Resto</span>
            <span>Niti</span>
          </span>
        </div>
        <div className="page-loader-track" aria-hidden="true">
          <div className="page-loader-bar" />
        </div>
        <p className="page-loader-caption">{statusLabel}</p>
      </div>
    );
  }

  if (variant === "manage") {
    return (
      <div className="page-loader page-loader-manage" role="status" aria-live="polite">
        <div className="page-loader-manage-rail" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="page-loader-rail-item" />
          ))}
        </div>
        <div className="page-loader-manage-body">
          <div className="page-loader-toolbar" aria-hidden="true">
            <div className="page-loader-title-block" />
            <div className="page-loader-actions" />
          </div>
          <div className="page-loader-card-grid" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="page-loader-card" />
            ))}
          </div>
        </div>
        <p className="page-loader-caption page-loader-caption-inline">{statusLabel}</p>
      </div>
    );
  }

  return (
    <div className="page-loader page-loader-page" role="status" aria-live="polite">
      <div className="page-loader-toolbar" aria-hidden="true">
        <div className="page-loader-title-block" />
        <div className="page-loader-actions" />
      </div>
      <div className="page-loader-content" aria-hidden="true">
        <div className="page-loader-panel page-loader-panel-wide" />
        <div className="page-loader-panel" />
        <div className="page-loader-panel" />
      </div>
      <p className="page-loader-caption page-loader-caption-inline">{statusLabel}</p>
    </div>
  );
}
