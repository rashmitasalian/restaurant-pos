import React from "react";

type VirtualScrollListProps<T> = {
  items: T[];
  itemHeight: number;
  overscan?: number;
  maxHeight?: string;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
};

export function VirtualScrollList<T>({
  items,
  itemHeight,
  overscan = 6,
  maxHeight = "calc(100vh - 280px)",
  getKey,
  renderItem,
}: VirtualScrollListProps<T>) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(480);

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

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  const offsetY = startIndex * itemHeight;

  return (
    <div
      ref={containerRef}
      style={{ overflow: "auto", maxHeight }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: offsetY, left: 0, right: 0, display: "grid", gap: 10 }}>
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
