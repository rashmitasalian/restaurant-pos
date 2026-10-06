/**
 * Word-wrap a monospace column. Tokens longer than the column are split so
 * nothing is dropped and each line stays within the width.
 */
export function wrapFixedWidth(value: string, width: number): string[] {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (width < 1) {
    return [text];
  }
  if (!text) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";
  const flush = () => {
    if (current) {
      lines.push(current);
      current = "";
    }
  };

  for (const word of text.split(" ")) {
    if (word.length > width) {
      flush();
      for (let index = 0; index < word.length; index += width) {
        const piece = word.slice(index, index + width);
        if (piece.length === width) {
          lines.push(piece);
        } else {
          current = piece;
        }
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      flush();
      current = word;
    } else {
      current = next;
    }
  }
  flush();
  return lines.length ? lines : [""];
}

/** Item name stays in its column. Qty and amounts stay on the first line. */
export function formatWrappedColumnRows(
  prefix: string,
  name: string,
  nameWidth: number,
  tail: string,
): string[] {
  const chunks = wrapFixedWidth(name, nameWidth);
  const blankTail = " ".repeat(tail.length);
  return chunks.map((chunk, index) => {
    const cell = chunk.length >= nameWidth ? chunk : chunk.padEnd(nameWidth, " ");
    return `${prefix}${cell}${index === 0 ? tail : blankTail}`;
  });
}
