export type PrintJobType = "receipt" | "kot";

function pushStr(cmds: number[], value: string) {
  for (const char of value) {
    cmds.push(char.charCodeAt(0));
  }
}

function pushLine(cmds: number[], value: string) {
  pushStr(cmds, value);
  cmds.push(0x0a);
}

/** 5×7 glyphs, bit 4 = leftmost pixel. Unknown chars use a hollow box. */
const FONT_5X7: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "!": [4, 4, 4, 4, 0, 4, 0],
  '"': [10, 10, 10, 0, 0, 0, 0],
  "#": [10, 31, 10, 10, 31, 10, 0],
  "%": [17, 18, 4, 4, 8, 17, 0],
  "&": [4, 10, 4, 13, 18, 13, 0],
  "'": [4, 4, 8, 0, 0, 0, 0],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "*": [0, 10, 4, 31, 4, 10, 0],
  "+": [0, 4, 4, 31, 4, 4, 0],
  ",": [0, 0, 0, 0, 4, 4, 8],
  "-": [0, 0, 0, 31, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 4, 0],
  "/": [1, 2, 4, 4, 8, 16, 0],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [14, 17, 1, 6, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  ":": [0, 4, 0, 0, 4, 0, 0],
  ";": [0, 4, 0, 0, 4, 4, 8],
  "<": [2, 4, 8, 16, 8, 4, 2],
  "=": [0, 0, 31, 0, 31, 0, 0],
  ">": [8, 4, 2, 1, 2, 4, 8],
  "?": [14, 17, 1, 6, 4, 0, 4],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 19, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [1, 1, 1, 1, 17, 17, 14],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [14, 17, 16, 14, 1, 17, 14],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "[": [14, 8, 8, 8, 8, 8, 14],
  "]": [14, 2, 2, 2, 2, 2, 14],
  _: [0, 0, 0, 0, 0, 0, 31],
  a: [0, 0, 14, 1, 15, 17, 15],
  b: [16, 16, 30, 17, 17, 17, 30],
  c: [0, 0, 14, 16, 16, 17, 14],
  d: [1, 1, 15, 17, 17, 17, 15],
  e: [0, 0, 14, 17, 31, 16, 14],
  f: [6, 8, 28, 8, 8, 8, 8],
  g: [0, 15, 17, 17, 15, 1, 14],
  h: [16, 16, 30, 17, 17, 17, 17],
  i: [4, 0, 12, 4, 4, 4, 14],
  j: [2, 0, 6, 2, 2, 18, 12],
  k: [16, 16, 18, 20, 24, 20, 18],
  l: [12, 4, 4, 4, 4, 4, 14],
  m: [0, 0, 26, 21, 21, 21, 17],
  n: [0, 0, 30, 17, 17, 17, 17],
  o: [0, 0, 14, 17, 17, 17, 14],
  p: [0, 30, 17, 17, 30, 16, 16],
  q: [0, 15, 17, 17, 15, 1, 1],
  r: [0, 0, 22, 25, 16, 16, 16],
  s: [0, 0, 14, 16, 14, 1, 30],
  t: [8, 8, 28, 8, 8, 8, 6],
  u: [0, 0, 17, 17, 17, 17, 15],
  v: [0, 0, 17, 17, 17, 10, 4],
  w: [0, 0, 17, 17, 21, 21, 10],
  x: [0, 0, 17, 10, 4, 10, 17],
  y: [0, 17, 17, 15, 1, 17, 14],
  z: [0, 0, 31, 2, 4, 8, 31],
};

const UNKNOWN_GLYPH = [14, 17, 1, 2, 4, 0, 4];

/**
 * Font A is 12 dots wide. Header columns are PAD(2) + item(32) + qty(8).
 * Raster must use the same pitch so "Fries" sits under Cancel Item and qty under Qty.
 */
const FONT_A_DOTS = 12;
const VOID_RASTER_WIDTH = 576;
const VOID_SCALE_X = 2;
const VOID_SCALE_Y = 4;
const VOID_CHAR_W = FONT_A_DOTS;
const VOID_CHAR_H = 7 * VOID_SCALE_Y + 10;
const VOID_STRIKE_THICKNESS = 2;
const VOID_GLYPH_LEFT = 1;

export function buildStruckTextRaster(text: string): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const width = VOID_RASTER_WIDTH;
  const height = VOID_CHAR_H;
  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height);
  const raw = String(text || "");
  const originY = 4;
  const maxChars = Math.floor(width / VOID_CHAR_W);

  const setPixel = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }
    data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
  };

  let firstInkX = -1;
  let lastInkX = 0;
  for (let i = 0; i < raw.length && i < maxChars; i += 1) {
    const ch = raw[i];
    if (ch === " ") {
      continue;
    }
    const glyph = FONT_5X7[ch] || UNKNOWN_GLYPH;
    const originX = i * VOID_CHAR_W + VOID_GLYPH_LEFT;
    for (let row = 0; row < 7; row += 1) {
      const bits = glyph[row] || 0;
      for (let col = 0; col < 5; col += 1) {
        if ((bits & (0x10 >> col)) === 0) {
          continue;
        }
        const px = originX + col * VOID_SCALE_X;
        const py = originY + row * VOID_SCALE_Y;
        for (let dy = 0; dy < VOID_SCALE_Y; dy += 1) {
          for (let dx = 0; dx < VOID_SCALE_X; dx += 1) {
            setPixel(px + dx, py + dy);
          }
        }
        if (firstInkX < 0) {
          firstInkX = px;
        }
        lastInkX = Math.max(lastInkX, px + VOID_SCALE_X);
      }
    }
  }

  if (firstInkX >= 0) {
    const strikeY =
      originY + Math.floor((7 * VOID_SCALE_Y) / 2) - Math.floor(VOID_STRIKE_THICKNESS / 2);
    for (let y = strikeY; y < strikeY + VOID_STRIKE_THICKNESS; y += 1) {
      for (let x = firstInkX; x <= lastInkX; x += 1) {
        setPixel(x, y);
      }
    }
  }

  return { width, height, data };
}

/**
 * Peri Peri and similar clones treat CR as a newline and ignore reverse-feed,
 * so dash overprint always lands on the next line. Bake the item + strike into
 * one GS v 0 raster instead (same command as receipt logos).
 */
function pushVoidItemLine(cmds: number[], text: string) {
  const raster = buildStruckTextRaster(text);
  const ESC = 0x1b;
  const GS = 0x1d;
  const widthBytes = Math.ceil(raster.width / 8);
  cmds.push(ESC, 0x61, 0x00);
  cmds.push(
    GS,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    raster.height & 0xff,
    (raster.height >> 8) & 0xff,
  );
  for (let i = 0; i < raster.data.length; i += 1) {
    cmds.push(raster.data[i]);
  }
  cmds.push(0x0a);
}

function pushMonoImage(cmds: number[], directive: string) {
  const [, widthRaw, heightRaw, dataBase64] = directive.split(":");
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !dataBase64
  ) {
    return;
  }
  const widthBytes = Math.ceil(width / 8);
  const MAX_WIDTH = 576;
  const MAX_HEIGHT = 512;
  const MAX_BYTES = 64 * 1024;
  if (
    width > MAX_WIDTH ||
    height > MAX_HEIGHT ||
    !dataBase64 ||
    dataBase64.length > MAX_BYTES * 2
  ) {
    return;
  }
  const data = Buffer.from(dataBase64, "base64");
  if (data.length < widthBytes * height || data.length > MAX_BYTES) {
    return;
  }

  const ESC = 0x1b;
  const GS = 0x1d;
  cmds.push(ESC, 0x61, 0x01);
  cmds.push(
    GS,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  );
  for (let i = 0; i < widthBytes * height; i += 1) {
    cmds.push(data[i]);
  }
  cmds.push(0x0a);
}

export function buildEscPosBuffer(
  type: PrintJobType,
  _text: string,
  lines: string[],
  _hotelName = "",
): Buffer {
  const ESC = 0x1b;
  const GS = 0x1d;
  const LF = 0x0a;
  const cmds: number[] = [];

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("print-lines-required");
  }

  cmds.push(ESC, 0x40);

  if (type === "kot") {
    const separator = "------------------------------------------";
    cmds.push(ESC, 0x40);
    cmds.push(ESC, 0x4d, 0x00);

    for (const directive of lines) {
      if (directive === "SEP" || directive === "SEPB") {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        pushLine(cmds, separator);
      } else if (directive.startsWith("IMAGE_MONO:") || directive.startsWith("QR_MONO:")) {
        pushMonoImage(cmds, directive);
      } else if (directive === "BLANK") {
        cmds.push(LF);
      } else if (directive === "CUT") {
        cmds.push(LF, LF);
        cmds.push(GS, 0x56, 0x41, 0x00);
      } else if (directive.startsWith("BIGBOLD:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x01);
        cmds.push(GS, 0x21, 0x01);
        cmds.push(ESC, 0x45, 0x01);
        pushLine(cmds, directive.slice(8));
        cmds.push(ESC, 0x45, 0x00);
        cmds.push(GS, 0x21, 0x00);
      } else if (directive.startsWith("SUBHEADER:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x01);
        cmds.push(ESC, 0x45, 0x01);
        pushLine(cmds, directive.slice(10));
        cmds.push(ESC, 0x45, 0x00);
      } else if (directive.startsWith("CENTER:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x01);
        pushLine(cmds, directive.slice(7));
      } else if (directive.startsWith("LEFTDHVOID:")) {
        pushVoidItemLine(cmds, directive.slice(11));
      } else if (directive.startsWith("LEFTDH:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        cmds.push(GS, 0x21, 0x01);
        cmds.push(ESC, 0x45, 0x01);
        pushLine(cmds, directive.slice(7));
        cmds.push(ESC, 0x45, 0x00);
        cmds.push(GS, 0x21, 0x00);
      } else if (directive.startsWith("LEFT:") || directive.startsWith("LEFTB:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        pushLine(cmds, directive.startsWith("LEFT:") ? directive.slice(5) : directive.slice(6));
      } else if (directive.startsWith("BOLDLEFT:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        cmds.push(ESC, 0x45, 0x01);
        pushLine(cmds, directive.slice(9));
        cmds.push(ESC, 0x45, 0x00);
      } else {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        pushLine(cmds, directive);
      }
    }
  } else {
    const separator = "------------------------------------------";
    cmds.push(ESC, 0x40);
    cmds.push(ESC, 0x4d, 0x00);

    for (const directive of lines) {
      if (directive === "SEP" || directive === "SEPB") {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        pushLine(cmds, separator);
      } else if (directive.startsWith("IMAGE_MONO:") || directive.startsWith("QR_MONO:")) {
        pushMonoImage(cmds, directive);
      } else if (directive === "BLANK") {
        cmds.push(LF);
      } else if (directive === "CUT") {
        cmds.push(LF, LF);
        cmds.push(GS, 0x56, 0x41, 0x00);
      } else if (directive.startsWith("BIGBOLD:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x01);
        cmds.push(GS, 0x21, 0x01);
        cmds.push(ESC, 0x45, 0x01);
        pushLine(cmds, directive.slice(8));
        cmds.push(ESC, 0x45, 0x00);
        cmds.push(GS, 0x21, 0x00);
      } else if (directive.startsWith("SUBHEADER:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x01);
        cmds.push(ESC, 0x45, 0x01);
        pushLine(cmds, directive.slice(10));
        cmds.push(ESC, 0x45, 0x00);
      } else if (directive.startsWith("CENTER:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x01);
        pushLine(cmds, directive.slice(7));
      } else if (directive.startsWith("LEFT:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        pushLine(cmds, directive.slice(5));
      } else if (directive.startsWith("LEFTDHVOID:")) {
        pushVoidItemLine(cmds, directive.slice(11));
      } else if (directive.startsWith("LEFTDH:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        cmds.push(GS, 0x21, 0x01);
        cmds.push(ESC, 0x45, 0x01);
        pushLine(cmds, directive.slice(7));
        cmds.push(ESC, 0x45, 0x00);
        cmds.push(GS, 0x21, 0x00);
      } else if (directive.startsWith("LEFTB:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        pushLine(cmds, directive.slice(6));
      } else if (directive.startsWith("CENTERB:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x01);
        pushLine(cmds, directive.slice(8));
      } else if (directive.startsWith("BOLDLEFT:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        cmds.push(ESC, 0x45, 0x01);
        pushLine(cmds, directive.slice(9));
        cmds.push(ESC, 0x45, 0x00);
      } else if (directive.startsWith("BOLD:")) {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x01);
        cmds.push(ESC, 0x45, 0x01);
        pushLine(cmds, directive.slice(5));
        cmds.push(ESC, 0x45, 0x00);
      } else {
        cmds.push(ESC, 0x4d, 0x00);
        cmds.push(ESC, 0x61, 0x00);
        pushLine(cmds, directive);
      }
    }
  }

  return Buffer.from(cmds);
}
