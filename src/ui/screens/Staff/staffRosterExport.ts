import type { StaffDoc } from "../../../app/db/posRepository";
import { normalizeText } from "../../../shared/validation";
import { PRINT } from "../../theme/print-html";

export type StaffExportOptions = {
  includePhotos: boolean;
  includeSalary: boolean;
  includeInactive: boolean;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatExportDate(value: string | number | null | undefined) {
  if (!value) {
    return "";
  }
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatSalary(value: StaffDoc["salary"]) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "";
  }
  return `Rs. ${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function factRow(label: string, value: unknown, multiline = false) {
  const raw = multiline ? String(value ?? "").replace(/\r\n/g, "\n").trim() : normalizeText(value);
  if (!raw) {
    return "";
  }
  const text = multiline ? escapeHtml(raw).replace(/\n/g, "<br/>") : escapeHtml(raw);
  return `<tr><td class="label">${escapeHtml(label)}</td><td>${text}</td></tr>`;
}

function exportPhotoHtml(member: StaffDoc) {
  const initial = escapeHtml((member.name || "?").charAt(0).toUpperCase() || "?");
  if (!member.photoMime || !member.photoBase64) {
    return `<div class="avatar">${initial}</div>`;
  }
  return `<img class="photo-img" width="84" height="84" src="data:${escapeHtml(member.photoMime)};base64,${member.photoBase64}" alt=""/>`;
}

function csvCell(value: unknown) {
  const text = normalizeText(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  if (
    safeText.includes(",") ||
    safeText.includes('"') ||
    safeText.includes("\n") ||
    safeText.includes("\r")
  ) {
    return `"${safeText.replace(/"/g, '""')}"`;
  }
  return safeText;
}

export function buildStaffRosterCsv(records: StaffDoc[], options: StaffExportOptions) {
  const header = ["Name", "Mobile Number", "Designation", "Joining Date", "Status"];
  if (options.includeSalary) {
    header.push("Monthly Salary");
  }
  header.push("Address", "Notes");

  const rows = records.map((member) => {
    const row: unknown[] = [
      member.name,
      member.phone,
      member.designation || "",
      formatExportDate(member.joiningDate),
      member.active === false ? "Left" : "Active",
    ];
    if (options.includeSalary) {
      row.push(formatSalary(member.salary));
    }
    row.push(member.address || "", member.notes || "");
    return row;
  });

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function buildStaffRosterPdfHtml(
  records: StaffDoc[],
  options: StaffExportOptions,
  exportedBy: string,
) {
  const generatedAt = new Date().toLocaleString("en-IN");
  const cards = records.length
    ? records
        .map((member, index) => {
          const left = member.active === false;
          const facts = [
            factRow("Designation", member.designation),
            factRow("Mobile", member.phone),
            factRow("Joining date", formatExportDate(member.joiningDate)),
            options.includeSalary ? factRow("Monthly salary", formatSalary(member.salary)) : "",
            factRow("Address", member.address, true),
            factRow("Notes", member.notes, true),
          ].join("");
          const photo = options.includePhotos
            ? `<td class="photo">${exportPhotoHtml(member)}</td>`
            : "";
          return `<table class="person ${left ? "left" : "active"}">
            <tr>
              ${photo}
              <td class="body">
                <div class="name">${index + 1}. ${escapeHtml(member.name || "—")} <span class="badge ${left ? "left" : "active"}">${left ? "Left" : "Active"}</span></div>
                <table class="facts">
                  ${facts}
                </table>
              </td>
            </tr>
          </table>`;
        })
        .join("")
    : `<p class="empty-roster">No staff records in this export.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Confidential Staff Roster</title>
  <style>
    * { box-sizing: border-box; }
    html, body { background: ${PRINT.paper}; color: ${PRINT.ink}; color-scheme: light; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .sub { color: ${PRINT.sub}; margin: 0 0 14px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; }
    .meta { margin: 0 0 16px; }
    .meta td { width: 25%; border: 1px solid ${PRINT.line}; background: ${PRINT.paper}; padding: 8px 10px; vertical-align: top; }
    .meta span { display: block; color: ${PRINT.sub}; font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; font-weight: 700; margin-bottom: 3px; }
    .meta strong { font-size: 13px; }
    table.person { width: 100%; border-collapse: collapse; border: 1px solid ${PRINT.line}; margin: 0 0 10px; break-inside: avoid; page-break-inside: avoid; }
    table.person td.photo { width: 100px; padding: 10px; vertical-align: top; background: ${PRINT.paper}; }
    table.person td.body { padding: 8px 12px 10px 0; vertical-align: top; background: ${PRINT.paper}; }
    table.person.left td.photo, table.person.left td.body { background: ${PRINT.dangerRow}; }
    .avatar, .photo-img { width: 84px; height: 84px; border-radius: 6px; display: block; }
    .avatar { background: ${PRINT.avatar}; color: ${PRINT.paper}; font-size: 28px; font-weight: 700; line-height: 84px; text-align: center; }
    .photo-img { object-fit: cover; }
    table.facts { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.facts td { padding: 2px 0; vertical-align: top; background: transparent; font-size: 12px; overflow-wrap: anywhere; }
    .name { font-size: 15px; font-weight: 700; margin: 0 0 6px; }
    table.facts td.label { width: 108px; color: ${PRINT.sub}; font-weight: 700; padding-right: 8px; }
    .badge { display: inline-block; margin-left: 8px; font-size: 10px; font-weight: 700; line-height: 1; padding: 3px 6px; border-radius: 4px; vertical-align: 2px; }
    .badge.active { background: ${PRINT.badgeActiveBg}; color: ${PRINT.badgeActiveInk}; }
    .badge.left { background: ${PRINT.badgeLeftBg}; color: ${PRINT.badgeLeftInk}; }
    .empty-roster { margin: 0; color: ${PRINT.sub}; }
    footer { margin-top: 8px; color: ${PRINT.muted}; text-align: center; font-size: 10px; }
  </style>
</head>
<body>
  <h1>Confidential Staff Roster</h1>
  <p class="sub">Generated ${escapeHtml(generatedAt)} by ${escapeHtml(exportedBy || "admin")}</p>
  <table class="meta">
    <tr>
      <td><span>Records</span><strong>${records.length}</strong></td>
      <td><span>Photos</span><strong>${options.includePhotos ? "Included" : "Excluded"}</strong></td>
      <td><span>Salary</span><strong>${options.includeSalary ? "Included" : "Excluded"}</strong></td>
      <td><span>Left staff</span><strong>${options.includeInactive ? "Included" : "Excluded"}</strong></td>
    </tr>
  </table>
  ${cards}
  <footer>Personal data. Share only with authorized recipients.</footer>
</body>
</html>`;
}
