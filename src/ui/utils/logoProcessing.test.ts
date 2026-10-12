import {
  findContentBounds,
  rasterizeRestaurantLogo,
  scaleRgba,
  type RgbaBuffer,
} from "./logoProcessing";

const GREEN = [142, 198, 65] as const;

function blank(width: number, height: number, red = 255, green = 255, blue = 255): RgbaBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = red;
    data[i + 1] = green;
    data[i + 2] = blue;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function setPixel(image: RgbaBuffer, x: number, y: number, red: number, green: number, blue: number) {
  const index = (y * image.width + x) * 4;
  image.data[index] = red;
  image.data[index + 1] = green;
  image.data[index + 2] = blue;
  image.data[index + 3] = 255;
}

function decodeInk(raster: { width: number; height: number; dataBase64: string }) {
  const bytes = Buffer.from(raster.dataBase64, "base64");
  const widthBytes = Math.ceil(raster.width / 8);
  const rows: boolean[][] = [];
  let ink = 0;
  for (let y = 0; y < raster.height; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < raster.width; x += 1) {
      const on = (bytes[y * widthBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
      row.push(on);
      if (on) {
ink += 1;
}
    }
    rows.push(row);
  }
  return { rows, ink };
}

function hasOpenSlit(rows: boolean[][]) {
  return rows.some((row) => {
    let seenInk = false;
    let seenGap = false;
    for (const on of row) {
      if (on) {
        if (seenGap) {
return true;
}
        seenInk = true;
      } else if (seenInk) {
        seenGap = true;
      }
    }
    return false;
  });
}

function hasSolidInkRun(row: boolean[]) {
  const first = row.indexOf(true);
  const last = row.lastIndexOf(true);
  if (first < 0 || last - first < 16) {
return false;
}
  for (let x = first; x <= last; x += 1) {
    if (!row[x]) {
return false;
}
  }
  return true;
}

function greenDiscWithSlit(): RgbaBuffer {
  const size = 800;
  const image = blank(size, size);
  const center = size / 2;
  const radius = 40;
  for (let y = center - radius; y <= center + radius; y += 1) {
    for (let x = center - radius; x <= center + radius; x += 1) {
      const dx = x - center;
      const dy = y - center;
      if (dx * dx + dy * dy > radius * radius) {
continue;
}
      if (Math.abs(dx) <= 1) {
continue;
}
      setPixel(image, x, y, GREEN[0], GREEN[1], GREEN[2]);
    }
  }
  return image;
}

function legacyTinyMask(image: RgbaBuffer) {
  const scale = Math.min(240 / image.width, 120 / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const scaled = scaleRgba(image, width, height);
  const rows: boolean[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const luma =
        0.299 * scaled.data[index] +
        0.587 * scaled.data[index + 1] +
        0.114 * scaled.data[index + 2];
      row.push(luma < 190);
    }
    rows.push(row);
  }
  return rows;
}

describe("restaurant logo raster", () => {
  it("crops empty margin and keeps a white slit that the old 120px threshold filled in", () => {
    const image = greenDiscWithSlit();
    const bounds = findContentBounds(image);
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThan(image.width / 2);
    expect(bounds!.height).toBeLessThan(image.height / 2);

    expect(hasOpenSlit(legacyTinyMask(image))).toBe(false);

    const raster = rasterizeRestaurantLogo(image);
    expect(raster.width % 8).toBe(0);
    expect(raster.width).toBeGreaterThan(120);
    expect(raster.width).toBeLessThanOrEqual(576);
    expect(raster.height).toBeLessThanOrEqual(480);
    const decoded = decodeInk(raster);
    expect(hasOpenSlit(decoded.rows)).toBe(true);
    expect(decoded.ink / (raster.width * raster.height)).toBeGreaterThan(0.45);
  });

  it("prints a black wordmark as a solid run", () => {
    const image = blank(800, 800);
    for (let y = 360; y < 420; y += 1) {
      for (let x = 280; x < 520; x += 1) {
        setPixel(image, x, y, 0, 0, 0);
      }
    }
    const decoded = decodeInk(rasterizeRestaurantLogo(image));
    const middle = decoded.rows[Math.floor(decoded.rows.length / 2)];
    expect(hasSolidInkRun(middle)).toBe(true);
  });

  it("prints a light mark on a dark field instead of a black block", () => {
    const image = blank(400, 400, 54, 54, 54);
    for (let y = 140; y < 220; y += 1) {
      for (let x = 150; x < 250; x += 1) {
        setPixel(image, x, y, 164, 186, 119);
      }
    }
    for (let y = 250; y < 270; y += 1) {
      for (let x = 140; x < 260; x += 1) {
        setPixel(image, x, y, 249, 249, 249);
      }
    }

    const bounds = findContentBounds(image);
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThan(image.width / 2);
    expect(bounds!.height).toBeLessThan(image.height / 2);

    const decoded = decodeInk(rasterizeRestaurantLogo(image));
    const pixelCount = decoded.rows.length * decoded.rows[0].length;
    expect(decoded.rows[0][0]).toBe(false);
    expect(decoded.ink / pixelCount).toBeLessThan(0.75);
    expect(decoded.rows.some((row) => hasSolidInkRun(row))).toBe(true);
  });

  it("dithers a photograph instead of turning it into one black block", () => {
    const width = 160;
    const height = 80;
    const image = blank(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const luma = Math.round(40 + (x / (width - 1)) * 180);
        setPixel(image, x, y, luma, luma, luma);
      }
    }
    const decoded = decodeInk(rasterizeRestaurantLogo(image));
    const midStart = Math.floor(decoded.rows[0].length * 0.4);
    const midEnd = Math.floor(decoded.rows[0].length * 0.6);
    let ink = 0;
    let paper = 0;
    for (const row of decoded.rows) {
      for (let x = midStart; x < midEnd; x += 1) {
        if (row[x]) {
ink += 1;
} else {
paper += 1;
}
      }
    }
    expect(ink).toBeGreaterThan(0);
    expect(paper).toBeGreaterThan(0);
  });
});
