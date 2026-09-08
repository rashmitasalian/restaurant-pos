import { app } from "electron";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { backupKeyProvider } from "./keyProvider";
import { getBackupManager } from "./backupManager";
import { CLOUD_SETTINGS_KEY, defaultCloudIdentitySettings, CloudIdentitySettings } from "./types";

export type ActivateResponse = {
  restaurantId: string;
  installationId: string;
  deviceId: string;
  restaurantCode: string;
  installationToken: string;
};

export type RecoverResponse = {
  restaurantId: string;
  installationId: string;
  deviceId: string;
  restaurantCode: string;
  installationToken: string;
  wrappedBackupKey: string;
  keyVersion: number;
};

export type UploadIntentResponse = {
  backupId: string;
  uploadUrl: string;
  objectKey: string;
  headers?: Record<string, string>;
};

export type CloudBackupListItem = {
  id: string;
  createdAt: string;
  sizeBytes: number;
  checksum: string;
  status: string;
  installationId: string;
};

function cloudApiBaseUrl() {
  const raw = String(process.env.POS_CLOUD_API_URL || "").trim().replace(/\/$/, "");
  return raw;
}

function cloudBackupFeatureEnabled() {
  const flag = String(process.env.POS_CLOUD_BACKUP_ENABLED || "1").trim();
  return flag !== "0" && flag.toLowerCase() !== "false";
}

function resolveApiUrl(routeOrUrl: string) {
  const base = cloudApiBaseUrl();
  if (!base) {
    throw new Error("cloud-api-url-missing");
  }
  if (/^https?:\/\//i.test(routeOrUrl)) {
    return routeOrUrl;
  }
  return `${base}${routeOrUrl.startsWith("/") ? "" : "/"}${routeOrUrl}`;
}

async function requestJson<T>(
  method: string,
  route: string,
  body?: unknown,
  token?: string | null,
): Promise<T> {
  const base = cloudApiBaseUrl();
  if (!base) {
    throw new Error("cloud-api-url-missing");
  }
  if (!/^https:\/\//i.test(base) && process.env.NODE_ENV === "production") {
    throw new Error("cloud-api-url-must-be-https");
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": `RestoNitiPOS/${(() => {
      try {
        return app.getVersion();
      } catch {
        return "0.0.0";
      }
    })()}`,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(resolveApiUrl(route), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    const code = parsed?.error || parsed?.title || `http-${response.status}`;
    throw new Error(String(code));
  }
  return parsed as T;
}

export class CloudBackupClient {
  isConfigured() {
    return Boolean(cloudApiBaseUrl()) && cloudBackupFeatureEnabled();
  }

  async activate(input: {
    recoveryKeyVerifierAlgo: string;
    recoveryKeyVerifierSalt: string;
    recoveryKeyVerifierHash: string;
    wrappedBackupKey: string;
    keyVersion: number;
    appVersion: string;
    deviceLabel?: string;
  }) {
    return requestJson<ActivateResponse>("POST", "/api/v1/cloud/activate", input);
  }

  async recover(input: {
    restaurantCode: string;
    recoveryKey: string;
    appVersion: string;
    deviceLabel?: string;
  }) {
    return requestJson<RecoverResponse>("POST", "/api/v1/cloud/recover", input);
  }

  async createUploadIntent(
    token: string,
    input: {
      checksum: string;
      originalSize: number;
      compressedSize: number;
      encryptedSize: number;
      backupFormatVersion: number;
      databaseSchemaVersion: number;
      appVersion: string;
      keyVersion: number;
    },
  ) {
    return requestJson<UploadIntentResponse>("POST", "/api/v1/backups/upload-intent", input, token);
  }

  async uploadToPresignedUrl(
    uploadUrl: string,
    filePath: string,
    headers?: Record<string, string>,
    token?: string | null,
  ) {
    const body = fs.readFileSync(filePath);
    const resolved = resolveApiUrl(uploadUrl);
    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      ...(headers || {}),
    };
    if (token && /\/api\/v1\/backups\/[^/]+\/content/.test(resolved)) {
      requestHeaders.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(resolved, {
      method: "PUT",
      headers: requestHeaders,
      body,
    });
    if (!response.ok) {
      throw new Error(`cloud-upload-failed-${response.status}`);
    }
  }

  async verify(token: string, backupId: string, checksum: string) {
    return requestJson<{ ok: boolean; status: string }>(
      "POST",
      `/api/v1/backups/${encodeURIComponent(backupId)}/verify`,
      { checksum },
      token,
    );
  }

  async list(token: string) {
    return requestJson<{ items: CloudBackupListItem[] }>("GET", "/api/v1/backups", undefined, token);
  }

  async getDownloadUrl(token: string, backupId: string) {
    return requestJson<{ downloadUrl: string; checksum: string; sizeBytes: number }>(
      "GET",
      `/api/v1/backups/${encodeURIComponent(backupId)}/download`,
      undefined,
      token,
    );
  }

  async downloadToFile(downloadUrl: string, targetPath: string, token?: string | null) {
    const resolved = resolveApiUrl(downloadUrl);
    const headers: Record<string, string> = {};
    if (token && /\/api\/v1\/backups\/[^/]+\/content/.test(resolved)) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(resolved, { headers });
    if (!response.ok) {
      throw new Error(`cloud-download-failed-${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, buffer);
    return buffer.length;
  }
}

export const cloudBackupClient = new CloudBackupClient();

export class CloudBackupStore {
  constructor(private client = cloudBackupClient) {}

  async activateCloud(actor?: string | null) {
    if (!this.client.isConfigured()) {
      throw new Error("cloud-api-not-configured");
    }
    const manager = getBackupManager();
    const { recovery } = backupKeyProvider.createActivationMaterial(1);
    const activated = await this.client.activate({
      recoveryKeyVerifierAlgo: recovery.verifierAlgo,
      recoveryKeyVerifierSalt: recovery.verifierSalt,
      recoveryKeyVerifierHash: recovery.verifierHash,
      wrappedBackupKey: recovery.wrappedBackupKey,
      keyVersion: recovery.keyVersion,
      appVersion: app.getVersion(),
      deviceLabel: process.env.COMPUTERNAME || undefined,
    });
    backupKeyProvider.storeInstallationToken(activated.installationToken);
    manager.saveIdentity(
      {
        restaurantId: activated.restaurantId,
        installationId: activated.installationId,
        deviceId: activated.deviceId,
        restaurantCode: activated.restaurantCode,
        cloudEnabled: true,
        automaticBackup: true,
        keyVersion: recovery.keyVersion,
        lastCloudError: null,
      },
      actor,
    );
    return {
      ...activated,
      recoveryKey: recovery.recoveryKey,
    };
  }

  async recoverCloud(restaurantCode: string, recoveryKey: string, actor?: string | null) {
    if (!this.client.isConfigured()) {
      throw new Error("cloud-api-not-configured");
    }
    const recovered = await this.client.recover({
      restaurantCode: String(restaurantCode || "").trim().toUpperCase(),
      recoveryKey,
      appVersion: app.getVersion(),
      deviceLabel: process.env.COMPUTERNAME || undefined,
    });
    backupKeyProvider.restoreFromRecovery(recovered.wrappedBackupKey, recoveryKey);
    backupKeyProvider.storeInstallationToken(recovered.installationToken);
    getBackupManager().saveIdentity(
      {
        restaurantId: recovered.restaurantId,
        installationId: recovered.installationId,
        deviceId: recovered.deviceId,
        restaurantCode: recovered.restaurantCode,
        cloudEnabled: true,
        keyVersion: recovered.keyVersion,
        lastCloudError: null,
        pendingUploadPath: null,
        pendingUploadBackupId: null,
      },
      actor,
    );
    return recovered;
  }

  async uploadPendingIfAny(logger?: (level: string, message: string, context?: any) => void) {
    const manager = getBackupManager();
    const identity = manager.getIdentity();
    if (!identity.cloudEnabled || !identity.pendingUploadPath) {
      return { ok: true, skipped: true };
    }
    if (!this.client.isConfigured()) {
      return { ok: false, skipped: true, reason: "cloud-api-not-configured" };
    }
    const token = backupKeyProvider.getInstallationToken();
    if (!token) {
      return { ok: false, reason: "installation-token-missing" };
    }
    const filePath = identity.pendingUploadPath;
    if (!fs.existsSync(filePath)) {
      manager.saveIdentity({ pendingUploadPath: null, pendingUploadBackupId: null, lastCloudError: "local-file-missing" });
      return { ok: false, reason: "local-file-missing" };
    }

    try {
      logger?.("info", "cloud upload started");
      const { readRnBakFile } = await import("./format");
      const { header } = readRnBakFile(filePath);
      const intent = await this.client.createUploadIntent(token, {
        checksum: header.checksum,
        originalSize: header.originalSize,
        compressedSize: header.compressedSize,
        encryptedSize: header.encryptedSize,
        backupFormatVersion: header.backupFormatVersion,
        databaseSchemaVersion: header.databaseSchemaVersion,
        appVersion: header.appVersion,
        keyVersion: header.keyVersion,
      });
      await this.client.uploadToPresignedUrl(intent.uploadUrl, filePath, intent.headers, token);
      await this.client.verify(token, intent.backupId, header.checksum);
      const pendingId = identity.pendingUploadBackupId;
      manager.markLocalUploadCompleted(pendingId, intent.backupId);
      manager.saveIdentity({
        lastCloudBackupAt: Date.now(),
        pendingUploadPath: null,
        pendingUploadBackupId: null,
        lastCloudError: null,
      });
      logger?.("info", "cloud upload completed", { backupId: intent.backupId });
      return { ok: true, backupId: intent.backupId };
    } catch (error: any) {
      const message = String(error?.message || error);
      const transient = /network|fetch|timeout|503|502|429|ECONN|ENOTFOUND|cloud-upload-failed/i.test(message);
      manager.saveIdentity({
        lastCloudError: transient ? "pending" : message.slice(0, 200),
      });
      logger?.("error", "cloud upload failed", { error: message });
      return { ok: false, reason: message, retryable: transient };
    }
  }

  async listCloudBackups() {
    const token = backupKeyProvider.getInstallationToken();
    if (!token) {
      throw new Error("installation-token-missing");
    }
    return this.client.list(token);
  }

  async downloadCloudBackup(backupId: string, targetPath: string) {
    const token = backupKeyProvider.getInstallationToken();
    if (!token) {
      throw new Error("installation-token-missing");
    }
    const meta = await this.client.getDownloadUrl(token, backupId);
    await this.client.downloadToFile(meta.downloadUrl, targetPath, token);
    return meta;
  }
}

export const cloudBackupStore = new CloudBackupStore();

export function mergeIdentityDefaults(partial?: Partial<CloudIdentitySettings>): CloudIdentitySettings {
  return { ...defaultCloudIdentitySettings(), ...(partial || {}) };
}

export { CLOUD_SETTINGS_KEY, randomUUID };
