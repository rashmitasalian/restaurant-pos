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

function pushMonoImage(cmds: number[], directive: string) {
  const [, widthRaw, heightRaw, dataBase64] = directive.split(":");
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !dataBase64) {
    return;
  }
  const widthBytes = Math.ceil(width / 8);
  const MAX_WIDTH = 576;
  const MAX_HEIGHT = 512;
  const MAX_BYTES = 64 * 1024;
  if (width > MAX_WIDTH || height > MAX_HEIGHT || !dataBase64 || dataBase64.length > MAX_BYTES * 2) {
    return;
  }
  const data = Buffer.from(dataBase64, "base64");
  if (data.length < widthBytes * height || data.length > MAX_BYTES) {
    return;
  }

  const ESC = 0x1b;
  const GS = 0x1d;
  cmds.push(ESC, 0x61, 0x01);
  cmds.push(GS, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff);
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
      } else if (directive.startsWith("IMAGE_MONO:")) {
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
      } else if (directive.startsWith("IMAGE_MONO:")) {
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
