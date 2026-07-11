export type ReceiptLogoRaster = {
  width: number;
  height: number;
  dataBase64: string;
};

export type ProcessedRestaurantLogo = {
  logoDataUrl: string;
  receiptLogoRaster: ReceiptLogoRaster;
};

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const UI_LOGO_MAX_SIZE = 512;
const RECEIPT_LOGO_MAX_WIDTH = 240;
const RECEIPT_LOGO_MAX_HEIGHT = 120;

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

function fitSize(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function drawContained(image: HTMLImageElement, width: number, height: number, background?: string) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not available");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, ctx };
}

function toReceiptRaster(image: HTMLImageElement): ReceiptLogoRaster {
  const size = fitSize(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    RECEIPT_LOGO_MAX_WIDTH,
    RECEIPT_LOGO_MAX_HEIGHT,
  );
  const { ctx } = drawContained(image, size.width, size.height, "#ffffff");
  const imageData = ctx.getImageData(0, 0, size.width, size.height);
  const widthBytes = Math.ceil(size.width / 8);
  const bytes = new Uint8Array(widthBytes * size.height);

  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const idx = (y * size.width + x) * 4;
      const alpha = imageData.data[idx + 3];
      if (alpha < 24) {
        continue;
      }
      const red = imageData.data[idx];
      const green = imageData.data[idx + 1];
      const blue = imageData.data[idx + 2];
      const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
      if (luminance < 190) {
        bytes[y * widthBytes + Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
    }
  }

  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return {
    width: size.width,
    height: size.height,
    dataBase64: btoa(binary),
  };
}

export async function processRestaurantLogoFile(file: File): Promise<ProcessedRestaurantLogo> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Use a PNG, JPG, or WebP logo");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Logo must be 3 MB or smaller");
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const uiSize = fitSize(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    UI_LOGO_MAX_SIZE,
    UI_LOGO_MAX_SIZE,
  );
  const { canvas } = drawContained(image, uiSize.width, uiSize.height);

  return {
    logoDataUrl: canvas.toDataURL("image/png"),
    receiptLogoRaster: toReceiptRaster(image),
  };
}
