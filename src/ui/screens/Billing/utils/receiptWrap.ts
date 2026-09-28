export const RECEIPT_TEXT_WIDTH = 42;

export const wrapText = (value: string, width: number) => {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) {
    lines.push(current);
  }
  return lines;
};
