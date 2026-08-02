import React from "react";

type AttendanceShortcutHandlers = {
  onSave: () => void;
  onMarkAllPresent: () => void;
  onMarkAllAbsent: () => void;
  onNextRow: () => void;
  onPreviousRow: () => void;
};

function isTextInputElement(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || element.isContentEditable;
}

export function useAttendanceShortcuts(handlers: AttendanceShortcutHandlers) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (ctrlOrMeta && key === "s") {
        event.preventDefault();
        handlers.onSave();
        return;
      }
      if (ctrlOrMeta && key === "p") {
        event.preventDefault();
        handlers.onMarkAllPresent();
        return;
      }
      if (ctrlOrMeta && key === "a") {
        event.preventDefault();
        handlers.onMarkAllAbsent();
        return;
      }
      if (!event.altKey) {
        return;
      }
      if (key === "n") {
        event.preventDefault();
        handlers.onNextRow();
        return;
      }
      if (key === "p") {
        event.preventDefault();
        handlers.onPreviousRow();
        return;
      }
      if (key === "arrowdown" && isTextInputElement(event.target)) {
        event.preventDefault();
        handlers.onNextRow();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
