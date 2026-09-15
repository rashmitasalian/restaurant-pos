import React from "react";

type VirtualScrollListProps<T> = {
  items: T[];
  itemHeight: number;
  /** Vertical gap between items; included in scroll math. */
  gap?: number;
  overscan?: number;
  /** Used when `fill` is false. */
  maxHeight?: string;
  /** Fill parent height (parent must be a sized flex/grid child). Prefer this over page + list scroll. */
  fill?: boolean;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
};

export function VirtualScrollList<T>({
  items,
  itemHeight,
  gap = 10,
  overscan = 6,
  maxHeight = "calc(100vh - 280px)",
  fill = false,
  getKey,
  renderItem,
}: VirtualScrollListProps<T>) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(480);
  const stride = itemHeight + gap;

  React.useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const updateHeight = () => setViewportHeight(element.clientHeight || 480);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const totalHeight =
    items.length === 0 ? 0 : items.length * itemHeight + Math.max(0, items.length - 1) * gap;
  const startIndex = Math.max(0, Math.floor(scrollTop / stride) - overscan);
  const visibleCount = Math.ceil(viewportHeight / stride) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  const offsetY = startIndex * stride;

  return (
    <div
      ref={containerRef}
      style={{
        overflow: "auto",
        minHeight: 0,
        ...(fill ? { height: "100%", flex: 1 } : { maxHeight }),
      }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: offsetY,
            left: 0,
            right: 0,
            display: "grid",
            gap,
          }}
        >
          {items.slice(startIndex, endIndex).map((item, index) => (
            <React.Fragment key={getKey(item, startIndex + index)}>
              {renderItem(item, startIndex + index)}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
