/** Raw Ed25519 vendor public key (standard base64). The private key is not in this repository. */
export const VENDOR_PUBLIC_KEY_BASE64 = "dGearSA6SgrUkwowPNMyW4HaRe/IyjM7T8VEB/mGP7s=";

export function vendorPublicKeyRaw(): Buffer {
  const raw = Buffer.from(VENDOR_PUBLIC_KEY_BASE64, "base64");
  if (raw.length !== 32) {
    throw new Error("vendor-public-key-invalid");
  }
  return raw;
}
