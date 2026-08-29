import React from "react";
import {
  createUser,
  listUsers,
  setUserPassword,
  updateUser,
  UserDoc,
} from "../../../app/db/posRepository";
import { PasswordValidator } from "../../../app/utils/validators";
import { DEFAULT_ROLE, PAGE_LABELS, ROLE_KEYS, ROLES } from "../../../config/roles";
import type { Role } from "../../../config/roles";
import { roleHasPermission } from "../../../shared/permissions";
import { isValidPersonName, normalizeText } from "../../../shared/validation";
import { AuthContext } from "../../context/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import styles from "./Users.module.css";

function avatarInitials(doc: UserDoc): string {
  const displayName = doc.displayName || doc.username;
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
}

function accessiblePageLabels(role: Role): string {
  return ROLES[role].pages.map((key) => PAGE_LABELS[key] ?? key).join(", ");
}

function adminMutationError(message: string) {
  const known: Record<string, string> = {
    "admin-verification-required": "Enter your current admin password.",
    "admin-verification-failed": "Admin password verification failed.",
    "cannot-change-last-active-admin": "You cannot disable or demote the last active admin.",
    "user-not-found": "User was not found.",
    "username-taken": "That username is already taken.",
    "invalid-username": "Username must be 2-32 lowercase letters, digits, hyphens or underscores.",
    "display-name-invalid": "Display name must include a letter.",
  };
  return known[message] ?? "";
}

function userListErrorMessage(message: string) {
  if (message.includes("auth-required") || message.includes("password-change-required")) {
    return "Your session expired. Please sign in again.";
  }
  if (message.includes("forbidden")) {
    return "Only admins can manage users.";
  }
  return "Could not load users. Please try again.";
}

export default function UsersScreen({
  embedded = false,
  registerAddUser,
}: {
  embedded?: boolean;
  registerAddUser?: (open: () => void) => void;
}) {
  const auth = React.useContext(AuthContext);
  const [users, setUsers] = React.useState<UserDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [resetTarget, setResetTarget] = React.useState<UserDoc | null>(null);
  const [toggleTarget, setToggleTarget] = React.useState<UserDoc | null>(null);

  const load = React.useCallback(async () => {
    if (auth?.loading) {
      setLoading(true);
      return;
    }

    if (!auth?.session) {
      setUsers([]);
      setError("Please sign in as an admin to manage users.");
      setLoading(false);
      return;
    }

    if (!auth.session || !roleHasPermission(auth.session.role, "people:accounts")) {
      setUsers([]);
      setError("Only admins can manage users.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const list = await listUsers();
      list.sort((a, b) => {
        if (a.username === auth?.session?.username) {
          return -1;
        }
        if (b.username === auth?.session?.username) {
          return 1;
        }
        if (a.role !== b.role) {
          return a.role === "admin" ? -1 : 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });
      setUsers(list);
    } catch (err: any) {
      const message = err?.message || "";
      setUsers([]);
      setError(userListErrorMessage(message));
      if (message.includes("auth-required") || message.includes("password-change-required")) {
        auth.logout();
      }
    } finally {
      setLoading(false);
    }
  }, [auth]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    registerAddUser?.(() => setShowCreate(true));
  }, [registerAddUser]);

  const isSelf = (user: UserDoc) => user.username === auth?.session?.username;

  return (
    <div className={styles.container}>
      {!embedded && (
        <PageHeader
          title="Accounts"
          subtitle="Create and manage RestoNiti login accounts and access permissions. Sensitive actions require your admin password."
          actions={
            <Button
              variant="primary"
              onClick={() => setShowCreate(true)}
              disabled={!auth?.session?.role || !roleHasPermission(auth.session.role, "people:accounts")}
            >
              Add User
            </Button>
          }
        />
      )}

      {embedded && (
        <p style={{ margin: "0 0 16px", color: "var(--pos-tx-sub)", fontSize: 13 }}>
          Create and manage RestoNiti login accounts and access permissions.
        </p>
      )}

      {error && <div className={styles.formError}>{error}</div>}

      {loading ? (
        <div className={styles.emptyState}>Loading users...</div>
      ) : users.length === 0 ? (
        <div className={styles.emptyState}>No users found.</div>
      ) : (
        <div className={styles.userList}>
          {users.map((user) => (
            <div
              key={user.username}
              className={`${styles.userCard} ${user.active === false ? styles.inactive : ""}`}
            >
              <div className={styles.avatar}>{avatarInitials(user)}</div>

              <div className={styles.userInfo}>
                <div className={styles.displayName}>
                  {user.displayName}
                  {isSelf(user) && <span className={styles.selfNote}>(you)</span>}
                </div>
                <div className={styles.usernameTxt}>@{user.username}</div>
                {user.linkedStaffName || user.staffId ? (
                  <div style={{ marginTop: 4, fontSize: 11, color: "var(--pos-tx-muted)" }}>
                    Linked staff: {user.linkedStaffName || user.staffId}
                  </div>
                ) : null}
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--pos-tx-muted)" }}>
                  Access: {accessiblePageLabels(user.role)}
                </div>
              </div>

              <span className={`${styles.roleBadge} ${styles[ROLES[user.role].badgeClass]}`}>
                {ROLES[user.role].label}
              </span>

              <span
                className={`${styles.statusBadge} ${
                  user.active !== false ? styles.active : styles.inactive
                }`}
              >
                {user.active !== false ? "Active" : "Disabled"}
              </span>

              <div className={styles.cardActions}>
                <Button size="sm" variant="secondary" onClick={() => setResetTarget(user)} title="Reset password">
                  Reset password
                </Button>

                {!isSelf(user) && (
                  <Button
                    size="sm"
                    variant={user.active !== false ? "danger" : "secondary"}
                    onClick={() => setToggleTarget(user)}
                    title={user.active !== false ? "Disable account" : "Enable account"}
                  >
                    {user.active !== false ? "Disable" : "Enable"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}

      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={() => {
            setResetTarget(null);
            void load();
          }}
        />
      )}

      {toggleTarget && (
        <ConfirmStatusModal
          user={toggleTarget}
          onClose={() => setToggleTarget(null)}
          onDone={() => {
            setToggleTarget(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const auth = React.useContext(AuthContext);
  const [username, setUsername] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [role, setRole] = React.useState<Role>(DEFAULT_ROLE);
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [adminPassword, setAdminPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const uname = username.trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(uname)) {
      setError("Username must be 2-32 lowercase letters, digits, hyphens or underscores.");
      return;
    }
    const display = normalizeText(displayName);
    if (!display) {
      setError("Display name is required.");
      return;
    }
    if (!isValidPersonName(display)) {
      setError("Display name must include a letter.");
      return;
    }

    const passwordValidation = PasswordValidator.validate(password);
    if (!passwordValidation.ok) {
      setError(passwordValidation.errors[0] || "Password does not meet requirements.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!auth?.session?.username || !adminPassword) {
      setError("Enter your current admin password to authorize this change.");
      return;
    }

    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await createUser(
        uname,
        password,
        role,
        display,
        true,
        auth.session.username,
        adminPassword,
      );
      onCreated();
    } catch (err: any) {
      const message = err?.message || "";
      setError(adminMutationError(message) || message || "Failed to create user. Please try again.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open title="Create new user" onClose={isSubmitting ? () => undefined : onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label="Username" htmlFor="create-username">
          <input
            id="create-username"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
            autoFocus
            placeholder="e.g. john_doe"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Display name" htmlFor="create-displayname">
          <input
            id="create-displayname"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="off"
            placeholder="e.g. John Doe"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Role" htmlFor="create-role">
          <select
            id="create-role"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            disabled={isSubmitting}
          >
            {ROLE_KEYS.map((roleKey) => (
              <option key={roleKey} value={roleKey}>
                {ROLES[roleKey].label} - {accessiblePageLabels(roleKey)}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Password" htmlFor="create-password">
          <input
            id="create-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Minimum 8 characters"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Confirm password" htmlFor="create-confirm">
          <input
            id="create-confirm"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Repeat password"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Your admin password" htmlFor="create-admin-password">
          <input
            id="create-admin-password"
            type="password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Required to create users"
            disabled={isSubmitting}
          />
        </FormField>

        {error && <div className={styles.formError}>{error}</div>}

        <ModalActions onClose={onClose} primaryLabel={isSubmitting ? "Creating..." : "Create user"} disabled={isSubmitting} />
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: UserDoc;
  onClose: () => void;
  onDone: () => void;
}) {
  const auth = React.useContext(AuthContext);
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [adminPassword, setAdminPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const passwordValidation = PasswordValidator.validate(password);
    if (!passwordValidation.ok) {
      setError(passwordValidation.errors[0] || "Password does not meet requirements.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!auth?.session?.username || !adminPassword) {
      setError("Enter your current admin password to authorize this reset.");
      return;
    }

    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await setUserPassword(user.username, password, auth.session.username, adminPassword);
      setSuccess(true);
      setTimeout(onDone, 1200);
    } catch (err: any) {
      const message = err?.message || "";
      setError(adminMutationError(message) || message || "Failed to reset password. Please try again.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open title={`Reset password for @${user.username}`} onClose={isSubmitting ? () => undefined : onClose}>
      {success ? (
        <div className={styles.formSuccess}>
          Password updated successfully. The user will need to log in with the new password.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <FormField label="New password" htmlFor="reset-password">
            <input
              id="reset-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              autoFocus
              placeholder="Minimum 8 characters"
              disabled={isSubmitting}
            />
          </FormField>

          <FormField label="Confirm password" htmlFor="reset-confirm">
            <input
              id="reset-confirm"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="Repeat new password"
              disabled={isSubmitting}
            />
          </FormField>

          <FormField label="Your admin password" htmlFor="reset-admin-password">
            <input
              id="reset-admin-password"
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Required to reset passwords"
              disabled={isSubmitting}
            />
          </FormField>

          {error && <div className={styles.formError}>{error}</div>}

          <ModalActions onClose={onClose} primaryLabel={isSubmitting ? "Saving..." : "Reset password"} disabled={isSubmitting} />
        </form>
      )}
    </Modal>
  );
}

function ConfirmStatusModal({
  user,
  onClose,
  onDone,
}: {
  user: UserDoc;
  onClose: () => void;
  onDone: () => void;
}) {
  const auth = React.useContext(AuthContext);
  const [adminPassword, setAdminPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const nextActive = user.active === false;
  const action = nextActive ? "enable" : "disable";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!auth?.session?.username || !adminPassword) {
      setError("Enter your current admin password to authorize this change.");
      return;
    }

    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await updateUser(user.username, { active: nextActive }, auth.session.username, adminPassword);
      onDone();
    } catch (err: any) {
      const message = err?.message || "";
      setError(adminMutationError(message) || message || `Failed to ${action} this user.`);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open title={`${nextActive ? "Enable" : "Disable"} @${user.username}?`} onClose={isSubmitting ? () => undefined : onClose}>
      <form onSubmit={handleSubmit}>
        <p style={{ margin: "0 0 16px", color: "var(--pos-tx-sub)", fontSize: 13, lineHeight: 1.5 }}>
          This will {action} the account for {user.displayName}. Admin verification is required.
        </p>

        <FormField label="Your admin password" htmlFor="status-admin-password">
          <input
            id="status-admin-password"
            type="password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            placeholder="Required to change account status"
            disabled={isSubmitting}
          />
        </FormField>

        {error && <div className={styles.formError}>{error}</div>}

        <ModalActions
          onClose={onClose}
          primaryLabel={isSubmitting ? "Saving..." : nextActive ? "Enable account" : "Disable account"}
          disabled={isSubmitting}
          danger={!nextActive}
        />
      </form>
    </Modal>
  );
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.formField}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function ModalActions({
  onClose,
  primaryLabel,
  disabled,
  danger = false,
}: {
  onClose: () => void;
  primaryLabel: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className={styles.modalActions}>
      <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={disabled}>
        Cancel
      </Button>
      <Button
        type="submit"
        size="sm"
        variant={danger ? "danger" : "primary"}
        disabled={disabled}
      >
        {primaryLabel}
      </Button>
    </div>
  );
}
