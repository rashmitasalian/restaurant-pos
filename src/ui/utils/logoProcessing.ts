export type ReceiptLogoRaster = {
  width: number;
  height: number;
  dataBase64: string;
};

export type ProcessedRestaurantLogo = {
  logoDataUrl: string;
  receiptLogoRaster: ReceiptLogoRaster;
};

export type RgbaBuffer = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

type ContentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const UI_LOGO_MAX_SIZE = 512;
const SOURCE_MAX_EDGE = 1600;
const RECEIPT_MAX_WIDTH = 576;
const RECEIPT_MAX_HEIGHT = 480;
const COVERAGE_INK = 0.32;
const CROP_PADDING = 4;
const PAPER_LUMA = 242;
const INK_LUMA = 210;
const DARK_FIELD_MAX = 96;
const DARK_FIELD_SHARE = 0.45;
const DARK_MARK_GAP = 36;

type LogoField = {
  mode: "light" | "dark";
  luma: number;
};

const sessionCache = new Map<string, ProcessedRestaurantLogo>();
const YIELD_EVERY_ROWS = 32;

class LogoProcessingCancelled extends Error {
  constructor() {
    super("logo-processing-cancelled");
    this.name = "LogoProcessingCancelled";
  }
}

function pauseForInput(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function maybePause(row: number, isCancelled?: () => boolean) {
  if (isCancelled?.()) {
    throw new LogoProcessingCancelled();
  }
  if (row > 0 && row % YIELD_EVERY_ROWS === 0) {
    await pauseForInput();
    if (isCancelled?.()) {
      throw new LogoProcessingCancelled();
    }
  }
}

function luminance(red: number, green: number, blue: number) {
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function fittedSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
  allowUpscale: boolean,
) {
  const scale = Math.min(
    maxWidth / width,
    maxHeight / height,
    allowUpscale ? Number.POSITIVE_INFINITY : 1,
  );
  return {
    width: Math.max(1, Math.min(maxWidth, Math.round(width * scale))),
    height: Math.max(1, Math.min(maxHeight, Math.round(height * scale))),
  };
}

function compositeRow(
  sourceData: Uint8ClampedArray,
  dest: Uint8ClampedArray,
  y: number,
  width: number,
) {
  const start = y * width * 4;
  const end = start + width * 4;
  for (let i = start; i < end; i += 4) {
    const alpha = sourceData[i + 3] / 255;
    dest[i] = Math.round(sourceData[i] * alpha + 255 * (1 - alpha));
    dest[i + 1] = Math.round(sourceData[i + 1] * alpha + 255 * (1 - alpha));
    dest[i + 2] = Math.round(sourceData[i + 2] * alpha + 255 * (1 - alpha));
    dest[i + 3] = 255;
  }
}

export function compositeOnWhite(source: RgbaBuffer): RgbaBuffer {
  const data = new Uint8ClampedArray(source.data.length);
  for (let y = 0; y < source.height; y += 1) {
    compositeRow(source.data, data, y, source.width);
  }
  return { width: source.width, height: source.height, data };
}

async function compositeOnWhiteCooperative(
  source: RgbaBuffer,
  isCancelled?: () => boolean,
): Promise<RgbaBuffer> {
  const data = new Uint8ClampedArray(source.data.length);
  for (let y = 0; y < source.height; y += 1) {
    compositeRow(source.data, data, y, source.width);
    await maybePause(y, isCancelled);
  }
  return { width: source.width, height: source.height, data };
}

function accumulateFieldRow(
  data: Uint8ClampedArray,
  y: number,
  width: number,
  buckets: Uint32Array,
) {
  let count = 0;
  const start = y * width * 4;
  const end = start + width * 4;
  for (let i = start; i < end; i += 4) {
    if (data[i + 3] < 24) {
      continue;
    }
    const luma = luminance(data[i], data[i + 1], data[i + 2]);
    buckets[Math.min(31, luma >> 3)] += 1;
    count += 1;
  }
  return count;
}

function fieldFromBuckets(buckets: Uint32Array, count: number): LogoField {
  if (!count) {
    return { mode: "light", luma: 255 };
  }
  let peak = 0;
  for (let i = 1; i < buckets.length; i += 1) {
    if (buckets[i] > buckets[peak]) {
      peak = i;
    }
  }
  const band =
    buckets[peak] + (peak > 0 ? buckets[peak - 1] : 0) + (peak < 31 ? buckets[peak + 1] : 0);
  const peakLuma = peak * 8 + 4;
  if (band / count >= DARK_FIELD_SHARE && peakLuma <= DARK_FIELD_MAX) {
    return { mode: "dark", luma: peakLuma };
  }
  return { mode: "light", luma: peakLuma };
}

function analyzeField(image: RgbaBuffer): LogoField {
  const buckets = new Uint32Array(32);
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    count += accumulateFieldRow(image.data, y, image.width, buckets);
  }
  return fieldFromBuckets(buckets, count);
}

async function analyzeFieldCooperative(
  image: RgbaBuffer,
  isCancelled?: () => boolean,
): Promise<LogoField> {
  const buckets = new Uint32Array(32);
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    count += accumulateFieldRow(image.data, y, image.width, buckets);
    await maybePause(y, isCancelled);
  }
  return fieldFromBuckets(buckets, count);
}

function isArtworkPixel(luma: number, field: LogoField) {
  if (field.mode === "dark") {
    return luma >= field.luma + DARK_MARK_GAP;
  }
  return luma < PAPER_LUMA;
}

type BoundsScan = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function noteArtworkRow(
  image: RgbaBuffer,
  y: number,
  field: LogoField,
  state: BoundsScan,
) {
  const { data, width } = image;
  for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 24) {
      continue;
    }
    if (!isArtworkPixel(luminance(data[index], data[index + 1], data[index + 2]), field)) {
      continue;
    }
    if (x < state.minX) {
state.minX = x;
}
    if (y < state.minY) {
state.minY = y;
}
    if (x > state.maxX) {
state.maxX = x;
}
    if (y > state.maxY) {
state.maxY = y;
}
  }
}

function boundsFromScan(image: RgbaBuffer, state: BoundsScan, padding: number): ContentBounds | null {
  if (state.maxX < 0) {
    return null;
  }
  const x = Math.max(0, state.minX - padding);
  const y = Math.max(0, state.minY - padding);
  const right = Math.min(image.width - 1, state.maxX + padding);
  const bottom = Math.min(image.height - 1, state.maxY + padding);
  return { x, y, width: right - x + 1, height: bottom - y + 1 };
}

export function findContentBounds(
  image: RgbaBuffer,
  padding = CROP_PADDING,
  field = analyzeField(image),
): ContentBounds | null {
  const state: BoundsScan = { minX: image.width, minY: image.height, maxX: -1, maxY: -1 };
  for (let y = 0; y < image.height; y += 1) {
    noteArtworkRow(image, y, field, state);
  }
  return boundsFromScan(image, state, padding);
}

async function findContentBoundsCooperative(
  image: RgbaBuffer,
  padding: number,
  field: LogoField,
  isCancelled?: () => boolean,
): Promise<ContentBounds | null> {
  const state: BoundsScan = { minX: image.width, minY: image.height, maxX: -1, maxY: -1 };
  for (let y = 0; y < image.height; y += 1) {
    noteArtworkRow(image, y, field, state);
    await maybePause(y, isCancelled);
  }
  return boundsFromScan(image, state, padding);
}

function cropRgba(image: RgbaBuffer, bounds: ContentBounds): RgbaBuffer {
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    const srcStart = ((bounds.y + y) * image.width + bounds.x) * 4;
    data.set(image.data.subarray(srcStart, srcStart + bounds.width * 4), y * bounds.width * 4);
  }
  return { width: bounds.width, height: bounds.height, data };
}

function scaleDestinationRow(image: RgbaBuffer, dest: Uint8ClampedArray, y: number, width: number, height: number) {
  const { data, width: sourceWidth, height: sourceHeight } = image;
  const sy = ((y + 0.5) * sourceHeight) / height - 0.5;
  const y0 = Math.max(0, Math.floor(sy));
  const y1 = Math.min(sourceHeight - 1, y0 + 1);
  const fy = sy <= y0 ? 0 : sy - y0;
  for (let x = 0; x < width; x += 1) {
    const sx = ((x + 0.5) * sourceWidth) / width - 0.5;
    const x0 = Math.max(0, Math.floor(sx));
    const x1 = Math.min(sourceWidth - 1, x0 + 1);
    const fx = sx <= x0 ? 0 : sx - x0;
    const i00 = (y0 * sourceWidth + x0) * 4;
    const i10 = (y0 * sourceWidth + x1) * 4;
    const i01 = (y1 * sourceWidth + x0) * 4;
    const i11 = (y1 * sourceWidth + x1) * 4;
    const out = (y * width + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      const top = data[i00 + channel] * (1 - fx) + data[i10 + channel] * fx;
      const bottom = data[i01 + channel] * (1 - fx) + data[i11 + channel] * fx;
      dest[out + channel] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
}

export function scaleRgba(image: RgbaBuffer, width: number, height: number): RgbaBuffer {
  if (width === image.width && height === image.height) {
    return { width, height, data: new Uint8ClampedArray(image.data) };
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    scaleDestinationRow(image, data, y, width, height);
  }
  return { width, height, data };
}

function bilevelInk(gray: Uint8Array, field: LogoField) {
  const ink = new Uint8Array(gray.length);
  if (field.mode === "dark") {
    const cutoff = field.luma + DARK_MARK_GAP;
    for (let i = 0; i < gray.length; i += 1) {
      ink[i] = gray[i] >= cutoff ? 1 : 0;
    }
    return ink;
  }
  for (let i = 0; i < gray.length; i += 1) {
    ink[i] = gray[i] < INK_LUMA ? 1 : 0;
  }
  return ink;
}

function fillInkRow(
  ink: Uint8Array,
  out: Uint8Array,
  y: number,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  upscale: boolean,
) {
  if (upscale) {
    const sy = Math.min(sourceHeight - 1, Math.floor(((y + 0.5) * sourceHeight) / height));
    const row = sy * sourceWidth;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(sourceWidth - 1, Math.floor(((x + 0.5) * sourceWidth) / width));
      out[y * width + x] = ink[row + sx];
    }
    return;
  }
  const y0 = (y * sourceHeight) / height;
  const y1 = ((y + 1) * sourceHeight) / height;
  const yStart = Math.floor(y0);
  const yEnd = Math.min(sourceHeight - 1, Math.ceil(y1) - 1);
  for (let x = 0; x < width; x += 1) {
    const x0 = (x * sourceWidth) / width;
    const x1 = ((x + 1) * sourceWidth) / width;
    const xStart = Math.floor(x0);
    const xEnd = Math.min(sourceWidth - 1, Math.ceil(x1) - 1);
    let covered = 0;
    let area = 0;
    for (let sy = yStart; sy <= yEnd; sy += 1) {
      const rowTop = y0 > sy ? y0 : sy;
      const rowBottom = y1 < sy + 1 ? y1 : sy + 1;
      const rowFrac = rowBottom - rowTop;
      if (rowFrac <= 0) {
        continue;
      }
      const row = sy * sourceWidth;
      for (let sx = xStart; sx <= xEnd; sx += 1) {
        const colLeft = x0 > sx ? x0 : sx;
        const colRight = x1 < sx + 1 ? x1 : sx + 1;
        const colFrac = colRight - colLeft;
        if (colFrac <= 0) {
          continue;
        }
        const weight = rowFrac * colFrac;
        area += weight;
        if (ink[row + sx]) {
          covered += weight;
        }
      }
    }
    out[y * width + x] = area > 0 && covered / area >= COVERAGE_INK ? 1 : 0;
  }
}

function scaleInkMask(
  ink: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
) {
  const out = new Uint8Array(width * height);
  if (width === sourceWidth && height === sourceHeight) {
    out.set(ink);
    return out;
  }
  const upscale = width >= sourceWidth && height >= sourceHeight;
  for (let y = 0; y < height; y += 1) {
    fillInkRow(ink, out, y, sourceWidth, sourceHeight, width, height, upscale);
  }
  return out;
}

async function scaleInkMaskCooperative(
  ink: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  isCancelled?: () => boolean,
) {
  const out = new Uint8Array(width * height);
  if (width === sourceWidth && height === sourceHeight) {
    out.set(ink);
    return out;
  }
  const upscale = width >= sourceWidth && height >= sourceHeight;
  for (let y = 0; y < height; y += 1) {
    fillInkRow(ink, out, y, sourceWidth, sourceHeight, width, height, upscale);
    await maybePause(y, isCancelled);
  }
  return out;
}

function rasterFromArtwork(artwork: RgbaBuffer, field: LogoField) {
  const size = fittedSize(
    artwork.width,
    artwork.height,
    RECEIPT_MAX_WIDTH,
    RECEIPT_MAX_HEIGHT,
    true,
  );
  const gray = grayscale(artwork);
  if (shouldDither(gray)) {
    const scaled = scaleRgba(artwork, size.width, size.height);
    const scaledGray = grayscale(scaled);
    return packMono(
      toInkMask(scaledGray, scaled.width, scaled.height, field),
      scaled.width,
      scaled.height,
    );
  }
  return packMono(
    scaleInkMask(bilevelInk(gray, field), artwork.width, artwork.height, size.width, size.height),
    size.width,
    size.height,
  );
}

async function rasterFromArtworkCooperative(
  artwork: RgbaBuffer,
  field: LogoField,
  isCancelled?: () => boolean,
) {
  const size = fittedSize(
    artwork.width,
    artwork.height,
    RECEIPT_MAX_WIDTH,
    RECEIPT_MAX_HEIGHT,
    true,
  );
  const gray = grayscale(artwork);
  if (shouldDither(gray)) {
    const scaled = await scaleRgbaCooperative(artwork, size.width, size.height, isCancelled);
    const scaledGray = grayscale(scaled);
    return packMono(
      toInkMask(scaledGray, scaled.width, scaled.height, field),
      scaled.width,
      scaled.height,
    );
  }
  return packMono(
    await scaleInkMaskCooperative(
      bilevelInk(gray, field),
      artwork.width,
      artwork.height,
      size.width,
      size.height,
      isCancelled,
    ),
    size.width,
    size.height,
  );
}

async function scaleRgbaCooperative(
  image: RgbaBuffer,
  width: number,
  height: number,
  isCancelled?: () => boolean,
): Promise<RgbaBuffer> {
  if (width === image.width && height === image.height) {
    return { width, height, data: new Uint8ClampedArray(image.data) };
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    scaleDestinationRow(image, data, y, width, height);
    await maybePause(y, isCancelled);
  }
  return { width, height, data };
}

async function cropRgbaCooperative(
  image: RgbaBuffer,
  bounds: ContentBounds,
  isCancelled?: () => boolean,
): Promise<RgbaBuffer> {
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    const srcStart = ((bounds.y + y) * image.width + bounds.x) * 4;
    data.set(image.data.subarray(srcStart, srcStart + bounds.width * 4), y * bounds.width * 4);
    await maybePause(y, isCancelled);
  }
  return { width: bounds.width, height: bounds.height, data };
}

function cropArtwork(source: RgbaBuffer, field?: LogoField): RgbaBuffer {
  const flattened = compositeOnWhite(source);
  const logoField = field ?? analyzeField(flattened);
  const bounds = findContentBounds(flattened, CROP_PADDING, logoField);
  if (!bounds) {
    throw new Error("Logo has no visible artwork");
  }
  return cropRgba(flattened, bounds);
}

function grayscale(image: RgbaBuffer) {
  const gray = new Uint8Array(image.width * image.height);
  const { data } = image;
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    gray[pixel] = Math.round(luminance(data[i], data[i + 1], data[i + 2]));
  }
  return gray;
}

function shouldDither(gray: Uint8Array) {
  const buckets = new Uint32Array(16);
  let ink = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const value = gray[i];
    if (value >= PAPER_LUMA) {
      continue;
    }
    ink += 1;
    buckets[value >> 4] += 1;
  }
  if (ink < 64) {
    return false;
  }
  let occupied = 0;
  let peak = 0;
  for (let i = 0; i < buckets.length; i += 1) {
    if (buckets[i] > peak) {
      peak = buckets[i];
    }
    if (buckets[i] / ink >= 0.05) {
      occupied += 1;
    }
  }
  // A flat brand color is line art. Only smooth photographs are dithered.
  if (peak / ink >= 0.22) {
    return false;
  }
  return occupied >= 6;
}

function toInkMask(gray: Uint8Array, width: number, height: number, field: LogoField) {
  const ink = new Uint8Array(gray.length);
  if (field.mode === "dark") {
    const cutoff = field.luma + DARK_MARK_GAP;
    for (let i = 0; i < gray.length; i += 1) {
      ink[i] = gray[i] >= cutoff ? 1 : 0;
    }
    return ink;
  }
  if (!shouldDither(gray)) {
    for (let i = 0; i < gray.length; i += 1) {
      ink[i] = gray[i] < INK_LUMA ? 1 : 0;
    }
    return ink;
  }

  const work = new Float64Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    work[i] = gray[i];
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (gray[index] >= INK_LUMA) {
        continue;
      }
      const oldValue = work[index];
      const black = oldValue < 128;
      work[index] = black ? 0 : 255;
      ink[index] = black ? 1 : 0;
      const error = oldValue - work[index];
      if (x + 1 < width) {
work[index + 1] += (error * 7) / 16;
}
      if (y + 1 < height && x > 0) {
work[index + width - 1] += (error * 3) / 16;
}
      if (y + 1 < height) {
work[index + width] += (error * 5) / 16;
}
      if (y + 1 < height && x + 1 < width) {
work[index + width + 1] += error / 16;
}
    }
  }
  for (let i = 0; i < gray.length; i += 1) {
    if (gray[i] >= INK_LUMA) {
      ink[i] = 0;
    }
  }
  return ink;
}

function bytesToBase64(bytes: Uint8Array) {
  if (typeof btoa !== "function") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  if (typeof atob !== "function") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function packMono(ink: Uint8Array, width: number, height: number): ReceiptLogoRaster {
  const paddedWidth = Math.ceil(width / 8) * 8;
  const widthBytes = paddedWidth / 8;
  const bytes = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!ink[y * width + x]) {
        continue;
      }
      bytes[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width: paddedWidth, height, dataBase64: bytesToBase64(bytes) };
}

export function renderUiLogo(source: RgbaBuffer): RgbaBuffer {
  const artwork = cropArtwork(source);
  const size = fittedSize(artwork.width, artwork.height, UI_LOGO_MAX_SIZE, UI_LOGO_MAX_SIZE, false);
  return scaleRgba(artwork, size.width, size.height);
}

export function rasterizeRestaurantLogo(source: RgbaBuffer): ReceiptLogoRaster {
  const flattened = compositeOnWhite(source);
  const field = analyzeField(flattened);
  return rasterFromArtwork(cropArtwork(flattened, field), field);
}

async function renderUiLogoCooperative(
  source: RgbaBuffer,
  isCancelled?: () => boolean,
): Promise<RgbaBuffer> {
  const flattened = await compositeOnWhiteCooperative(source, isCancelled);
  const field = await analyzeFieldCooperative(flattened, isCancelled);
  const bounds = await findContentBoundsCooperative(flattened, CROP_PADDING, field, isCancelled);
  if (!bounds) {
    throw new Error("Logo has no visible artwork");
  }
  const artwork = await cropRgbaCooperative(flattened, bounds, isCancelled);
  const size = fittedSize(artwork.width, artwork.height, UI_LOGO_MAX_SIZE, UI_LOGO_MAX_SIZE, false);
  return scaleRgbaCooperative(artwork, size.width, size.height, isCancelled);
}

async function rasterizeRestaurantLogoCooperative(
  source: RgbaBuffer,
  isCancelled?: () => boolean,
): Promise<ReceiptLogoRaster> {
  const flattened = await compositeOnWhiteCooperative(source, isCancelled);
  const field = await analyzeFieldCooperative(flattened, isCancelled);
  const flattenedAgain = await compositeOnWhiteCooperative(flattened, isCancelled);
  const bounds = await findContentBoundsCooperative(
    flattenedAgain,
    CROP_PADDING,
    field,
    isCancelled,
  );
  if (!bounds) {
    throw new Error("Logo has no visible artwork");
  }
  const artwork = await cropRgbaCooperative(flattenedAgain, bounds, isCancelled);
  return rasterFromArtworkCooperative(artwork, field, isCancelled);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read logo file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load logo image"));
    image.src = src;
  });
}

function readImageOnWhite(image: HTMLImageElement): RgbaBuffer {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("Could not load logo image");
  }
  const size = fittedSize(sourceWidth, sourceHeight, SOURCE_MAX_EDGE, SOURCE_MAX_EDGE, false);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas is not available");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, size.width, size.height);
  const imageData = ctx.getImageData(0, 0, size.width, size.height);
  return { width: size.width, height: size.height, data: imageData.data };
}

function rgbaToPngDataUrl(image: RgbaBuffer) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not available");
  }
  const imageData = ctx.createImageData(image.width, image.height);
  imageData.data.set(image.data);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

async function processImageElement(image: HTMLImageElement): Promise<ProcessedRestaurantLogo> {
  const source = readImageOnWhite(image);
  const processed = {
    logoDataUrl: rgbaToPngDataUrl(renderUiLogo(source)),
    receiptLogoRaster: rasterizeRestaurantLogo(source),
  };
  sessionCache.set(processed.logoDataUrl, processed);
  return processed;
}

export async function processRestaurantLogoFile(file: File): Promise<ProcessedRestaurantLogo> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Use a PNG, JPG, or WebP logo");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Logo must be 3 MB or smaller");
  }
  const originalDataUrl = await readFileAsDataUrl(file);
  return processImageElement(await loadImage(originalDataUrl));
}

export async function processRestaurantLogoFromDataUrl(
  dataUrl: string,
): Promise<ProcessedRestaurantLogo> {
  const source = String(dataUrl || "").trim();
  if (!source) {
    throw new Error("Could not load logo image");
  }
  return processImageElement(await loadImage(source));
}

export async function prepareRestaurantLogo(dataUrl: string): Promise<ProcessedRestaurantLogo> {
  const cached = sessionCache.get(dataUrl);
  if (cached) {
    return cached;
  }
  const processed = await processRestaurantLogoFromDataUrl(dataUrl);
  sessionCache.set(dataUrl, processed);
  return processed;
}

export async function prepareRestaurantLogoCooperative(
  dataUrl: string,
  isCancelled?: () => boolean,
): Promise<ProcessedRestaurantLogo | null> {
  const source = String(dataUrl || "").trim();
  if (!source) {
    throw new Error("Could not load logo image");
  }
  const cached = sessionCache.get(source);
  if (cached) {
    return cached;
  }
  try {
    const image = await loadImage(source);
    if (isCancelled?.()) {
      return null;
    }
    const pixels = readImageOnWhite(image);
    if (isCancelled?.()) {
      return null;
    }
    const processed = {
      logoDataUrl: rgbaToPngDataUrl(await renderUiLogoCooperative(pixels, isCancelled)),
      receiptLogoRaster: await rasterizeRestaurantLogoCooperative(pixels, isCancelled),
    };
    if (isCancelled?.()) {
      return null;
    }
    sessionCache.set(source, processed);
    sessionCache.set(processed.logoDataUrl, processed);
    return processed;
  } catch (error) {
    if (error instanceof LogoProcessingCancelled) {
      return null;
    }
    throw error;
  }
}

export async function receiptRasterForBranding(branding?: {
  logoDataUrl?: string | null;
  receiptLogoRaster?: ReceiptLogoRaster | null;
} | null): Promise<ReceiptLogoRaster | null> {
  const dataUrl = typeof branding?.logoDataUrl === "string" ? branding.logoDataUrl.trim() : "";
  if (dataUrl) {
    try {
      const prepared = await prepareRestaurantLogo(dataUrl);
      return prepared.receiptLogoRaster;
    } catch {
      // Keep the stored raster when the color file cannot be decoded.
    }
  }
  const stored = branding?.receiptLogoRaster;
  if (stored && stored.width > 0 && stored.height > 0 && stored.dataBase64) {
    return stored;
  }
  return null;
}

export async function brandingWithPrintLogo<
  T extends {
    logoDataUrl?: string | null;
    receiptLogoRaster?: ReceiptLogoRaster | null;
  },
>(branding: T | null | undefined): Promise<T | null | undefined> {
  if (!branding) {
    return branding;
  }
  const receiptLogoRaster = await receiptRasterForBranding(branding);
  if (!receiptLogoRaster) {
    return branding;
  }
  return { ...branding, receiptLogoRaster };
}

export function receiptRasterPreviewDataUrl(raster: ReceiptLogoRaster) {
  if (typeof document === "undefined") {
    throw new Error("Canvas is not available");
  }
  const widthBytes = Math.ceil(raster.width / 8);
  const bytes = base64ToBytes(raster.dataBase64);
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not available");
  }
  const image = ctx.createImageData(raster.width, raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const ink = (bytes[y * widthBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
      const value = ink ? 0 : 255;
      const index = (y * raster.width + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}
