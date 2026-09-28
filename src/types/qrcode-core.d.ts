declare module "qrcode/lib/core/qrcode" {
  export function create(
    data: string,
    options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" },
  ): {
    modules: {
      size: number;
      get: (row: number, col: number) => number | boolean;
    };
  };
}
