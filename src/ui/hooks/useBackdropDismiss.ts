import React from "react";

/**
 * A backdrop dismiss counts only when the pointer goes down and up on the
 * backdrop itself. A drag that starts in a field and ends outside must not
 * count: the browser then fires click on the backdrop.
 */
export function isBackdropPress(
  downTarget: unknown,
  upTarget: unknown,
  backdrop: unknown,
): boolean {
  return downTarget != null && downTarget === backdrop && upTarget === backdrop;
}

type BackdropDismissProps = {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
};

export function useBackdropDismiss(onDismiss: () => void, enabled = true): BackdropDismissProps {
  const downTargetRef = React.useRef<EventTarget | null>(null);
  const onDismissRef = React.useRef(onDismiss);
  const enabledRef = React.useRef(enabled);
  onDismissRef.current = onDismiss;
  enabledRef.current = enabled;

  return React.useMemo(
    () => ({
      onPointerDown(event) {
        downTargetRef.current = event.target;
      },
      onPointerUp(event) {
        const downTarget = downTargetRef.current;
        downTargetRef.current = null;
        if (
          enabledRef.current &&
          isBackdropPress(downTarget, event.target, event.currentTarget)
        ) {
          onDismissRef.current();
        }
      },
      onPointerCancel() {
        downTargetRef.current = null;
      },
    }),
    [],
  );
}
