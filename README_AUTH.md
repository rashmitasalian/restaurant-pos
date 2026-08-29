# Authentication And Role-Based Access

Authentication is owned by the Electron main process. The renderer never stores password hashes and never verifies passwords directly.

## Current Model

- Users live in SQLite table `users`.
- New passwords are hashed with scrypt in `electron/services/credentials.ts`.
- Main-process sessions are random tokens kept in memory and bound to the renderer `webContents` id.
- Preload reads the session token from renderer localStorage and attaches it to protected IPC calls.
- Every protected IPC handler revalidates the session, active user, required permission, and password-change state before calling `posService`.

## Roles

Roles are bundles of permissions defined in [`src/shared/permissions.ts`](src/shared/permissions.ts). Navigation, Manage sections, Jump (Ctrl+K), and IPC all derive from the same permission map.

| Area | admin | manager | cashier |
| --- | ---: | ---: | ---: |
| Tables, Billing, KOT Queue | yes | yes | yes |
| Customers | yes | yes | yes |
| Manage: Overview, Grocery, Expenses, Menu | yes | yes | no |
| People: Attendance, Roster, Salary Advances | yes | yes | no |
| People: Accounts | yes | no | no |
| Reports, History | yes | no | no |
| Audit, Settings | yes | no | no |

### Manager

Runs the restaurant when the owner is away: floor POS plus grocery, expenses, menu, attendance, roster, and salary advances. Cannot access accounts, reports, history, audit, or settings.

### Cashier

Counter POS only: tables, billing, customers, KOT queue.

### Waiter / Captain (future)

Not a desktop login role. Planned for Phase 2+ tablet app with narrower order/KOT permissions than Cashier.

Print queue creation is available to authenticated users so cashier/KOT flows can queue failed prints. Print queue listing, retry, mark-completed, and cleanup require `system:settings` (admin only).

## Credential Rules

The app accepts only the current scrypt credential algorithm. Unsupported or missing hash algorithms fail closed. If a local development database contains older hashes, recreate the users or reset the database before using this build.
