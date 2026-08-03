# RestoNiti Restaurant POS - Comprehensive Product Overview

## Executive Summary

RestoNiti is a professional desktop Point-of-Sale (POS) system for single-location restaurants. It operates offline with complete local data storage, enabling restaurants to manage orders, billing, kitchen workflows, and operations without internet dependency. The system supports multiple order types (dine-in, takeaway, delivery), thermal kitchen printing, role-based staff access, comprehensive reporting, and administrative controls.

---

## PART 1: PRODUCT OVERVIEW

### What this application is

A full-featured Electron-based desktop POS application designed specifically for independent restaurants. The app runs locally on a Windows, macOS, or Linux terminal with complete data autonomy through SQLite. It is production-ready with support for professional thermal printing, secure multi-user access, invoice compliance, and audit trails.

**Target Use Case**: Single-location restaurants requiring complete operational control without cloud dependency or internet requirements.

### Core Architecture Philosophy

- **Offline-first**: All data lives on the restaurant's own machine. No cloud sync, no internet required.
- **Secure**: Renderer (UI) is sandboxed; all sensitive operations (database, printing, auth) run in a protected Electron main process.
- **Local authority**: SQLite database on the restaurant terminal is the single source of truth.
- **Thermal-print native**: Direct ESC/POS printing to kitchen and billing printers without OS print dialogs.

---

## PART 2: CORE TECHNOLOGY STACK

### Frontend (User Interface)

| Technology | Version | Purpose |
|---|---|---|
| React | 18.2.0 | Component-based UI framework for responsive, interactive screens |
| TypeScript | 5.9.3 | Type-safe JavaScript for catch errors at compile time |
| Vite | 8.0.0 | Lightning-fast development and optimized production builds |
| CSS Modules | Native | Scoped component styling without global conflicts |
| Inter Font | 5.2.8 | Professional sans-serif typeface via @fontsource |

**Why React 18?** Modern hooks, concurrent rendering, and a large ecosystem of components. Vite provides 5–10x faster HMR (hot module replacement) during development than webpack.

### Backend & Core Application

| Technology | Version | Purpose |
|---|---|---|
| Electron | 41.7.0 | Desktop app shell and native OS integration (printing, file dialogs, IPC) |
| TypeScript (Main Process) | 5.9.3 | Type-safe Electron main process and service layer |
| Node.js (via Electron) | 22.x | Runtime for Electron main process |
| better-sqlite3 | 12.10.0 | Synchronous SQLite driver for reliable local database in Electron |

**Why Electron?** Native desktop integration, multi-OS support (Windows/macOS/Linux), easy updater support, and isolated renderer process for security.

**Why better-sqlite3?** Synchronous database calls with high performance. No async overhead for a single-user local app. Compiled native C++ bindings for speed.

### Database & Persistence

| Technology | Purpose |
|---|---|
| SQLite | Local relational database. Schema: users, orders, items, payments, audit logs, settings. Accessed via better-sqlite3 in Electron main process only. |
| Database Storage | `<Electron userData>/data/restaurant-pos.sqlite` — typically `C:\Users\<User>\AppData\Local\RestoNiti\userData\data\restaurant-pos.sqlite` on Windows |
| WAL Journaling | Write-Ahead Logging for concurrent read/write safety |
| Foreign Keys | Enabled for referential integrity |
| Backup | SQLite database can be backed up as a single `.sqlite` file |

### Security & Communication

| Technology | Purpose |
|---|---|
| Electron IPC (Inter-Process Communication) | Secure message-passing between sandboxed renderer and native main process |
| Preload Bridge | Narrow API exposed to renderer via `window.pos` — only whitelisted methods allowed |
| Context Isolation | `contextIsolation: true` prevents renderer from accessing Electron/Node APIs directly |
| Scrypt | Industry-standard key derivation for password hashing (OWASP recommended) |
| Session Tokens | Random in-memory tokens bound to renderer webContents ID, never shared across sessions |

**Security Model**: Renderer cannot read files, access database, or call printers. All persistent and system operations go through validated IPC handlers in the main process.

### Build & Packaging

| Technology | Version | Purpose |
|---|---|---|
| Electron Builder | 26.8.1 | Packaging for Windows NSIS installer, macOS DMG, Linux AppImage |
| TypeScript Compiler | 5.9.3 | Compile main process from TypeScript to JavaScript |
| Vite Build | 8.0.0 | Bundle and optimize React renderer for production |
| Node Build Tools | MSVC/C++ | Visual Studio 2022 Build Tools required to rebuild native modules (better-sqlite3) for Electron |

### Testing & Code Quality

| Tool | Version | Purpose |
|---|---|---|
| Jest | 30.3.0 | Unit and integration test runner |
| ts-jest | 29.4.9 | TypeScript preprocessor for Jest |
| ESLint | 9.39.4 | Static code analysis for bugs and style issues |
| ESLint TypeScript Plugin | 8.59.0 | Type-aware linting rules |
| Prettier | 3.8.3 | Code formatter ensuring consistent style |

### Development & Scripting

| Package | Purpose |
|---|---|
| concurrently | Run multiple npm scripts in parallel (Electron main + React dev server) |
| cross-env | Set environment variables cross-platform (Windows/Mac/Linux) |
| rimraf | Cross-platform file/directory cleanup |
| ts-node | Run TypeScript without manual compilation |

---

## PART 3: DETAILED FEATURE BREAKDOWN

### 1. AUTHENTICATION & USER MANAGEMENT

#### Login System
- **Role-based access**: Two roles defined:
  - **Admin**: Full system access (users, settings, reports, audit, staff)
  - **Cashier**: Basic POS operations (tables, orders, billing, KOT, customers)
- **Password security**: 
  - Hashed with scrypt (OWASP Category A) in Electron main process
  - Never transmitted to renderer
  - Minimum requirements enforced (length, complexity)
- **Session handling**:
  - Main process maintains in-memory session tokens
  - Each token bound to renderer webContents ID (unique per window)
  - Token stored in renderer localStorage for reuse
  - Every IPC call revalidates: token, user, role, password change status
  - Automatic logout on app close (session cleared)

#### User Management (Admin only)
- Create, edit, delete users
- Assign roles (admin/cashier)
- Force password changes
- Admin recovery codes for account recovery
- Password visibility toggle during setup

#### Permission Enforcement (IPC Level)
Every IPC handler double-checks:
1. Valid session token
2. User exists and is active
3. User has required role
4. Not in password-change state

**Example**: `deleteUser()` IPC requires `admin` role; cashier calls are rejected at IPC boundary.

---

### 2. ORDER MANAGEMENT

#### Order Types Supported

**Table Orders (Dine-in)**
- Select table number from configured table list
- Add menu items with quantities
- Items tracked per line (item ID, quantity, price, special notes)
- KOT sent to kitchen in batches
- Discount applied at order level (percentage)
- Cash or card payment at counter

**Takeaway Orders**
- Named customer (name stored in order metadata)
- Items added same as table order
- No table association
- Customer mobile number optional (for recall)
- Packaged for pickup

**Delivery Orders**
- Platform metadata (Zomato, Swiggy, etc.)
- Order code/reference from delivery platform
- Rider assignment tracking
- Marked "ready" before rider pickup
- External aggregator handles payment (no in-POS billing)

#### Order Workflow

```
1. Create Order (Table/Takeaway/Delivery)
   └─ Assign items (add/remove/qty change)
       └─ Set discount (%)
           └─ Review totals (item subtotal, tax, discount, final total)
               └─ Send KOT to kitchen (mark items "pending" → "sent")
                   └─ Kitchen prints and marks complete
                       └─ Process payment (cash/card)
                           └─ Generate invoice & receipt
                               └─ Order marked "paid"
                                   └─ Historical record for reports
```

#### Line-Level KOT Tracking

- Each order line (menu item) has:
  - Base quantity ordered
  - `kot_printed_qty`: How much sent to kitchen
  - `kot_status`: pending/sent/printed/failed
- **Partial KOT**: If cashier increases pizza qty from 2→3 after KOT sent, only the delta (1) becomes pending
- **KOT Retry**: Failed print jobs queued; retry updates `kot_printed_qty` on success

---

### 3. KITCHEN ORDER TICKET (KOT) PRINTING

#### KOT Workflow
1. Cashier selects items awaiting kitchen
2. Clicks "Send to Kitchen"
3. App builds ESC/POS print buffer with:
   - Restaurant name
   - Order number and type (Table #X / Takeaway / Delivery)
   - Item names, quantities, special notes
   - Timestamp
   - Kitchen-specific formatting (bold, separators, cut command)
4. Sends to configured kitchen printer (IP or Windows printer name)
5. Status updated: `pending` → `sent`
6. If print fails, queued in `print_jobs` table for retry

#### Print Targets
- **Network Printer (TCP/IP)**: Sends raw ESC/POS bytes to printer IP on port 9100
- **Windows Printer (USB)**: Uses PowerShell/C# Winspool helper (`WritePrinter` API) with datatype `RAW`
- **Test Print**: Admin can send test message to verify printer connectivity

#### ESC/POS Line Directives
Print lines use structured commands (not plain text):
- `BIGBOLD:Order #123` → large, bold text
- `CENTER:Pad Thai x2` → centered item
- `LEFT:Special: extra spice` → left-aligned note
- `SEP` → separator line
- `BLANK` → empty line
- `CUT` → physical paper cut

---

### 4. BILLING & PAYMENTS

#### Billing Screen
- Real-time totals: item subtotal + applied discount + tax (GST if enabled)
- Quick-add favorites (top 10 items marked as favorite)
- Manual item search by name/category
- Quantity adjustment per item
- Discount entry (percentage-based)
- GST display (CGST/SGST if enabled)

#### Payment Processing
**Methods Supported**:
- Cash
- Card (store reference/txn ID)
- Partial payments (split payment across multiple methods)

**Payment Flow**:
1. Cashier reviews order total
2. Selects payment method
3. Enters amount received
4. System calculates change
5. Generates unique invoice number
6. Captures receipt timestamp
7. Marks order `paid`
8. Receipt printed to counter printer

**For Delivery Orders**:
- External aggregator (Zomato/Swiggy) handles payment
- POS order marked "ready" but not billed in-app
- No payment entry required

#### Invoice Generation
- Sequential invoice numbering per fiscal year
- Unique invoice ID persisted with payment
- Stores GST snapshot at time of payment for compliance
- Invoice includes:
  - Order number & type
  - Items with HSN/SAC if applicable
  - Subtotal, tax breakdown, total
  - Payment method, change given
  - GSTIN & restaurant details (if configured)

---

### 5. GST (GOODS & SERVICES TAX) COMPLIANCE

#### GST Configuration (Admin only)
- **Enable/disable** GST on all orders
- **GSTIN**: 15-character Goods & Services Tax Identification Number
- **Legal name**: Registered business name
- **Registered address**: For receipt printing
- **State code & name**: For HSN/SAC purposes
- **GST rate**: Configurable (percentage or basis points)
- **Price includes tax**: Whether menu prices are inclusive (important for CGST/SGST split)

#### Tax Calculations
- **If enabled**: Applies CGST (Central) + SGST (State) on taxable subtotal
- **Half-rate items**: Optional reduced-rate items (5% vs full rate)
- **Tax-on-discount**: Discount applied before tax calculation
- **Snapshot storage**: Order's GST config saved with payment for audit trail

#### Receipt Impact
When GST enabled, receipts include:
- CGST amount (Central)
- SGST amount (State)
- Total tax
- HSN codes (if stored on items)
- GSTIN on receipt header
- Registered address on receipt

---

### 6. CUSTOMER MANAGEMENT

#### Customer Records
- Store customer info: name, phone, email
- Link orders to customers
- Useful for takeaway/delivery to recall orders

#### Customer Functions
- Create new customer during order creation
- Search existing customers
- Link order to customer
- View customer order history

---

### 7. STAFF MANAGEMENT (Admin only)

#### Staff Records
- Employee name, phone, email
- Role/designation
- Hire date
- Status (active/inactive)
- Linked to created orders (audit trail: who took the order)

#### Purpose
- Track which staff member created/modified orders
- Assign KOT/delivery workflows
- Staff performance analytics

---

### 8. SETTINGS & CONFIGURATION

#### Printer Configuration (Admin only)
- **Counter printer**: For receipts (network IP or Windows printer name)
- **Kitchen printer**: For KOT (network IP or Windows printer name)
- **Port**: Custom TCP port (default 9100 for network printers)
- **Test print**: Verify connectivity before saving

#### Table Configuration (Admin only)
- Define table count & layout (e.g., Table 1–20)
- Tables used for dine-in orders only
- Can be reconfigured; new table counts auto-create missing tables

#### Order Categories (Admin only)
- Menu categories (Appetizers, Mains, Desserts, Beverages)
- Used for quick filtering during item selection

#### Menu Items (Admin only)
- Item name, price, category
- Available/unavailable toggle (hide sold-out items)
- Favorite flag (shows in quick-add section)
- Item-level notes/descriptions

#### Branding (Admin only)
- Restaurant name
- Phone number
- Email
- Displays on receipts and KOT

#### Invoice & Billing Settings (Admin only)
- Invoice prefix (e.g., "INV")
- Current invoice number (auto-incremented)
- Fiscal year start (for annual reset)

#### Audit Settings (Admin only)
- Audit log retention period
- Archive frequency
- Backup retention

---

### 9. REPORTS & ANALYTICS (Admin only)

#### Sales Summary Report
- **Date range**: Today, yesterday, this week, this month, or custom
- **Metrics shown**:
  - Total orders (count)
  - Total revenue (sum of paid order totals)
  - Average order value
  - Payment method breakdown (cash vs card)
  - Discount amount applied
  - Tax collected (if GST enabled)

#### Payment Breakdown
- Breakdown by payment method (cash, card, etc.)
- Count & amount per method
- Helps reconcile daily tills

#### Product Sales Report
- **Per-item analytics**:
  - Total quantity sold
  - Revenue per item
  - Ranking by popularity
  - Useful for menu optimization

#### Historical Orders View
- Browse all paid orders by date range
- Filter by order type (table/takeaway/delivery)
- Search by order number, customer name
- Re-print receipt from history
- Delete old orders (by admin)

---

### 10. AUDIT & COMPLIANCE

#### Audit Log
- Captures every significant action:
  - User login/logout
  - Order created/modified/paid/cancelled
  - Payment processed
  - KOT sent/failed/reprinted
  - Settings changed
  - User/staff deleted
  - Backup/restore
- **Fields logged**: Timestamp, user, action type, entity (order/user/setting), actor, details (payment amount, discount, etc.)

#### Audit Trail Retention
- Logs stored indefinitely in SQLite
- Admin can view audit logs filtered by:
  - Date range
  - Action type
  - User who performed action
  - Entity (order/user/setting)
- Logs archived periodically to maintain database performance

#### Compliance for GST/Tax
- Invoice snapshot on every payment (GST config at that moment)
- Audit log of all paid orders
- Receipt re-print available from history
- Data exportable for tax filing

---

### 11. BACKUP & DISASTER RECOVERY

#### Backup Creation (Admin only)
- One-click backup from Settings
- Saves SQLite database to date-stamped file
- Backup stored on restaurant machine (configurable path)
- Includes all orders, customers, users, settings, audit logs

#### Restore Process (Admin only)
1. Select backup file
2. Validate SQLite integrity
3. Create safety backup of current DB
4. Replace active database
5. Reinitialize app
6. Verify data integrity

**Use case**: Recover from accidental data loss, migrate to new terminal

#### Local Backup Storage
- Backups stored in Electron userData folder
- Can be manually copied to USB, network share, etc.
- Admin responsible for off-site backup strategy

---

### 12. PRODUCTION UPDATES

#### Update Mechanism
1. Admin visits Settings → About, clicks "Check for Updates"
2. App fetches update manifest from `POS_UPDATE_MANIFEST_URL` (system env var)
3. Manifest specifies:
   - Current version URL (installer .exe)
   - SHA256 hash for verification
   - Rollback URL (previous version)
   - Rollback hash
4. App verifies installer hash before download
5. Requires rollback installer cached before proceeding
6. Launches installer with admin privilege
7. On failure, user can click "Rollback" to restore previous version

#### Environment Configuration
Set once on restaurant machine (PowerShell as Admin):
```powershell
setx /M POS_UPDATE_MANIFEST_URL "https://updates.example.com/restaurant-pos/manifest.json"
```

#### Version Management
- Semantic versioning (major.minor.patch)
- Current: 0.3.0
- Installer named: `RestoNiti Setup 0.3.0.exe`

---

## PART 4: DATABASE SCHEMA OVERVIEW

### Core Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `users` | POS system users (admins, cashiers) | id, username, password_hash (scrypt), role, active |
| `sessions` | Active user sessions (in-memory) | token, user_id, webContents_id, createdAt |
| `orders` | Customer orders | id, orderType, tableId, status, total, discount, paid_at, invoice_number |
| `order_lines` | Items in each order | id, order_id, item_id, quantity, price, kot_printed_qty, kot_status |
| `menu_items` | Menu catalog | id, name, price, category_id, available, favorite |
| `menu_categories` | Item categories | id, name |
| `customers` | Customer records | id, name, phone, email |
| `staff` | Employee records | id, name, phone, role, hire_date, active |
| `payments` | Payment records (separate from orders) | id, order_id, method, amount_paise, received_at, txn_ref |
| `settings` | Key-value config (GST, printers, tables, etc.) | key, value_json, updatedAt |
| `audit_logs` | Action history | id, timestamp, user_id, action, entity_type, entity_id, details_json |
| `print_jobs` | Failed print queue (for retry) | id, order_id, printer, status, error_msg, createdAt |
| `backup_records` | Backup history | id, filename, size, createdAt, restoredAt |

**Note**: All currency stored as paise (100 paise = 1 rupee) to avoid floating-point errors.

---

## PART 5: SECURITY ARCHITECTURE

### Defense in Depth

1. **Renderer Sandboxing**
   - `contextIsolation: true` — separate context from Node.js
   - `nodeIntegration: false` — no `require()` in renderer
   - `sandbox: true` — OS-level process isolation
   - No direct file access, database, or printer APIs

2. **IPC Boundary Enforcement**
   - Preload whitelists only safe APIs
   - IPC handlers validate every call: token → user → role → action
   - No raw SQL passed from renderer
   - All data serialized/deserialized for safety

3. **Authentication**
   - Scrypt hashing (OWASP-recommended, slow iteration)
   - Session tokens tied to webContents ID
   - No password stored in renderer
   - Logout on app exit

4. **Data Integrity**
   - SQLite foreign keys enabled
   - Transactions for multi-step operations
   - Audit log immutable after creation

5. **Update Security**
   - SHA256 hash verification of installers
   - HTTPS manifest fetch
   - Rollback installer cached before update

---

## PART 6: USER INTERFACE SCREENS

### Login & Auth Screens
1. **Login**: Username + password for admin/cashier
2. **Password change**: Forced on first login
3. **Recovery**: Admin recovery codes for lost passwords

### Cashier Workflows
1. **Billing Screen** (primary): Table/takeaway selection, item add, KOT, payment
2. **Table Management**: Assign/release tables, view active tables
3. **KOT Queue**: View pending KOT, mark kitchen complete
4. **Customers**: Create/search customers for link to orders

### Admin Workflows
1. **Reports**: Sales summary, payment breakdown, product sales
2. **History**: Browse/re-print/delete paid orders
3. **Settings**: 
   - Printers
   - Tables
   - Menu items & categories
   - GST configuration
   - Branding
   - Invoice settings
   - Audit settings
4. **Users**: Create/edit/delete system users, assign roles
5. **Staff**: Manage employee records
6. **Audit**: View audit logs
7. **Backup**: Create/restore backups
8. **About**: Version, update check, reset

---

## PART 7: BUILD & DEPLOYMENT

### Development Environment
```powershell
npm install                 # Install dependencies
npm run start              # Start renderer + Electron in dev mode
npm run lint              # Check code quality
npm test                  # Run Jest tests
npm run build:renderer    # Build React only (Vite)
npm run build:electron    # Build Electron main + native modules
npm run build             # Full clean build
```

### Production Deployment
1. **Build machine**: Windows with Node.js 22.x, Visual Studio 2022 Build Tools (C++)
2. **Build**: `npm run build` → `release/RestoNiti Setup 0.3.0.exe`
3. **Update manifest**: Publish `.exe` and manifest.json to HTTPS server
4. **Install on restaurant machine**: Run `.exe` installer
5. **Configure**: Set `POS_UPDATE_MANIFEST_URL` environment variable
6. **Update**: Admin triggers from Settings; app auto-downloads and installs

---

## PART 8: BUSINESS VALUE & DIFFERENTIATION

### Key Strengths
1. **Offline-first**: No internet required; restaurant controls all data
2. **Single-point authority**: One SQLite database; no cloud sync conflicts
3. **Thermal print native**: Direct ESC/POS without OS dialogs
4. **Role-based security**: Audit trails, admin controls, password hashing
5. **GST-ready**: Full tax compliance for Indian restaurants
6. **Production-ready**: Update mechanism, backup/restore, audit logs
7. **Full feature set**: Tables, takeaway, delivery, reporting, staff management

### What's NOT Included (Phase 2+)
- Multi-branch support
- Online ordering API
- Inventory management
- Waiter app / remote dashboard
- Cloud sync
- POS API for third-party integrations

---

## PART 9: ROADMAP & FUTURE CONSIDERATIONS

### Immediate Readiness
✅ Single-location restaurant operations  
✅ Cash & card payments  
✅ Kitchen printing  
✅ GST invoicing  
✅ Audit & compliance  

### Phase 2 Considerations
- Multi-branch sync with local authority
- Waiter app & table management features
- Delivery integration API
- Owner dashboard (read-only remote reports)
- Inventory tracking & stock alerts

---

## PART 10: SUPPORT & OPERATIONS

### Production Runbooks
- `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md` — Fresh setup on restaurant terminal
- `docs/PRODUCTION_UPDATE_RUNBOOK.md` — Deploy updates, rollback
- `docs/PRODUCTION_READINESS.md` — Pre-launch checklist

### Troubleshooting
- Printer connectivity: Settings → Test Print
- Update failures: Rollback to previous version from About screen
- Database corruption: Restore from backup
- Performance: Archive old audit logs

### Contact & Support
For deployment, updates, or custom feature requirements, refer to project maintainers.

## What the app does

### Operational capabilities

- Role-based login with separate `admin` and `cashier` access levels.
- Local user authentication with securely hashed passwords.
- Session management in the Electron main process.
- Offline-first operation using a local SQLite database stored in Electron `userData`.

### Order management

- Table orders for dine-in service.
- Takeaway orders.
- Delivery order support.
- Kitchen Order Ticket (KOT) workflow with pending/sent/printed/failed status tracking.
- Line-level quantity tracking for partial or incremental KOT printing.
- Order payments stored separately from orders.
- Invoice generation and GST-aware totals.

### Printing

- ESC/POS thermal print support.
- Printing over network IP/port.
- Windows printer RAW print support via Winspool.
- Main-process printing logic that sends raw printer bytes instead of renderer-side print calls.

### Administration and reporting

- Admin-only reports and audit logs.
- Staff and customer management.
- Settings and configuration persistence.
- Local backup and restore of the SQLite database.
- Production update support through an HTTPS manifest and installer verification.

### Security and architecture

- Renderer is sandboxed with `contextIsolation: true` and `nodeIntegration: false`.
- Renderer code accesses persistence and OS features only through a narrow `window.pos` API.
- Main process owns database, printing, backup, restore, and auth operations.
- IPC handlers enforce role-based access for protected actions.

## Application structure

### Key directories and files

- `electron/`: Electron main process and native integration logic.
  - `main.ts`: application bootstrap, windows, security, and IPC wiring.
  - `env.ts`: `.env` loader for Electron runtime configuration.
  - `db/sqlite.ts`: SQLite initialization, schema, migrations, and backup logic.
  - `ipc/posIpc.ts`: IPC contract definitions and protected handler logic.
  - `services/`: business services for authentication, sessions, POS operations, printing, and updates.
  - `preload.ts` / `preload.js`: secure renderer bridge.

- `src/`: renderer application code.
  - `main.tsx`: React application entry point.
  - `app/`: application screens, auth gate, and renderer state.
  - `shared/`: shared data types and DTOs used by both renderer and Electron.

- `docs/`: operational runbooks and documentation for installation, updates, and production deployment.
- `release/`: packaged installer outputs and Electron Builder artifacts.

## Build and run commands

- `npm install`
- `npm run start` — starts the renderer and Electron app in development.
- `npm run build:renderer` — builds the React/Vite renderer.
- `npm run build:electron` — builds the Electron main process and packages the app.
- `npm run build` — cleans and builds both renderer and Electron packages.
- `npm test` — runs Jest test suite.

## Business value

This application is ready for use as a single-location restaurant POS with essential workflows already implemented.

Key business advantages:

- Offline-capable and self-hosted on the restaurant terminal.
- Secure separation between UI and system logic.
- Local printing support for kitchen and billing workflows.
- Admin visibility into orders, payments, audit history, and application settings.
- Local backup/restore and production update support for safe operations.

## Notes for future discussions

- The current product is focused on single-location deployment.
- Multi-branch, online ordering APIs, inventory sync, and remote dashboards are not in scope today.
- Phase 2 growth is natural from this foundation: local POS remains the authority while adding sync, remote reporting, and multi-device order routing.
