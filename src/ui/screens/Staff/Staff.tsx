import React from "react";
import {
  createAudit,
  createStaff,
  deleteStaff,
  listStaff,
  updateStaff,
  type StaffDoc,
} from "../../../app/db/posRepository";
import {
  STAFF_TEXT_LIMITS,
  isValidDateOnly,
  isValidIndianMobile,
  isValidPersonName,
  normalizePhone,
  normalizeText,
  parseNonNegativeMoney,
  validationMessage,
} from "../../../shared/validation";
import { AuthContext } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const MAX_PHOTO_BYTES = 500 * 1024;
const PHOTO_SIZE = 512;
const IMAGE_MIME_BY_EXTENSION = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["jfif", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
]);

type PhotoDraft = {
  photoMime: string;
  photoBase64: string;
};

type PhotoPreview = {
  src: string;
  name: string;
  mime: string;
  memberId?: string;
};

type StaffForm = {
  name: string;
  phone: string;
  designation: string;
  joiningDate: string;
  salary: string;
  address: string;
  notes: string;
};

const emptyForm: StaffForm = {
  name: "",
  phone: "",
  designation: "",
  joiningDate: "",
  salary: "",
  address: "",
  notes: "",
};

function imageSrc(photo?: PhotoDraft | Pick<StaffDoc, "photoMime" | "photoBase64"> | null) {
  if (!photo?.photoMime || !photo?.photoBase64) {
    return null;
  }
  return `data:${photo.photoMime};base64,${photo.photoBase64}`;
}

function photoExtension(mime: string) {
  const normalized = mime.toLowerCase();
  if (normalized.includes("png")) {
    return "png";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  return "jpg";
}

function safeFilePart(value: string) {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "staff";
}

function base64ByteLength(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function imageMimeForFile(file: File) {
  const type = file.type.toLowerCase();
  if (SUPPORTED_IMAGE_MIME_TYPES.has(type)) {
    return type === "image/jpg" || type === "image/pjpeg" ? "image/jpeg" : type;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return IMAGE_MIME_BY_EXTENSION.get(extension) || null;
}

function fileToDataUrl(file: File, mime: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.replace(/^data:[^;]*;base64,/i, `data:${mime};base64,`));
    };
    reader.onerror = () => reject(reader.error || new Error("staff-photo-invalid"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("staff-photo-invalid"));
    img.src = src;
  });
}

async function compressStaffPhoto(file: File): Promise<PhotoDraft> {
  const mime = imageMimeForFile(file);
  if (!mime) {
    throw new Error("staff-photo-invalid");
  }
  const dataUrl = await fileToDataUrl(file, mime);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, PHOTO_SIZE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("staff-photo-invalid");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  for (const quality of [0.82, 0.72, 0.62]) {
    const compressed = canvas.toDataURL("image/jpeg", quality);
    const [, base64 = ""] = compressed.split(",");
    if (base64 && base64ByteLength(base64) <= MAX_PHOTO_BYTES) {
      return { photoMime: "image/jpeg", photoBase64: base64 };
    }
  }
  throw new Error("staff-photo-too-large");
}

function validateForm(form: StaffForm) {
  const name = normalizeText(form.name);
  const phone = normalizePhone(form.phone);
  const designation = normalizeText(form.designation);
  const address = normalizeText(form.address);
  const notes = normalizeText(form.notes);
  if (!isValidPersonName(name, { max: STAFF_TEXT_LIMITS.name })) {
    return validationMessage("staff-name-invalid");
  }
  if (!isValidIndianMobile(phone)) {
    return validationMessage("staff-phone-invalid");
  }
  if (designation.length > STAFF_TEXT_LIMITS.designation) {
    return validationMessage("staff-designation-too-long");
  }
  if (form.joiningDate && !isValidDateOnly(form.joiningDate)) {
    return validationMessage("staff-joining-date-invalid");
  }
  if (form.salary.trim() && parseNonNegativeMoney(form.salary) === null) {
    return validationMessage("staff-salary-invalid");
  }
  if (address.length > STAFF_TEXT_LIMITS.address) {
    return validationMessage("staff-address-too-long");
  }
  if (notes.length > STAFF_TEXT_LIMITS.notes) {
    return validationMessage("staff-notes-too-long");
  }
  return null;
}

function toPayload(form: StaffForm, photo: PhotoDraft | null) {
  const salary = form.salary.trim() ? parseNonNegativeMoney(form.salary) : null;
  return {
    name: normalizeText(form.name),
    phone: normalizePhone(form.phone),
    designation: normalizeText(form.designation) || null,
    joiningDate: form.joiningDate || null,
    salary,
    address: normalizeText(form.address) || null,
    notes: normalizeText(form.notes) || null,
    photoMime: photo?.photoMime || null,
    photoBase64: photo?.photoBase64 || null,
  };
}

function formatSalary(value: StaffDoc["salary"]) {
  if (value === null || value === undefined) {
    return "Not set";
  }
  return `Rs. ${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type StaffExportOptions = {
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
    return "Not set";
  }
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function exportPhotoHtml(member: StaffDoc, includePhotos: boolean) {
  const initial = escapeHtml((member.name || "?").charAt(0).toUpperCase() || "?");
  if (!includePhotos || !member.photoMime || !member.photoBase64) {
    return `<div class="avatar">${initial}</div>`;
  }
  return `<img class="photo" src="data:${escapeHtml(member.photoMime)};base64,${member.photoBase64}" alt=""/>`;
}

function detailRow(label: string, value: unknown) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  return `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(text)}</strong></div>`;
}

function csvCell(value: unknown) {
  const text = normalizeText(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  if (safeText.includes(",") || safeText.includes('"') || safeText.includes("\n") || safeText.includes("\r")) {
    return `"${safeText.replace(/"/g, '""')}"`;
  }
  return safeText;
}

function buildStaffRosterCsv(records: StaffDoc[], options: StaffExportOptions) {
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

function buildStaffRosterPdfHtml(
  records: StaffDoc[],
  options: StaffExportOptions,
  exportedBy: string,
) {
  const generatedAt = new Date().toLocaleString("en-IN");
  const rows = records
    .map((member, index) => {
      const salary = options.includeSalary ? detailRow("Monthly Salary", formatSalary(member.salary)) : "";
      const leftStatus = member.active === false ? `<span class="status inactive">Left</span>` : "";
      return `<section class="staff-card">
        <div class="photo-col">${exportPhotoHtml(member, options.includePhotos)}</div>
        <div class="staff-body">
          <div class="staff-top">
            <div>
              <div class="staff-name">${index + 1}. ${escapeHtml(member.name)}</div>
              ${member.designation ? `<div class="designation">${escapeHtml(member.designation)}</div>` : ""}
            </div>
            ${leftStatus}
          </div>
          <div class="details">
            ${detailRow("Mobile", member.phone)}
            ${detailRow("Joining Date", formatExportDate(member.joiningDate))}
            ${salary}
            ${detailRow("Address", member.address)}
            ${detailRow("Notes", member.notes)}
          </div>
        </div>
      </section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Confidential Staff Roster</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 28px; color: #111827; font-size: 12px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sub { color: #6b7280; margin: 0 0 18px; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 0 0 18px; }
    .meta-box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 9px 10px; }
    .meta-box span { display: block; color: #6b7280; font-size: 9px; text-transform: uppercase; font-weight: 700; margin-bottom: 3px; }
    .meta-box strong { font-size: 12px; }
    .staff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .staff-card { break-inside: avoid; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; display: grid; grid-template-columns: 58px 1fr; gap: 10px; min-height: 82px; }
    .photo, .avatar { width: 54px; height: 54px; border-radius: 7px; object-fit: cover; }
    .avatar { background: #0f766e; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 20px; }
    .staff-top { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
    .staff-name { font-weight: 900; font-size: 13px; }
    .designation { color: #0f766e; font-weight: 700; margin-top: 2px; }
    .status { font-size: 9px; font-weight: 800; text-transform: uppercase; border-radius: 999px; padding: 3px 6px; background: #fee2e2; color: #991b1b; }
    .details { margin-top: 7px; display: grid; gap: 4px; }
    .detail { display: grid; grid-template-columns: 78px 1fr; gap: 6px; }
    .detail span { color: #6b7280; }
    .detail strong { font-weight: 600; overflow-wrap: anywhere; }
    footer { margin-top: 20px; color: #9ca3af; text-align: center; font-size: 10px; }
    @media print {
      body { padding: 0; }
      .staff-card { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>Confidential Staff Roster</h1>
  <p class="sub">Generated ${escapeHtml(generatedAt)} by ${escapeHtml(exportedBy || "admin")}</p>
  <div class="meta">
    <div class="meta-box"><span>Records</span><strong>${records.length}</strong></div>
    <div class="meta-box"><span>Photos</span><strong>${options.includePhotos ? "Included" : "Excluded"}</strong></div>
    <div class="meta-box"><span>Salary</span><strong>${options.includeSalary ? "Included" : "Excluded"}</strong></div>
    <div class="meta-box"><span>Left Staff</span><strong>${options.includeInactive ? "Included" : "Excluded"}</strong></div>
  </div>
  <div class="staff-grid">${rows}</div>
  <footer>Personal data. Share only with authorized recipients.</footer>
</body>
</html>`;
}

const staffFieldGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 12,
};

const requiredBadgeStyle: React.CSSProperties = {
  color: "#b45309",
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1,
};

function FieldShell({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <label
        className="pos-label"
        htmlFor={id}
        style={{ display: "flex", alignItems: "center", gap: 4 }}
      >
        <span>{label}</span>
        {required && <span style={requiredBadgeStyle}>*</span>}
      </label>
      {children}
    </div>
  );
}

function StaffInput({
  id,
  label,
  value,
  onChange,
  required,
  type = "text",
  placeholder,
  inputMode,
  min,
  step,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  min?: number;
  step?: string;
  maxLength?: number;
}) {
  return (
    <FieldShell id={id} label={label} required={required}>
      <input
        id={id}
        className="pos-input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        min={min}
        step={step}
        maxLength={maxLength}
        required={required}
      />
    </FieldShell>
  );
}

function StaffTextArea({
  id,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <FieldShell id={id} label={label}>
      <textarea
        id={id}
        className="pos-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={2}
        style={{ resize: "vertical", minHeight: 40 }}
      />
    </FieldShell>
  );
}

export default function Staff() {
  const { showToast } = useToast();
  const auth = React.useContext(AuthContext);
  const [staff, setStaff] = React.useState<StaffDoc[]>([]);
  const [form, setForm] = React.useState<StaffForm>(emptyForm);
  const [photo, setPhoto] = React.useState<PhotoDraft | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [showLeftStaff, setShowLeftStaff] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportingPdf, setExportingPdf] = React.useState(false);
  const [exportingCsv, setExportingCsv] = React.useState(false);
  const [exportOptions, setExportOptions] = React.useState<StaffExportOptions>({
    includePhotos: true,
    includeSalary: false,
    includeInactive: false,
  });

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<StaffForm>(emptyForm);
  const [editPhoto, setEditPhoto] = React.useState<PhotoDraft | null>(null);
  const [editPhotoChanged, setEditPhotoChanged] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [confirmLeftId, setConfirmLeftId] = React.useState<string | null>(null);
  const [statusChangingId, setStatusChangingId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = React.useState<PhotoPreview | null>(null);
  const savingRef = React.useRef(false);
  const savingEditRef = React.useRef(false);
  const statusChangingRef = React.useRef<string | null>(null);
  const deletingRef = React.useRef<string | null>(null);
  const exportingRef = React.useRef(false);

  const loadStaff = React.useCallback(async (includeLeftOverride?: boolean) => {
    try {
      setStaff(await listStaff({ includeInactive: includeLeftOverride ?? showLeftStaff }));
    } catch (e) {
      showToast(validationMessage(e, "Failed to load staff"), "error");
      setStaff([]);
    }
  }, [showLeftStaff, showToast]);

  React.useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const closeStaffExport = React.useCallback(() => {
    if (!exportingPdf && !exportingCsv) {
      setExportOpen(false);
    }
  }, [exportingCsv, exportingPdf]);
  const closePhotoPreview = React.useCallback(() => setPhotoPreview(null), []);
  const staffExportDialogRef = useFocusTrap<HTMLDivElement>(
    exportOpen,
    exportingPdf || exportingCsv ? undefined : closeStaffExport,
  );
  const photoPreviewDialogRef = useFocusTrap<HTMLDivElement>(
    Boolean(photoPreview),
    closePhotoPreview,
  );

  const setField = (field: keyof StaffForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  };

  const setEditField = (field: keyof StaffForm, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
    setEditError(null);
  };

  const duplicatePhone = (phone: string, currentId?: string) =>
    staff.some((member) => member.active !== false && member.id !== currentId && member.phone === phone);

  const choosePhoto = async (file: File | undefined, mode: "add" | "edit") => {
    if (!file) {
      return;
    }
    try {
      const next = await compressStaffPhoto(file);
      if (mode === "add") {
        setPhoto(next);
        setFormError(null);
      } else {
        setEditPhoto(next);
        setEditPhotoChanged(true);
        setEditError(null);
      }
    } catch (e) {
      const message = validationMessage(e, "Could not read staff photo");
      if (mode === "add") {
        setFormError(message);
      } else {
        setEditError(message);
      }
    }
  };

  const addStaff = async () => {
    if (savingRef.current) {
      return;
    }
    const error = validateForm(form);
    if (error) {
      setFormError(error);
      return;
    }
    const phone = normalizePhone(form.phone);
    if (duplicatePhone(phone)) {
      setFormError(validationMessage("staff-phone-duplicate"));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await createStaff(toPayload(form, photo));
      await loadStaff();
      setForm(emptyForm);
      setPhoto(null);
      setFormError(null);
      showToast("Staff member added", "success");
    } catch (e) {
      setFormError(validationMessage(e, "Failed to add staff member"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const startEdit = (member: StaffDoc) => {
    setConfirmLeftId(null);
    setConfirmDeleteId(null);
    setEditingId(member.id);
    setEditForm({
      name: member.name || "",
      phone: member.phone || "",
      designation: member.designation || "",
      joiningDate: member.joiningDate || "",
      salary: member.salary === null || member.salary === undefined ? "" : String(member.salary),
      address: member.address || "",
      notes: member.notes || "",
    });
    setEditPhoto(
      member.photoMime && member.photoBase64
        ? { photoMime: member.photoMime, photoBase64: member.photoBase64 }
        : null,
    );
    setEditPhotoChanged(false);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm);
    setEditPhoto(null);
    setEditPhotoChanged(false);
    setEditError(null);
  };

  const saveEdit = async (member: StaffDoc) => {
    if (savingEditRef.current) {
      return;
    }
    const error = validateForm(editForm);
    if (error) {
      setEditError(error);
      return;
    }
    const phone = normalizePhone(editForm.phone);
    if (duplicatePhone(phone, member.id)) {
      setEditError(validationMessage("staff-phone-duplicate"));
      return;
    }
    savingEditRef.current = true;
    setSavingEdit(true);
    try {
      const payload: Partial<StaffDoc> = toPayload(editForm, editPhoto);
      if (!editPhotoChanged) {
        delete payload.photoMime;
        delete payload.photoBase64;
      }
      await updateStaff(member.id, payload);
      await loadStaff();
      cancelEdit();
      showToast("Staff member updated", "success");
    } catch (e) {
      setEditError(validationMessage(e, "Failed to update staff member"));
    } finally {
      savingEditRef.current = false;
      setSavingEdit(false);
    }
  };

  const changeStaffStatus = async (id: string, active: boolean) => {
    if (statusChangingRef.current) {
      return;
    }
    statusChangingRef.current = id;
    setStatusChangingId(id);
    try {
      await updateStaff(id, { active });
      const shouldShowLeftStaff = active ? showLeftStaff : true;
      if (!active) {
        setShowLeftStaff(true);
      }
      await loadStaff(shouldShowLeftStaff);
      if (!active && editingId === id) {
        cancelEdit();
      }
      setConfirmLeftId(null);
      setConfirmDeleteId(null);
      showToast(active ? "Staff member restored" : "Staff member marked Left", "success");
    } catch (e) {
      showToast(validationMessage(e, active ? "Failed to restore staff member" : "Failed to mark staff member Left"), "error");
    } finally {
      statusChangingRef.current = null;
      setStatusChangingId(null);
    }
  };

  const removeStaff = async (id: string) => {
    if (deletingRef.current) {
      return;
    }
    deletingRef.current = id;
    setDeletingId(id);
    try {
      await deleteStaff(id);
      await loadStaff();
      if (editingId === id) {
        cancelEdit();
      }
      setConfirmLeftId(null);
      setConfirmDeleteId(null);
      showToast("Staff member deleted", "success");
    } catch (e) {
      showToast(validationMessage(e, "Failed to delete staff member"), "error");
    } finally {
      deletingRef.current = null;
      setDeletingId(null);
    }
  };

  const setExportOption = (field: keyof StaffExportOptions, value: boolean) => {
    setExportOptions((prev) => ({ ...prev, [field]: value }));
  };

  const exportStaffCsv = async () => {
    if (exportingRef.current) {
      return;
    }
    exportingRef.current = true;
    setExportingCsv(true);
    try {
      const records = await listStaff({ includeInactive: exportOptions.includeInactive });
      if (records.length === 0) {
        showToast("No staff records to export", "error");
        return;
      }
      const exportedBy = auth?.session?.username || "admin";
      const csv = buildStaffRosterCsv(records, exportOptions);
      const fileName = `${exportOptions.includeInactive ? "staff-roster-all" : "staff-roster-active"}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      try {
        await createAudit("staff.export.csv", null, exportedBy, {
          count: records.length,
          includeSalary: exportOptions.includeSalary,
          includeInactive: exportOptions.includeInactive,
        });
      } catch (auditError) {
        console.warn("Staff CSV export audit failed", auditError);
      }
      setExportOpen(false);
      showToast("Staff CSV exported", "success");
    } catch (e) {
      showToast(validationMessage(e, "Failed to export staff CSV"), "error");
    } finally {
      exportingRef.current = false;
      setExportingCsv(false);
    }
  };

  const exportStaffPdf = async () => {
    if (exportingRef.current) {
      return;
    }
    exportingRef.current = true;
    setExportingPdf(true);
    try {
      const records = await listStaff({ includeInactive: exportOptions.includeInactive });
      if (records.length === 0) {
        showToast("No staff records to export", "error");
        return;
      }
      const exportedBy = auth?.session?.username || "admin";
      const html = buildStaffRosterPdfHtml(records, exportOptions, exportedBy);
      const fileName = exportOptions.includeInactive ? "staff-roster-all" : "staff-roster-active";
      if (window.pos?.exportReportPdf) {
        const result = await window.pos.exportReportPdf(html, fileName);
        if (result?.ok === false) {
          if (result.reason === "cancelled") {
            showToast("Export cancelled", "info");
            return;
          }
          throw new Error(result.error || "Export failed");
        }
      } else {
        throw new Error("PDF export is available only in Electron.");
      }
      try {
        await createAudit("staff.export.pdf", null, exportedBy, {
          count: records.length,
          includePhotos: exportOptions.includePhotos,
          includeSalary: exportOptions.includeSalary,
          includeInactive: exportOptions.includeInactive,
        });
      } catch (auditError) {
        console.warn("Staff export audit failed", auditError);
      }
      setExportOpen(false);
      showToast("Staff PDF exported", "success");
    } catch (e) {
      showToast(validationMessage(e, "Failed to export staff PDF"), "error");
    } finally {
      exportingRef.current = false;
      setExportingPdf(false);
    }
  };

  const downloadPhotoPreview = async () => {
    if (!photoPreview) {
      return;
    }
    const fileName = `staff-${safeFilePart(photoPreview.name)}-photo.${photoExtension(photoPreview.mime)}`;
    const link = document.createElement("a");
    link.href = photoPreview.src;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("Photo download started", "success");

    try {
      await createAudit("staff.photo.downloaded", null, auth?.session?.username || null, {
        staffId: photoPreview.memberId || null,
        staffName: photoPreview.name,
        fileName,
      });
    } catch (auditError) {
      console.warn("Staff photo download audit failed", auditError);
    }
  };

  const renderPhoto = (member: StaffDoc | null, draft?: PhotoDraft | null) => {
    const photoSource = draft || member;
    const src = imageSrc(photoSource);
    const name = normalizeText(member?.name) || normalizeText(form.name) || "Staff photo";
    if (src) {
      return (
        <button
          type="button"
          onClick={() =>
            setPhotoPreview({
              src,
              name,
              mime: photoSource?.photoMime || "image/jpeg",
              memberId: member?.id,
            })
          }
          aria-label={`Open ${name} photo`}
          title="Open photo"
          style={{
            width: 48,
            height: 48,
            border: "none",
            borderRadius: 8,
            padding: 0,
            background: "transparent",
            cursor: "zoom-in",
            flexShrink: 0,
            overflow: "hidden",
            boxShadow: "0 0 0 1px #e5e7eb",
          }}
        >
          <img
            src={src}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </button>
      );
    }
    const initial = (draft ? "" : member?.name || "?").charAt(0).toUpperCase() || "?";
    return (
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 8,
          background: "linear-gradient(135deg,#0f766e,#14b8a6)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {initial}
      </div>
    );
  };

  return (
    <div className="pos-page">
      <div className="pos-ph">
        <div>
          <h2 className="pos-ph-title">Staff</h2>
          <p className="pos-ph-sub">Manage staff details, optional salary details, and profile photos</p>
        </div>
        <div className="pos-ph-actions">
          <button
            type="button"
            className={`pos-btn ${showLeftStaff ? "pos-btn-primary" : "pos-btn-secondary"}`}
            onClick={() => setShowLeftStaff((value) => !value)}
            aria-pressed={showLeftStaff}
          >
            {showLeftStaff ? "Hide Left Staff" : "Show Left Staff"}
          </button>
          <button
            type="button"
            className="pos-btn pos-btn-secondary"
            onClick={() => setExportOpen(true)}
            disabled={exportingPdf || exportingCsv}
          >
            Export
          </button>
        </div>
      </div>

      {exportOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15,23,42,0.42)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            ref={staffExportDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="staffExportTitle"
            tabIndex={-1}
            className="pos-card pos-card-p"
            style={{ width: "min(520px, 100%)", boxShadow: "0 24px 80px rgba(15,23,42,0.28)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
              <div>
                <h3 id="staffExportTitle" style={{ margin: 0, fontSize: 18 }}>
                  Export Staff
                </h3>
                <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 12 }}>
                  Confidential roster export
                </p>
              </div>
              <button
                type="button"
                className="pos-btn pos-btn-secondary pos-btn-sm"
                onClick={closeStaffExport}
                disabled={exportingPdf || exportingCsv}
              >
                Close
              </button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={exportOptions.includePhotos}
                  onChange={(e) => setExportOption("includePhotos", e.target.checked)}
                />
                <span>
                  <strong>Include photos</strong>
                  <span style={{ display: "block", color: "#6b7280", marginTop: 2 }}>
                    Adds profile images to the PDF roster only.
                  </span>
                </span>
              </label>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={exportOptions.includeSalary}
                  onChange={(e) => setExportOption("includeSalary", e.target.checked)}
                />
                <span>
                  <strong>Include salary</strong>
                  <span style={{ display: "block", color: "#b45309", marginTop: 2 }}>
                    Salary is sensitive and is excluded by default.
                  </span>
                </span>
              </label>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={exportOptions.includeInactive}
                  onChange={(e) => setExportOption("includeInactive", e.target.checked)}
                />
                <span>
                  <strong>Include left staff</strong>
                  <span style={{ display: "block", color: "#6b7280", marginTop: 2 }}>
                    Adds staff marked Left to the roster.
                  </span>
                </span>
              </label>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 18,
                paddingTop: 14,
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <button
                type="button"
                className="pos-btn pos-btn-secondary"
                onClick={closeStaffExport}
                disabled={exportingPdf || exportingCsv}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pos-btn pos-btn-secondary"
                onClick={exportStaffCsv}
                disabled={exportingPdf || exportingCsv}
              >
                {exportingCsv ? "Exporting..." : "Export CSV"}
              </button>
              <button
                type="button"
                className="pos-btn pos-btn-primary"
                onClick={exportStaffPdf}
                disabled={exportingPdf || exportingCsv}
              >
                {exportingPdf ? "Exporting..." : "Export PDF"}
              </button>
            </div>
          </div>
        </div>
      )}

      {photoPreview && (
        <div
          onClick={closePhotoPreview}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            background: "rgba(15,23,42,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            ref={photoPreviewDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="staffPhotoPreviewTitle"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(560px, 96vw)",
              maxHeight: "92vh",
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 24px 80px rgba(15,23,42,0.36)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "14px 16px",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <div>
                <h3 id="staffPhotoPreviewTitle" style={{ margin: 0, fontSize: 16 }}>
                  {photoPreview.name}
                </h3>
                <div style={{ marginTop: 2, color: "#6b7280", fontSize: 12 }}>Staff photo</div>
              </div>
              <button
                type="button"
                onClick={downloadPhotoPreview}
                className="pos-btn pos-btn-primary pos-btn-sm"
              >
                Download
              </button>
              <button
                type="button"
                onClick={closePhotoPreview}
                className="pos-btn pos-btn-secondary pos-btn-sm"
              >
                Close
              </button>
            </div>
            <div
              style={{
                padding: 16,
                background: "#f8fafc",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src={photoPreview.src}
                alt=""
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: "calc(92vh - 96px)",
                  borderRadius: 10,
                  objectFit: "contain",
                  background: "#fff",
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="pos-card pos-card-p" style={{ marginBottom: 18 }}>
        <p style={{ margin: "0 0 14px", fontWeight: 800, fontSize: 13 }}>Add Staff Member</p>
        <div style={staffFieldGrid}>
          <StaffInput
            id="staff-name"
            label="Name"
            value={form.name}
            onChange={(value) => setField("name", value)}
            placeholder="Staff member name"
            maxLength={STAFF_TEXT_LIMITS.name}
            required
          />
          <StaffInput
            id="staff-phone"
            label="Mobile Number"
            value={form.phone}
            onChange={(value) => setField("phone", normalizePhone(value))}
            placeholder="10-digit mobile"
            type="tel"
            inputMode="tel"
            required
          />
          <StaffInput
            id="staff-designation"
            label="Designation"
            value={form.designation}
            onChange={(value) => setField("designation", value)}
            placeholder="Optional"
            maxLength={STAFF_TEXT_LIMITS.designation}
          />
          <StaffInput
            id="staff-joining-date"
            label="Joining Date"
            type="date"
            value={form.joiningDate}
            onChange={(value) => setField("joiningDate", value)}
          />
          <StaffInput
            id="staff-salary"
            label="Monthly Salary"
            type="number"
            value={form.salary}
            onChange={(value) => setField("salary", value)}
            placeholder="Optional"
            min={0}
            step="0.01"
          />
          <StaffTextArea
            id="staff-address"
            label="Address"
            value={form.address}
            onChange={(value) => setField("address", value)}
            placeholder="Optional"
            maxLength={STAFF_TEXT_LIMITS.address}
          />
          <StaffTextArea
            id="staff-notes"
            label="Notes"
            value={form.notes}
            onChange={(value) => setField("notes", value)}
            placeholder="Optional"
            maxLength={STAFF_TEXT_LIMITS.notes}
          />
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          {renderPhoto(null, photo)}
          <FieldShell id="staff-photo" label="Photo">
            <input id="staff-photo" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.jfif,.png,.webp" onChange={(e) => choosePhoto(e.target.files?.[0], "add")} />
          </FieldShell>
          {photo && (
            <button type="button" onClick={() => setPhoto(null)} className="pos-btn pos-btn-secondary pos-btn-sm">
              Remove Photo
            </button>
          )}
          <button onClick={addStaff} disabled={saving} className="pos-btn pos-btn-primary">
            {saving ? "Saving..." : "Add Staff"}
          </button>
          {formError && <div className="pos-field-error">{formError}</div>}
        </div>
      </div>

      {staff.length === 0 ? (
        <div className="pos-empty">
          {showLeftStaff ? "No staff records found." : "No active staff records yet. Add the first staff member above."}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {staff.map((member) => {
            const isEditing = editingId === member.id;
            const isActive = member.active !== false;
            const isConfirmingLeft = confirmLeftId === member.id;
            const isConfirmingDelete = confirmDeleteId === member.id;
            const isChangingStatus = statusChangingId === member.id;
            return (
              <div key={member.id} className="pos-card" style={{ padding: 16 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  {renderPhoto(member, isEditing ? editPhoto : undefined)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEditing ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={staffFieldGrid}>
                          <StaffInput
                            id={`staff-edit-name-${member.id}`}
                            label="Name"
                            value={editForm.name}
                            onChange={(value) => setEditField("name", value)}
                            maxLength={STAFF_TEXT_LIMITS.name}
                            required
                          />
                          <StaffInput
                            id={`staff-edit-phone-${member.id}`}
                            label="Mobile Number"
                            value={editForm.phone}
                            onChange={(value) => setEditField("phone", normalizePhone(value))}
                            type="tel"
                            inputMode="tel"
                            required
                          />
                          <StaffInput
                            id={`staff-edit-designation-${member.id}`}
                            label="Designation"
                            value={editForm.designation}
                            onChange={(value) => setEditField("designation", value)}
                            placeholder="Optional"
                            maxLength={STAFF_TEXT_LIMITS.designation}
                          />
                          <StaffInput
                            id={`staff-edit-joining-date-${member.id}`}
                            label="Joining Date"
                            type="date"
                            value={editForm.joiningDate}
                            onChange={(value) => setEditField("joiningDate", value)}
                          />
                          <StaffInput
                            id={`staff-edit-salary-${member.id}`}
                            label="Monthly Salary"
                            type="number"
                            value={editForm.salary}
                            onChange={(value) => setEditField("salary", value)}
                            min={0}
                            step="0.01"
                          />
                          <StaffTextArea
                            id={`staff-edit-address-${member.id}`}
                            label="Address"
                            value={editForm.address}
                            onChange={(value) => setEditField("address", value)}
                            placeholder="Optional"
                            maxLength={STAFF_TEXT_LIMITS.address}
                          />
                          <StaffTextArea
                            id={`staff-edit-notes-${member.id}`}
                            label="Notes"
                            value={editForm.notes}
                            onChange={(value) => setEditField("notes", value)}
                            placeholder="Optional"
                            maxLength={STAFF_TEXT_LIMITS.notes}
                          />
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <FieldShell id={`staff-edit-photo-${member.id}`} label="Photo">
                            <input id={`staff-edit-photo-${member.id}`} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.jfif,.png,.webp" onChange={(e) => choosePhoto(e.target.files?.[0], "edit")} />
                          </FieldShell>
                          {editPhoto && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditPhoto(null);
                                setEditPhotoChanged(true);
                              }}
                              className="pos-btn pos-btn-secondary pos-btn-sm"
                            >
                              Remove Photo
                            </button>
                          )}
                          <button onClick={() => saveEdit(member)} disabled={savingEdit} className="pos-btn pos-btn-primary pos-btn-sm">
                            {savingEdit ? "Saving..." : "Save"}
                          </button>
                          <button onClick={cancelEdit} disabled={savingEdit} className="pos-btn pos-btn-secondary pos-btn-sm">
                            Cancel
                          </button>
                          {editError && <div className="pos-field-error">{editError}</div>}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <div style={{ fontWeight: 900, color: "#111827" }}>{member.name}</div>
                              <span className={`pos-badge ${isActive ? "pos-badge-green" : "pos-badge-red"}`}>
                                {isActive ? "Active" : "Left"}
                              </span>
                            </div>
                            {member.designation && <div style={{ color: "#0f766e", fontWeight: 800, fontSize: 13 }}>{member.designation}</div>}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              onClick={() => startEdit(member)}
                              disabled={isChangingStatus || deletingId === member.id}
                              className="pos-btn pos-btn-secondary pos-btn-sm"
                            >
                              Edit
                            </button>
                            {isActive ? (
                              isConfirmingLeft ? (
                                <>
                                  <button
                                    onClick={() => changeStaffStatus(member.id, false)}
                                    disabled={isChangingStatus}
                                    className="pos-btn pos-btn-secondary pos-btn-sm"
                                  >
                                    {isChangingStatus ? "Marking..." : "Confirm Left"}
                                  </button>
                                  <button
                                    onClick={() => setConfirmLeftId(null)}
                                    disabled={isChangingStatus}
                                    className="pos-btn pos-btn-secondary pos-btn-sm"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => {
                                    setConfirmLeftId(member.id);
                                    setConfirmDeleteId(null);
                                  }}
                                  disabled={isChangingStatus || deletingId === member.id}
                                  className="pos-btn pos-btn-secondary pos-btn-sm"
                                >
                                  Mark Left
                                </button>
                              )
                            ) : (
                              <button
                                onClick={() => changeStaffStatus(member.id, true)}
                                disabled={isChangingStatus || deletingId === member.id}
                                className="pos-btn pos-btn-primary pos-btn-sm"
                              >
                                {isChangingStatus ? "Restoring..." : "Restore"}
                              </button>
                            )}
                            {isConfirmingDelete ? (
                              <>
                                <button onClick={() => removeStaff(member.id)} disabled={deletingId === member.id} className="pos-btn pos-btn-danger pos-btn-sm">
                                  {deletingId === member.id ? "Deleting..." : "Confirm Delete"}
                                </button>
                                <button onClick={() => setConfirmDeleteId(null)} disabled={deletingId === member.id} className="pos-btn pos-btn-secondary pos-btn-sm">
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => {
                                  setConfirmDeleteId(member.id);
                                  setConfirmLeftId(null);
                                }}
                                disabled={isChangingStatus || deletingId === member.id}
                                className="pos-btn pos-btn-danger pos-btn-sm"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8, color: "#6b7280", fontSize: 13 }}>
                          <span>{member.phone}</span>
                          <span>Joined: {member.joiningDate || "Not set"}</span>
                          <span>Salary: {formatSalary(member.salary)}</span>
                          {member.address && <span>{member.address}</span>}
                          {member.notes && <span>{member.notes}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
