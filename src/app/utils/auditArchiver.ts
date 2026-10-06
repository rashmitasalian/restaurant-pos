/**
 * Audit Log Archival System
 * Archive and manage long-term audit history through the main-process SQLite service.
 */

import { csvCell } from "../../shared/csv";
import { logger } from "../utils/logger";

export interface AuditArchive {
  _id: string;
  type: "audit-archive";
  startDate: number;
  endDate: number;
  count: number;
  archivedAt: number;
  compressed: boolean;
  fileSize: number;
}

const RETENTION_DAYS = 90;

function archiveApi() {
  const api = window.pos?.auditArchives;
  if (!api) {
    throw new Error("audit-archive-api-unavailable");
  }
  return api;
}

export class AuditArchiver {
  static async archiveOldLogs(retentionDays: number = RETENTION_DAYS) {
    try {
      logger.info("Starting audit log archival", { retentionDays });
      const archive = await archiveApi().create(retentionDays);

      if (!archive) {
        logger.info("No old audit logs to archive");
        return null;
      }

      logger.info("Audit log archival completed", {
        archivedCount: archive.count,
        archiveId: archive._id,
      });

      return archive as AuditArchive;
    } catch (e) {
      logger.error("Audit log archival failed", e as Error);
      throw e;
    }
  }

  static async exportArchive(archiveId: string): Promise<{ data: any[]; metadata: AuditArchive }> {
    try {
      const exported = await archiveApi().export(archiveId);

      logger.info("Exported archive", {
        archiveId,
        count: exported.data.length,
      });

      return exported as { data: any[]; metadata: AuditArchive };
    } catch (e) {
      logger.error("Archive export failed", e as Error);
      throw e;
    }
  }

  static async exportArchiveAsCSV(archiveId: string): Promise<string> {
    try {
      const { data } = await this.exportArchive(archiveId);

      if (data.length === 0) {
        return "timestamp,action,userId,orderId,details\n";
      }

      const headers = ["timestamp", "action", "userId", "orderId", "details"];
      const rows = data.map((log: any) => [
        csvCell(new Date(log.timestamp).toISOString()),
        csvCell(log.action),
        csvCell(log.user || log.userId || ""),
        csvCell(log.orderId || log.entityId || ""),
        csvCell(JSON.stringify(log.detail || log.details || {})),
      ]);

      return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    } catch (e) {
      logger.error("CSV export failed", e as Error);
      throw e;
    }
  }

  static async getArchives(): Promise<AuditArchive[]> {
    try {
      return (await archiveApi().list()) as AuditArchive[];
    } catch (e) {
      logger.error("Failed to get archives", e as Error);
      return [];
    }
  }

  static async getArchiveStats(): Promise<{
    totalArchives: number;
    totalArchivedLogs: number;
    oldestArchive: number | null;
    newestArchive: number | null;
    totalSize: number;
  }> {
    try {
      const archives = await this.getArchives();

      return {
        totalArchives: archives.length,
        totalArchivedLogs: archives.reduce((sum, a) => sum + a.count, 0),
        oldestArchive: archives.length > 0 ? Math.min(...archives.map((a) => a.startDate)) : null,
        newestArchive: archives.length > 0 ? Math.max(...archives.map((a) => a.endDate)) : null,
        totalSize: archives.reduce((sum, a) => sum + a.fileSize, 0),
      };
    } catch (e) {
      logger.error("Failed to get archive stats", e as Error);
      return {
        totalArchives: 0,
        totalArchivedLogs: 0,
        oldestArchive: null,
        newestArchive: null,
        totalSize: 0,
      };
    }
  }

  static async deleteArchive(archiveId: string) {
    try {
      await archiveApi().delete(archiveId);
    } catch (e) {
      logger.error("Archive delete failed", e as Error, { archiveId });
      throw e;
    }
  }

  static async cleanupOldArchives(ageMonths: number = 12) {
    try {
      const deletedCount = await archiveApi().cleanupOld(ageMonths);

      logger.info("Archive cleanup completed", {
        deletedCount,
      });

      return deletedCount;
    } catch (e) {
      logger.error("Archive cleanup failed", e as Error);
      throw e;
    }
  }
}

export default AuditArchiver;
