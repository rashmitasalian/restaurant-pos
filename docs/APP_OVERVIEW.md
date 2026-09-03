# RestoNiti Restaurant POS - Comprehensive Product Overview

## Executive Summary

RestoNiti is a professional desktop Point-of-Sale (POS) and operations platform for single-location restaurants. It operates offline with complete local data storage, enabling restaurants to run the floor (tables, billing, KOT), manage back-office work (grocery procurement, expenses, profitability), and handle people operations (staff roster, attendance, salary advances) without internet dependency. The system supports configurable service modes (dine-in, takeaway, delivery, self-service), thermal kitchen printing, permission-based staff access, comprehensive reporting, and administrative controls.

---

## PART 1: PRODUCT OVERVIEW

### What this application is

A full-featured Electron-based desktop application designed specifically for independent restaurants. The app runs locally on a Windows, macOS, or Linux terminal with complete data autonomy through SQLite. Beyond core POS workflows, it includes a **Manage** workspace for grocery buying lists and purchases, operating expenses, menu editing, people management, reports, order history, audit logs, and system settings.

**Target Use Case**: Single-location restaurants requiring complete operational control — floor service, kitchen printing, procurement, people ops, and financial visibility — without cloud dependency or internet requirements.

### Core Architecture Philosophy

- **Offline-first**: All data lives on the restaurant's own machine. No cloud sync, no internet required.
- **Secure**: Renderer (UI) is sandboxed; all sensitive operations (database, printing, auth) run in a protected Electron main process.
- **Local authority**: SQLite database on the restaurant terminal is the single source of truth.
- **Thermal-print native**: Direct ESC/POS printing to kitchen and billing printers without OS print dialogs.
- **Lazy-loaded UI**: Screen chunks load on demand with skeleton fallbacks; post-login prefetch reduces cold-start delay.

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
| lucide-react | 1.28.x | Consistent icon set across all screens |
| xlsx | 0.18.x | Excel export for attendance history and salary advances |

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
- **Permission-based roles**: Three desktop login roles (defined in `src/shared/permissions.ts`):
  - **Admin**: Full access — all floor pages and every Manage section (Overview, Grocery, Expenses, Menu, People, Reports, History, Audit, Settings)
  - **Manager**: Floor + operational Manage — tables, billing, KOT, customers, Overview, Grocery, Expenses, Menu, and People tabs (Attendance, Roster, Salary Advances); no Accounts, Reports, History, Audit, or Settings
  - **Cashier**: Floor POS only — tables, billing, KOT queue, customers
- **First-run setup**: When no users exist, a setup wizard creates the first admin account and displays one-time recovery codes
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

#### User Management (Admin only — Manage → People → Accounts)
- Create, edit, deactivate users
- Assign roles (admin / manager / cashier)
- Force password changes on next login
- Admin recovery codes for account recovery (regenerate from Settings)
- Link staff roster records to POS login accounts

#### Permission Enforcement (IPC Level)
Every IPC handler double-checks:
1. Valid session token
2. User exists and is active
3. User has required role
4. Not in password-change state

**Example**: `deleteUser()` IPC requires `admin` role; cashier calls are rejected at IPC boundary.

---

### 2. ORDER MANAGEMENT

#### Configurable Service Modes

Order types are driven by **service modes** (Settings → Operations). Each mode controls table requirement, customer requirement, KOT support, immediate billing, external payment, merge behaviour, and print sequence.

Built-in modes (enable/disable individually):

| Mode | Typical use | Notes |
|---|---|---|
| **Dine In** | Table service | Requires table; supports open orders and KOT |
| **Self Service** | Counter / quick service | Immediate billing; optional KOT-after-bill print sequence |
| **Takeaway** | Pickup orders | Named customer optional; no table |
| **Delivery** | Aggregator / own delivery | Customer required; external payment (no in-POS billing) |

When table-based modes are disabled, the **Tables** nav item is hidden automatically.

#### Order Types Supported

**Table Orders (Dine-in)**
- Select table from seating areas and table layout
- Add menu items with quantities and optional variants
- Items tracked per line (item ID, quantity, price, special notes)
- KOT sent to kitchen in batches
- Discount applied at order level (percentage)
- Cash, card, UPI, or other payment at counter

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

**Self Service**
- Fast counter flow with immediate billing
- Configurable bill-then-KOT or KOT-then-bill print sequence

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
- Card (store reference / txn ID)
- UPI
- Online
- Other
- Partial payments (split payment across multiple methods)

**Payment Flow**:
1. Cashier reviews order total
2. Selects payment method(s)
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
- Search existing customers (virtualized list for large datasets)
- Link order to customer
- View customer order history
- Edit customer details from Customers page

---

### 7. STAFF & PEOPLE MANAGEMENT

Staff roster and HR-style workflows live under **Manage → People** (permission-gated by tab).

#### Staff Roster (Manage → People → Roster)
- Employee name, phone, photo, designation, hire date
- Weekly off days and default shift assignment
- Salary / wage fields for reference
- Status: active or left
- Create linked POS login account from staff record (Admin)
- Deep links to attendance and salary advances per employee

#### Attendance (Manage → People → Attendance)
- **Daily tab**: Mark attendance by date for all active staff
  - Status: present, absent, half-day, leave, holiday
  - Shift assignment (morning / evening / night — configurable in Settings)
  - Late flag, overtime minutes, remarks
  - Bulk actions: mark all present / absent
  - Copy previous day's attendance
  - Respects weekly off and configured public holidays
  - Keyboard shortcuts for fast data entry
- **History tab**: Review attendance over week / month / custom range; export to Excel

#### Salary Advances (Manage → People → Salary Advances)
- Record cash advances against staff
- Summary view by employee and period (week / month / custom)
- Transaction ledger with void support
- Export to Excel

#### Accounts (Manage → People → Accounts — Admin only)
- POS user accounts (see Authentication section)
- Role assignment and password management

---

### 8. SETTINGS & CONFIGURATION

Settings are organized under **Manage → Settings** with four tabs:

#### Identity
- **Business identity**: Restaurant name, tagline, phone, email, logo (processed for receipt raster printing)
- **GST registration**: Enable/disable GST, GSTIN, legal name, address, state, rate, price-includes-tax toggle
- **Invoice numbering**: Prefix and current invoice number
- **Admin recovery codes**: Regenerate one-time recovery codes (requires admin password)

#### Hardware
- **Counter printer**: Receipt printer (network IP or Windows printer name)
- **Kitchen printer**: KOT printer (network IP or Windows printer name)
- **Port**: Custom TCP port (default 9100 for network printers)
- **Test print**: Verify connectivity before saving
- **Print job queue**: View failed jobs, retry individual jobs, clear old jobs

#### Operations
- **Service modes**: Enable/disable and configure dine-in, self-service, takeaway, delivery
- **Seating areas & tables**: Multi-area floor plan; drag-reorder areas; per-table seat count and area assignment
- **Menu categories**: Appetizers, mains, etc. — used for billing filters
- **Menu variant options**: Shared variant groups (e.g. size) for menu items
- **Attendance shifts**: Morning / evening / night labels and standard hours
- **Attendance holidays**: Date list for scheduled off days

#### Retention
- **Audit log retention**: Auto-prune logs older than N days (or never)
- **Order history retention**: Auto-prune paid orders older than N days (or never)
- **Backup & restore**: Create SQLite backup, list backups, restore with safety copy
- **About & updates**: App version, check for updates, prepare/launch installer, rollback, export diagnostics

#### Menu (Manage → Menu — separate from Settings)
- Item name, base price, category, availability toggle, favorite flag
- **Item variants**: Multiple sizes/options per item with individual prices (e.g. Small / Large)
- Bulk category management

#### Table Configuration
- Table count grows automatically when seating areas are configured
- Tables used for dine-in / table-required service modes only

---

### 9. REPORTS & ANALYTICS (Admin only)

Reports are available from the top nav (**Reports**) or **Manage → Reports**. Two tabs:

#### Sales Report
- **Date range**: Business-day presets (today, yesterday, this week, this month) or custom range
- **Metrics shown**:
  - Total orders (count)
  - Total revenue (sum of paid order totals)
  - Subtotal, discount total, GST collected
  - Average order value
  - Payment method breakdown (cash, UPI, card, online, other)
- **Product sales**: Category and item breakdown with charts; sortable item table with search and pagination
- **Export**: Print-friendly HTML export of sales summary

#### Profitability Report
- Revenue vs grocery purchases (food cost proxy) for the selected period
- Operating expenses by category (from Expenses module)
- Gross contribution, estimated operating profit, operating margin %
- Disclaimer that figures are estimates based on recorded purchases and expenses

#### Historical Orders View (Manage → History)
- Browse all paid orders by business date range
- Filter by service mode / order type
- Search by order number, customer name
- Re-print receipt from history
- Bulk delete selected orders or purge entire history range (admin)

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
- Logs stored in SQLite with optional auto-prune (Settings → Retention)
- Admin can view audit logs filtered by:
  - Date range
  - Full-text search (FTS5 index for fast search at scale)
  - Action type
  - User who performed action
- Paginated viewer (Manage → Audit) with export support
- Pruned logs archived to `audit_archives`

#### Compliance for GST/Tax
- Invoice snapshot on every payment (GST config at that moment)
- Audit log of all paid orders
- Receipt re-print available from history
- Data exportable for tax filing

---

### 11. GROCERY & PROCUREMENT (Admin / Manager)

Manage → Grocery covers back-of-house purchasing workflows.

#### Buying Lists
- Create dated buying lists (draft → open → partial → completed / cancelled)
- Line items with grocery item, quantity, unit, estimated cost
- Per-line status: pending, purchased, skipped
- List templates for recurring shopping lists
- Print buying list for market runs
- Link purchases back to list lines

#### Purchases
- Record purchase against a list line or as a whole-list total
- Vendor, date, amount, payment method (cash / UPI / card / online / other)
- Purchase history with filters

#### Vendors
- Vendor directory (name, contact, notes)
- Used when recording purchases

#### Grocery Items
- Master catalog of procurement items (name, category, default unit)
- Templates built from grocery items for quick list creation

#### Manage Overview
- Dashboard highlights buying lists needing attention and today's planned spend

---

### 12. EXPENSES (Admin / Manager)

Manage → Expenses tracks operating costs outside of grocery purchases.

- Expense categories (system defaults + custom)
- Record expense: category, amount, date, description, payment method
- Void expenses (soft delete with audit trail)
- Range filters: this month, last month, custom
- Summary stats for the selected period
- Feeds into **Profitability** report as operating expenses

---

### 13. BACKUP & DISASTER RECOVERY

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

### 14. PRODUCTION UPDATES

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
- Current: **0.4.0**
- Installer named: `RestoNiti Setup 0.4.0.exe`

---

## PART 4: DATABASE SCHEMA OVERVIEW

### Core Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `users` | POS system users (admins, managers, cashiers) | id, username, password_hash (scrypt), role, active, display_name |
| `admin_recovery_codes` | One-time admin recovery codes | code_hash, used_at |
| `seating_areas` | Floor sections (e.g. AC, Garden) | id, name, sort_order |
| `tables` | Dine-in tables | id, number, area_id, seats, status |
| `menu_categories` | Item categories | id, name, sort_order |
| `menu_items` | Menu catalog | id, name, price, category_id, available, favorite |
| `menu_item_variants` | Size/option variants per menu item | id, item_id, name, price_paise, sort_order |
| `customers` | Customer records | id, name, phone, email |
| `staff` | Employee roster | id, name, phone, role, hire_date, active, weekly_off, photo |
| `attendance_records` | Daily attendance per staff | staff_id, date, status, shift_id, is_late, overtime_minutes, remarks |
| `salary_advances` | Staff salary advances | staff_id, amount_paise, advance_date, voided_at |
| `orders` | Customer orders | id, orderType, tableId, status, total, discount, paid_at, invoice_number |
| `order_lines` | Items in each order | id, order_id, item_id, quantity, price, kot_printed_qty, kot_status |
| `payments` | Payment records (separate from orders) | id, order_id, method, amount_paise, received_at, txn_ref |
| `settings` | Key-value config (GST, printers, service modes, etc.) | key, value_json, updatedAt |
| `audit_logs` | Action history | id, timestamp, user_id, action, entity_type, entity_id, details_json |
| `audit_logs_fts` | FTS5 virtual table for audit search | action, details, entity_type |
| `audit_archives` | Archived audit log batches | id, archived_at, payload |
| `print_jobs` | Failed print queue (for retry) | id, order_id, printer, status, error_msg, createdAt |
| `backup_records` | Backup history | id, filename, size, createdAt, restoredAt |
| `grocery_items` | Procurement item catalog | id, name, category, default_unit |
| `grocery_lists` | Buying lists | id, title, list_date, status, type |
| `grocery_list_lines` | Lines on a buying list | list_id, grocery_item_id, qty, unit, line_status |
| `grocery_list_templates` | Reusable list templates | id, name |
| `grocery_list_template_lines` | Template line items | template_id, grocery_item_id, qty |
| `vendors` | Supplier directory | id, name, contact, notes |
| `grocery_purchases` | Recorded purchases | vendor_id, purchase_date, total_paise, payment_method, status |
| `grocery_purchase_lines` | Purchase line detail | purchase_id, item_name, qty, amount_paise |
| `expense_categories` | Operating expense categories | id, name, is_system |
| `expenses` | Operating expenses | category_id, amount_paise, expense_date, description, deleted_at |

**Note**: All currency stored as paise (100 paise = 1 rupee) to avoid floating-point errors. Sessions are held in-memory in the Electron main process (not persisted in SQLite).

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

### Application Shell

After login, the app shows a persistent header with:
- **Main navigation** (role-filtered): Tables, Billing, KOT Queue, Reports (reports-only roles), Customers, Manage
- **Clock** and **user menu** (profile dialog, logout)
- **Branding** from Settings (restaurant name shown in user menu)

Screens are lazy-loaded with skeleton loaders. Post-login prefetch warms common screen chunks for faster first navigation.

### Auth & Onboarding

| Screen | When shown | Purpose |
|---|---|---|
| **Setup** | First launch (no users in DB) | Create first admin account; display recovery codes |
| **Login** | Unauthenticated | Username + password sign-in |
| **Change Password** | `requirePasswordChange` flag set | Force new password before app access |
| **My Profile** | User menu | View identity, session start time, logout |

### Floor / Cashier Pages (top navigation)

| Page | Route hash | Who | Purpose |
|---|---|---|---|
| **Tables** | `#tables` | Cashier+ (if table mode enabled) | Seating-area table grid; select table → opens Billing |
| **Billing** | `#billing` | Cashier+ | Primary order screen: service mode tabs, item search, favorites, cart, discount, payment, KOT |
| **KOT Queue** | `#kot` | Cashier+ | Pending kitchen tickets; retry failed prints |
| **Customers** | `#customers` | Cashier+ | Search, create, edit customers; virtualized list |
| **Reports** | `#reports` | Admin (or reports-only role) | Sales and profitability reports |
| **Manage** | `#manage-*` | Admin / Manager | Back-office workspace (see below) |

**Split view**: On Tables page, billing can open inline beside the table grid.

### Manage Workspace (Admin / Manager)

Opened via **Manage** nav or deep-link hashes. Sidebar groups:

| Section | Hash | Who | Tabs / content |
|---|---|---|---|
| **Overview** | `#manage-overview` | Admin, Manager | Today's grocery list attention items, quick stats |
| **Grocery** | `#manage-grocery-*` | Admin, Manager | Buying Lists, Purchases, Vendors, Grocery Items |
| **Expenses** | `#manage-expenses` | Admin, Manager | Operating expense ledger |
| **Menu** | `#manage-menu` | Admin, Manager | Menu items, categories, variants |
| **People** | `#manage-people-*` | Permission-gated | Attendance (Daily / History), Roster, Salary Advances, Accounts |
| **Reports** | `#reports` | Admin | Same as top-nav Reports |
| **History** | `#manage-history` | Admin | Paid order browser, reprint, bulk delete |
| **Audit** | `#manage-audit` | Admin | Searchable audit log viewer |
| **Settings** | `#manage-settings` | Admin | Identity, Hardware, Operations, Retention |

**People sub-tabs** (hash-driven):
- `#manage-people-attendance` — Daily attendance grid + History export
- `#manage-people-roster` — Staff roster CRUD
- `#manage-people-advances` — Salary advance summary + transactions
- `#manage-people-accounts` — POS user accounts (Admin only)

**Command palette**: Keyboard shortcut in Manage for quick navigation between sections.

### Role → Page Access Summary

| Capability | Admin | Manager | Cashier |
|---|:---:|:---:|:---:|
| Tables, Billing, KOT, Customers | ✓ | ✓ | ✓ |
| Manage → Overview, Grocery, Expenses, Menu | ✓ | ✓ | — |
| Manage → People (Attendance, Roster, Advances) | ✓ | ✓ | — |
| Manage → People → Accounts | ✓ | — | — |
| Reports, History, Audit, Settings | ✓ | — | — |

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
npm run perf:seed         # Seed performance test database
npm run perf:app          # Run backend/report performance benchmarks
npm run perf:ui           # Run UI navigation stress test (Electron)
npm run perf:all          # Seed + app + UI benchmarks
```

### Production Deployment
1. **Build machine**: Windows with Node.js 22.x, Visual Studio 2022 Build Tools (C++)
2. **Build**: `npm run build` → `release/RestoNiti Setup 0.4.0.exe`
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
4. **Permission-based security**: Three roles, IPC-enforced, audit trails, scrypt passwords
5. **GST-ready**: Full tax compliance for Indian restaurants
6. **Operations beyond POS**: Grocery procurement, expenses, profitability, attendance, salary advances
7. **Production-ready**: Update mechanism, backup/restore, audit logs, diagnostics export
8. **Performance tooling**: Seed and stress-test scripts (`docs/REPORT_PERFORMANCE_TESTING.md`)

### What's NOT Included (Future)
- Multi-branch / multi-outlet sync
- Online ordering API or customer-facing web ordering
- Real-time inventory depletion tied to menu sales (grocery procurement is purchase-based, not stock-tracked)
- Waiter tablet app / captain handheld (desktop roles only today)
- Cloud sync or remote owner dashboard
- POS API for third-party integrations
- Full payroll processing (attendance and advances only)

---

## PART 9: ROADMAP & FUTURE CONSIDERATIONS

### Immediate Readiness
✅ Single-location restaurant operations  
✅ Cash, card, UPI, and online payments  
✅ Kitchen printing  
✅ GST invoicing  
✅ Grocery buying lists and purchase tracking  
✅ Operating expenses and profitability estimates  
✅ Staff roster, attendance, and salary advances  
✅ Audit & compliance  

### Phase 2 Considerations
- Multi-branch sync with local authority
- Waiter tablet app and table-side ordering
- Delivery platform API integration
- Owner dashboard (read-only remote reports)
- Real-time inventory / recipe costing tied to sales
- Automated payroll from attendance data

---

## PART 10: SUPPORT & OPERATIONS

### Production Runbooks
- `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md` — Fresh setup on restaurant terminal
- `docs/PRODUCTION_UPDATE_RUNBOOK.md` — Deploy updates, rollback
- `docs/DEPLOYMENT_AND_UPDATE_RUNBOOK.md` — Combined deployment guide
- `docs/PRODUCTION_READINESS.md` — Pre-launch checklist
- `docs/ONBOARDING.md` — Developer onboarding and repo map
- `docs/REPORT_PERFORMANCE_TESTING.md` — Performance seeding and stress-test harness
- `docs/design-system.md` — UI tokens, components, and RestoNiti 2026 design rules
- `docs/SECURITY_PENTEST_REPORT.md` — Security assessment notes

### Troubleshooting
- Printer connectivity: Settings → Test Print
- Update failures: Rollback to previous version from About screen
- Database corruption: Restore from backup
- Performance: Archive old audit logs

### Contact & Support
For deployment, updates, or custom feature requirements, refer to project maintainers.

---

## APPENDIX: Quick Reference

### What the app does (summary)

**Floor (POS)**
- Role-based login with admin, manager, and cashier access
- Configurable service modes: dine-in, self-service, takeaway, delivery
- Table grid with seating areas; billing with menu variants, favorites, discounts, GST
- KOT workflow with partial/incremental printing and retry queue
- Payments: cash, card, UPI, online, other; split payments; invoice generation
- Customer directory with search and order linking

**Back office (Manage)**
- Grocery buying lists, purchases, vendors, and item catalog
- Operating expenses by category
- Menu and category editor with item variants
- Staff roster, daily attendance, attendance history export, salary advances
- Sales and profitability reports; paid order history with reprint
- Audit log with full-text search; settings, backup, updates, diagnostics

**Architecture**
- Offline-first Electron + React + SQLite (`better-sqlite3`)
- Sandboxed renderer; all persistence and OS features via `window.pos` IPC bridge
- Main process owns database, printing, backup, restore, auth, and updates

### Key directories

| Path | Purpose |
|---|---|
| `electron/` | Main process: SQLite, IPC, printing, backups, services |
| `electron/main.ts` | App bootstrap, windows, security, IPC wiring |
| `electron/db/sqlite.ts` | Schema, migrations, backup logic |
| `electron/services/posService.ts` | Core business logic |
| `electron/ipc/posIpc.ts` | IPC handler definitions |
| `src/ui/` | React screens, components, theme, hooks |
| `src/ui/screens/` | Page-level screens (Billing, Manager, Attendance, Grocery, …) |
| `src/app/db/posRepository.ts` | Renderer facade over `window.pos` |
| `src/shared/` | DTOs, permissions, GST, service modes, validation |
| `src/config/roles.ts` | Role labels and page mappings |
| `docs/` | Product and operational documentation |
| `scripts/` | Build helpers, performance harness (`perf-*.cjs`) |
| `release/` | Packaged installer outputs |

### Related docs

- **Developers**: Start with `docs/ONBOARDING.md` and `docs/design-system.md`
- **Performance**: See `docs/REPORT_PERFORMANCE_TESTING.md`
- **Deploy**: See `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md` and `docs/PRODUCTION_UPDATE_RUNBOOK.md`


5D07-413C-1765-EEFF-E224-DF51
F5AD-F398-4FDC-EFFC-7258-2605
FBAC-94DD-959E-B1D7-E923-5755