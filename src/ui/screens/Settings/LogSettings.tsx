/**
 * Log & Archive Management Settings Component
 * UI for managing application logs and audit archives
 */

import React, { useEffect, useState } from "react";
import { logger } from "../../../app/utils/logger";
import { AuditArchiver } from "../../../app/utils/auditArchiver";
import { CrashRecovery } from "../../../app/utils/crashRecovery";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import styles from "./LogSettings.module.css";

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  context?: Record<string, any>;
}

interface ArchiveInfo {
  _id: string;
  startDate: number;
  endDate: number;
  count: number;
  fileSize?: number;
  archivedAt: number;
}

export default function LogSettings() {
  const [activeTab, setActiveTab] = useState<"logs" | "archives" | "recovery">("logs");
  const [recentLogs, setRecentLogs] = useState<LogEntry[]>([]);
  const [archives, setArchives] = useState<ArchiveInfo[]>([]);
  const [logStats, setLogStats] = useState({ totalLogs: 0, lastUpdated: new Date() });
  const [archiveStats, setArchiveStats] = useState({
    totalArchives: 0,
    totalArchivedLogs: 0,
    totalSize: 0,
  });
  const [recoveryState, setRecoveryState] = useState<any>(null);
  const [selectedArchives, setSelectedArchives] = useState<Set<string>>(new Set());
  const [exportingLogs, setExportingLogs] = useState(false);

  // Load log data
  useEffect(() => {
    loadLogData();
    const interval = setInterval(loadLogData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Load archive data
  useEffect(() => {
    loadArchiveData();
  }, []);

  // Load recovery state
  useEffect(() => {
    if (CrashRecovery.hasRecoverableState()) {
      const state = CrashRecovery.getRecoveryState();
      setRecoveryState(state);
    }
  }, []);

  const loadLogData = async () => {
    try {
      const logs = logger.getRecentLogs(100);
      setRecentLogs(logs);
      setLogStats({
        totalLogs: logs.length,
        lastUpdated: new Date(),
      });
    } catch (error) {
      console.error("Failed to load log data", error);
    }
  };

  const loadArchiveData = async () => {
    try {
      const archiveList = await AuditArchiver.getArchives();
      setArchives(archiveList);

      const stats = await AuditArchiver.getArchiveStats();
      setArchiveStats(stats);
    } catch (error) {
      console.error("Failed to load archive data", error);
    }
  };

  const handleExportLogs = async (format: "json" | "csv") => {
    try {
      setExportingLogs(true);
      const content = format === "json" ? logger.exportJSON() : logger.exportCSV();
      const filename = `pos-logs-${new Date().toISOString()}.${format}`;

      const blob = new Blob([content], {
        type: format === "json" ? "application/json" : "text/csv",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export failed", error);
      alert("Failed to export logs");
    } finally {
      setExportingLogs(false);
    }
  };

  const handleClearLogs = () => {
    if (window.confirm("Are you sure you want to clear all logs? This action cannot be undone.")) {
      try {
        (logger as any).logs = [];
        setRecentLogs([]);
        alert("Logs cleared successfully");
      } catch (error) {
        console.error("Failed to clear logs", error);
      }
    }
  };

  const handleExportArchive = async (archiveId: string) => {
    try {
      const csv = await AuditArchiver.exportArchiveAsCSV(archiveId);
      const filename = `archive-${archiveId}.csv`;
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export failed", error);
      alert("Failed to export archive");
    }
  };

  const handleDeleteArchive = async (archiveId: string) => {
    if (
      window.confirm("Are you sure you want to delete this archive? This action cannot be undone.")
    ) {
      try {
        await AuditArchiver.deleteArchive(archiveId);
        await loadArchiveData();
        alert("Archive deleted successfully");
      } catch (error) {
        console.error("Delete failed", error);
      }
    }
  };

  const handleToggleArchiveSelection = (archiveId: string) => {
    const newSelected = new Set(selectedArchives);
    if (newSelected.has(archiveId)) {
      newSelected.delete(archiveId);
    } else {
      newSelected.add(archiveId);
    }
    setSelectedArchives(newSelected);
  };

  const handleBulkDeleteArchives = async () => {
    if (selectedArchives.size === 0) {
      alert("Please select archives to delete");
      return;
    }

    if (window.confirm(`Delete ${selectedArchives.size} archive(s)? This cannot be undone.`)) {
      try {
        await Promise.all([...selectedArchives].map((archiveId) => AuditArchiver.deleteArchive(archiveId)));
        await loadArchiveData();
        setSelectedArchives(new Set());
        alert("Archives deleted successfully");
      } catch (error) {
        console.error("Bulk delete failed", error);
      }
    }
  };

  const handleCleanupOldArchives = async (ageMonths: number = 12) => {
    if (window.confirm(`Delete archives older than ${ageMonths} months? This cannot be undone.`)) {
      try {
        await AuditArchiver.cleanupOldArchives(ageMonths);
        await loadArchiveData();
        alert("Old archives cleaned up successfully");
      } catch (error) {
        console.error("Cleanup failed", error);
      }
    }
  };

  const handleViewRecoveryState = () => {
    if (!recoveryState) {
      alert("No recovery state available");
      return;
    }

    alert(`Recovery state available from ${new Date(recoveryState.timestamp).toLocaleString()}`);
  };

  const handleClearRecovery = () => {
    if (window.confirm("Clear the recovery state? You may lose unsaved data.")) {
      try {
        CrashRecovery.clearRecoveryState();
        setRecoveryState(null);
        alert("Recovery state cleared");
      } catch (error) {
        console.error("Clear recovery failed", error);
      }
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) {
return "0 B";
}
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const formatDate = (timestamp: number | string) => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : new Date(timestamp);
    return date.toLocaleString();
  };

  const logLevelTone = (level: LogEntry["level"]) => {
    if (level === "warn") {
      return "attention" as const;
    }
    if (level === "error") {
      return "danger" as const;
    }
    if (level === "info") {
      return "occupied" as const;
    }
    return "neutral" as const;
  };

  return (
    <div className={styles.container}>
      <h2>System Logs & Archives</h2>

      {/* Tab Navigation */}
      <div className={styles.tabNavigation} role="group" aria-label="Log settings sections">
        <button
          className={`${styles.tabButton} ${activeTab === "logs" ? styles.active : ""}`}
          aria-pressed={activeTab === "logs"}
          onClick={() => setActiveTab("logs")}
        >
           Recent Logs
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "archives" ? styles.active : ""}`}
          aria-pressed={activeTab === "archives"}
          onClick={() => setActiveTab("archives")}
        >
           Archives ({archiveStats.totalArchives})
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "recovery" ? styles.active : ""}`}
          aria-pressed={activeTab === "recovery"}
          onClick={() => setActiveTab("recovery")}
        >
           Recovery
        </button>
      </div>

      {/* Logs Tab */}
      {activeTab === "logs" && (
        <div className={styles.tabPanel}>
          <div className={styles.header}>
            <h3>Recent Logs</h3>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Total Logs:</span>
                <span className={styles.statValue}>{logStats.totalLogs}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Last Updated:</span>
                <span className={styles.statValue}>
                  {logStats.lastUpdated.toLocaleTimeString()}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => handleExportLogs("json")}
              disabled={exportingLogs}
            >
              Export JSON
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExportLogs("csv")}
              disabled={exportingLogs}
            >
              Export CSV
            </Button>
            <Button variant="danger" onClick={handleClearLogs}>
              Clear All Logs
            </Button>
          </div>

          <div className={styles.logsList}>
            {recentLogs.length === 0 ? (
              <div className={styles.empty}>No logs available</div>
            ) : (
              recentLogs.map((log, index) => (
                <div key={index} className={`${styles.logEntry} ${styles[log.level]}`}>
                  <div className={styles.logHeader}>
                    <span className={styles.timestamp}>{log.timestamp}</span>
                    <Badge tone={logLevelTone(log.level)}>{log.level.toUpperCase()}</Badge>
                  </div>
                  <div className={styles.message}>{log.message}</div>
                  {log.context && Object.keys(log.context).length > 0 && (
                    <div className={styles.context}>
                      <code>{JSON.stringify(log.context, null, 2)}</code>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Archives Tab */}
      {activeTab === "archives" && (
        <div className={styles.tabPanel}>
          <div className={styles.header}>
            <h3>Audit Archives</h3>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Total Archives:</span>
                <span className={styles.statValue}>{archiveStats.totalArchives}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Total Size:</span>
                <span className={styles.statValue}>{formatBytes(archiveStats.totalSize || 0)}</span>
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            <Button
              variant="danger"
              onClick={handleBulkDeleteArchives}
              disabled={selectedArchives.size === 0}
            >
              Delete Selected ({selectedArchives.size})
            </Button>
            <Button variant="accent" onClick={() => handleCleanupOldArchives(12)}>
              Cleanup Archives &gt;1 year
            </Button>
          </div>

          <div className={styles.archivesList}>
            {archives.length === 0 ? (
              <div className={styles.empty}>No archives available</div>
            ) : (
              archives.map((archive) => (
                <div key={archive._id} className={styles.archiveItem}>
                  <div className={styles.archiveHeader}>
                    <input
                      type="checkbox"
                      checked={selectedArchives.has(archive._id)}
                      onChange={() => handleToggleArchiveSelection(archive._id)}
                    />
                    <span className={styles.archiveTitle}>
                      {formatDate(archive.startDate)} → {formatDate(archive.endDate)}
                    </span>
                    <span className={styles.archiveMeta}>
                      {archive.count} entries • {formatBytes(archive.fileSize || 0)}
                    </span>
                  </div>
                  <div className={styles.archiveActions}>
                    <Button size="sm" variant="secondary" onClick={() => handleExportArchive(archive._id)}>
                      Export
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDeleteArchive(archive._id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Recovery Tab */}
      {activeTab === "recovery" && (
        <div className={styles.tabPanel}>
          <div className={styles.header}>
            <h3>Crash Recovery</h3>
          </div>

          {recoveryState ? (
            <div className={styles.recoveryInfo}>
              <div className={styles.recoveryItem}>
                <span className={styles.label}>Recovered At:</span>
                <span>{formatDate(recoveryState.timestamp)}</span>
              </div>
              {recoveryState.currentOrderId && (
                <div className={styles.recoveryItem}>
                  <span className={styles.label}>Order ID:</span>
                  <span>{recoveryState.currentOrderId}</span>
                </div>
              )}
              {recoveryState.currentTable && (
                <div className={styles.recoveryItem}>
                  <span className={styles.label}>Table:</span>
                  <span>Table {recoveryState.currentTable}</span>
                </div>
              )}
              <div className={styles.recoveryItem}>
                <span className={styles.label}>Cart Items:</span>
                <span>{recoveryState.cartItems?.length || 0} items</span>
              </div>
              <div className={styles.recoveryItem}>
                <span className={styles.label}>Discount:</span>
                <span>{recoveryState.discountPercent || 0}%</span>
              </div>

              <div className={styles.recoveryJSON}>
                <h4>Full Recovery State:</h4>
                <code>{JSON.stringify(CrashRecovery.exportRecoveryState(), null, 2)}</code>
              </div>

              <div className={styles.actions}>
                <Button variant="secondary" onClick={handleViewRecoveryState}>
                  View Recovery State
                </Button>
                <Button variant="danger" onClick={handleClearRecovery}>
                  Clear Recovery State
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.empty}>
              <p>No recovery state available</p>
              <p style={{ fontSize: "0.9em", color: "var(--pos-tx-sub)" }}>
                Recovery data is created when the app crashes unexpectedly with unsaved orders
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
