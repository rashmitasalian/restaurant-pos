/** Raw Ed25519 vendor public key (standard base64). The private key is not in this repository. */
export const VENDOR_PUBLIC_KEY_BASE64 = "dGearSA6SgrUkwowPNMyW4HaRe/IyjM7T8VEB/mGP7s=";

/**
 * Raw Ed25519 update-manifest public key. This is not the license key.
 * The private key is not in this repository.
 */
export const UPDATE_PUBLIC_KEY_BASE64 = "DNk8PfiKrJt7kiKZZfcAdAn4lhEiCGhxmHGB16Oc0f0=";

export function vendorPublicKeyRaw(): Buffer {
  const raw = Buffer.from(VENDOR_PUBLIC_KEY_BASE64, "base64");
  if (raw.length !== 32) {
    throw new Error("vendor-public-key-invalid");
  }
  return raw;
}

export function updatePublicKeyRaw(): Buffer {
  const raw = Buffer.from(UPDATE_PUBLIC_KEY_BASE64, "base64");
  if (raw.length !== 32) {
    throw new Error("update-public-key-invalid");
  }
  if (raw.equals(vendorPublicKeyRaw())) {
    throw new Error("update-public-key-invalid");
  }
  return raw;
}
