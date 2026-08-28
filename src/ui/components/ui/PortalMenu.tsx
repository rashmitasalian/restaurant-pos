import React from "react";
import { createPortal } from "react-dom";

type PortalMenuProps = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  align?: "left" | "right";
  minWidth?: number;
};

export function PortalMenu({
  open,
  anchorRef,
  onClose,
  children,
  align = "left",
  minWidth = 168,
}: PortalMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [style, setStyle] = React.useState<React.CSSProperties>({ visibility: "hidden" });

  React.useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const menuWidth = Math.max(minWidth, menuRef.current?.offsetWidth || minWidth);
    const left =
      align === "right"
        ? Math.max(8, rect.right - menuWidth)
        : Math.min(rect.left, window.innerWidth - menuWidth - 8);
    const top = Math.min(rect.bottom + 4, window.innerHeight - 8);
    setStyle({
      visibility: "visible",
      top,
      left,
      minWidth,
    });
  }, [align, anchorRef, minWidth, open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div ref={menuRef} className="ui-menu" style={style} role="menu">
      {children}
    </div>,
    document.body,
  );
}

export function PortalMenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="ui-menu-item"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
