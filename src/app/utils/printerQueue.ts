/**
 * Printer Offline Queue System
 * Store print jobs in SQLite through the main-process print queue service.
 */

import { logger } from "../utils/logger";

export interface PrintJob {
  _id: string;
  type: "print-job";
  printerName: string;
  jobType: "receipt" | "kot" | "label";
  content: string | any;
  createdAt: number;
  retryCount: number;
  maxRetries: number;
  lastRetryAt?: number;
  completedAt?: number;
  status: "pending" | "completed" | "failed";
  error?: string;
}

function queueApi() {
  const api = window.pos?.printQueue;
  if (!api) {
    throw new Error("print-queue-api-unavailable");
  }
  return api;
}

export class PrinterOfflineQueue {
  private static readonly MAX_RETRIES = 3;

  static async addPrintJob(
    printerName: string,
    jobType: PrintJob["jobType"],
    content: string | any,
    maxRetries: number = this.MAX_RETRIES,
  ): Promise<PrintJob> {
    try {
      const job = await queueApi().add({ printerName, jobType, content, maxRetries });

      logger.info("Print job queued", {
        jobId: job._id,
        printerName,
        jobType,
      });

      return job as PrintJob;
    } catch (e) {
      logger.error("Failed to queue print job", e as Error, {
        printerName,
        jobType,
      });
      throw e;
    }
  }

  static async getPendingJobs(): Promise<PrintJob[]> {
    try {
      const jobs = (await queueApi().list("pending")) as PrintJob[];
      return jobs.sort((a, b) => a.createdAt - b.createdAt);
    } catch (e) {
      logger.error("Failed to get pending print jobs", e as Error);
      return [];
    }
  }

  static async getPendingJobsForPrinter(printerName: string): Promise<PrintJob[]> {
    try {
      const jobs = await this.getPendingJobs();
      return jobs.filter((job) => job.printerName === printerName);
    } catch (e) {
      logger.error("Failed to get printer jobs", e as Error, { printerName });
      return [];
    }
  }

  static async markJobCompleted(jobId: string) {
    try {
      await queueApi().markCompleted(jobId);
      logger.info("Print job completed", { jobId });
    } catch (e) {
      logger.error("Failed to mark job completed", e as Error, { jobId });
    }
  }

  static async retryPrintJob(jobId: string, options?: { confirm?: boolean }): Promise<boolean> {
    try {
      const result = await queueApi().retry(jobId, options);
      if (result && typeof result === "object") {
        if (result.ok === false) {
          logger.error("Failed to retry print job", new Error(String(result.error || "print-failed")), {
            jobId,
          });
          return false;
        }
        logger.info("Print job retry completed", { jobId });
        return true;
      }
      return Boolean(result);
    } catch (e) {
      logger.error("Failed to retry print job", e as Error, { jobId });
      return false;
    }
  }

  static async getQueueStats(): Promise<{
    totalPending: number;
    totalCompleted: number;
    totalFailed: number;
    oldestPendingAge: number | null;
  }> {
    try {
      const jobs = (await queueApi().list()) as PrintJob[];
      const pending = jobs.filter((job) => job.status === "pending");
      const completed = jobs.filter((job) => job.status === "completed");
      const failed = jobs.filter((job) => job.status === "failed");

      const oldestPending =
        pending.length > 0 ? Math.min(...pending.map((job) => job.createdAt)) : null;

      return {
        totalPending: pending.length,
        totalCompleted: completed.length,
        totalFailed: failed.length,
        oldestPendingAge: oldestPending ? Date.now() - oldestPending : null,
      };
    } catch (e) {
      logger.error("Failed to get queue stats", e as Error);
      return {
        totalPending: 0,
        totalCompleted: 0,
        totalFailed: 0,
        oldestPendingAge: null,
      };
    }
  }

  static async clearOldCompletedJobs(ageHours: number = 24) {
    try {
      const deletedCount = await queueApi().clearOld(ageHours);

      logger.info("Cleared old print jobs", {
        deletedCount,
        ageHours,
      });

      return deletedCount;
    } catch (e) {
      logger.error("Failed to clear old print jobs", e as Error);
      throw e;
    }
  }

  static async exportQueue(): Promise<PrintJob[]> {
    try {
      return (await queueApi().list()) as PrintJob[];
    } catch (e) {
      logger.error("Failed to export queue", e as Error);
      return [];
    }
  }
}

export default PrinterOfflineQueue;
