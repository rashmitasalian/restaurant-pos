# Authentication And Role-Based Access

Authentication is owned by the Electron main process. The renderer never stores password hashes and never verifies passwords directly.

## Current Model

- Users live in SQLite table `users`.
- New passwords are hashed with scrypt in `electron/services/credentials.ts`.
- Main-process sessions are random tokens kept in memory and bound to the renderer `webContents` id.
- Preload reads the session token from renderer localStorage and attaches it to protected IPC calls.
- Every protected IPC handler revalidates the session, active user, required role, and password-change state before calling `posService`.

## Roles

| Area | admin | cashier |
| --- | ---: | ---: |
| Tables, Billing, KOT Queue | yes | yes |
| Customers | yes | yes |
| Reports, History, Settings, Audit, Staff, Users | yes | no |

Print queue creation is available to authenticated users so cashier/KOT flows can queue failed prints. Print queue listing, retry, mark-completed, and cleanup are admin-only.

## Credential Rules

The app accepts only the current scrypt credential algorithm. Unsupported or missing hash algorithms fail closed. If a local development database contains older hashes, recreate the users or reset the database before using this build.
