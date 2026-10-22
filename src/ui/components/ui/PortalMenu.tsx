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

  const updatePosition = React.useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      onClose();
      return;
    }
    const menuWidth = Math.max(minWidth, menuRef.current?.offsetWidth || minWidth);
    const menuHeight = menuRef.current?.offsetHeight || 0;
    const left =
      align === "right"
        ? Math.max(8, rect.right - menuWidth)
        : Math.min(rect.left, window.innerWidth - menuWidth - 8);
    let top = rect.bottom + 4;
    if (menuHeight > 0 && top + menuHeight > window.innerHeight - 8) {
      const above = rect.top - menuHeight - 4;
      if (above >= 8) {
        top = above;
      }
    }
    setStyle({
      visibility: "visible",
      top,
      left,
      minWidth,
    });
  }, [align, anchorRef, minWidth, onClose]);

  React.useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const first = menuRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled])',
    );
    first?.focus();
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
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ||
          [],
      );
      if (!items.length) {
        return;
      }
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? current + 1 : current - 1;
      items[(next + items.length) % items.length]?.focus();
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
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={className ? `ui-menu-item ${className}` : "ui-menu-item"}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
