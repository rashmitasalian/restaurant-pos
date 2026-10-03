import { safeStorage } from "electron";
import type { KeyProtector } from "./licenseTypes";

export function electronKeyProtector(): KeyProtector {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain: string) => safeStorage.encryptString(plain),
    decryptString: (encrypted: Buffer) => safeStorage.decryptString(encrypted),
  };
}
