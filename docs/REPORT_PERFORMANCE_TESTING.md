# Application Performance Testing

This developer-only harness validates whether the POS application stays fast with a large local SQLite dataset.

It does not use the production POS database. It creates and benchmarks this ignored local file:

```text
data/perf/restaurant-pos-perf.sqlite
```

The perf database is generated locally on each laptop. It is not committed to git and is not shared automatically.

## Performance Layers

There are two benchmark layers.

### Application Service Layer

This layer runs without opening the UI. It uses the same service paths used by the application, not copied raw SQL.

It benchmarks:

- Sales Summary
- Payment Breakdown
- Product Sales
- Order History list
- Order History count
- Menu item/category/table lists
- Customer list
- Staff list
- Audit list/count/search
- Print queue pending/failed lists
- Receipt/KOT render helpers
- Print queue add
- Billing takeaway order flow

It prints:

- average time
- p95 time
- max time
- row count
- guideline status for every benchmark
- product sales reconciliation status

It saves the report to:

```text
data/perf/report-YYYY-MM-DD-HH-MM-SS.txt
data/perf/latest-report.txt
```

### Electron UI Layer

This layer opens the real Electron renderer against the perf database.

It benchmarks:

- app startup timing
- DB initialization timing
- first screen ready timing
- login timing
- time to open major pages
- renderer responsiveness for search/filter inputs
- Billing UI workflow: open table, add items, pay order
- Reports PDF export total timing
- Reports PDF breakdown: renderer HTML handoff, temp HTML write, Electron HTML load, and `printToPDF`
- Audit CSV export timing
- repeated navigation through heavy pages
- rolled-back day simulation
- memory checkpoints after login, page navigation, search tests, billing workflow, PDF export, repeated navigation, and day simulation

It saves the report to:

```text
data/perf/ui-report-YYYY-MM-DD-HH-MM-SS.txt
data/perf/latest-ui-report.txt
```

## Default Dataset

Running the seed script with no size options creates:

```text
20 categories
200 menu items
5000 paid orders
100000 audit logs
1000 customers
100 staff
500 print jobs
1 perf admin user
180 days of sales history
```

Each order has realistic order lines, stored item/category snapshots, final totals, and completed payments.

The UI benchmark signs in with the generated perf admin:

```text
Username: perfadmin
Password: PerfAdmin123!
```

## Important: Seed vs Order Count

`--seed` controls deterministic randomness. It does not control record count.

This command still creates the default 5000 orders:

```powershell
npm run perf:seed -- --seed 1000
```

To create 1000 paid orders, use `--orders`:

```powershell
npm run perf:seed -- --orders 1000 --seed 123
```

Use `--seed` when you want comparable before/after benchmark data.

## Commands

Run all commands from the repo root:

```powershell
cd C:\workspace\POS\restaurant-pos
```

Run the default performance test:

```powershell
npm run perf
```

Run a reproducible benchmark:

```powershell
npm run perf:seed -- --seed 123
npm run perf:app
```

Run the Electron UI benchmark:

```powershell
npm run perf:ui
```

For UI tests, seed with an anchor close to the day you are testing if you want Today and Current Month screens to contain data:

```powershell
npm run perf:seed -- --orders 10000 --items 300 --categories 25 --audits 100000 --customers 2000 --staff 150 --print-jobs 1000 --days 180 --seed 123 --anchor 2026-05-31
npm run perf:ui
```

The UI benchmark loads `dist/index.html` by default. To benchmark the latest source, build the renderer first:

```powershell
npm run build:renderer
npm run perf:ui
```

If you want to point the UI benchmark at a running Vite renderer:

```powershell
npm run dev:react
npm run perf:ui -- --renderer-url http://localhost:5173
```

If `perf:ui` reports a renderer error from `dist/assets`, rebuild the renderer before trusting UI timings:

```powershell
npm run build:renderer
npm run perf:ui
```

Save to a specific file:

```powershell
npm run perf:app -- --output data/perf/before-product-sales-change.txt
```

`npm run perf:reports` is kept as a backwards-compatible alias for the same application benchmark.

Run a smaller dataset:

```powershell
npm run perf:seed -- --orders 1000 --items 100 --categories 10 --days 90 --seed 123
npm run perf:app
```

Run a larger dataset:

```powershell
npm run perf:seed -- --orders 10000 --items 300 --categories 25 --days 180 --seed 123
npm run perf:app
```

For a full larger application dataset:

```powershell
npm run perf:seed -- --orders 10000 --items 300 --categories 25 --audits 100000 --customers 2000 --staff 150 --print-jobs 1000 --days 180 --seed 123
npm run perf:app -- --history-limit 25
npm run perf:ui -- --iterations 5 --warmups 1
```

Run the normal regression checks:

```powershell
npm test -- --runInBand
npm run lint -- --quiet
```

## Seed Options

```text
--orders <number>       Number of paid orders to generate. Default: 5000
--items <number>        Number of menu items to generate. Default: 200
--categories <number>   Number of categories to generate. Default: 20
--audits <number>       Number of audit logs to generate. Default: 100000
--customers <number>    Number of customers to generate. Default: 1000
--staff <number>        Number of staff rows to generate. Default: 100
--print-jobs <number>   Number of print queue rows to generate. Default: 500
--days <number>         Number of days to spread sales across. Default: 180
--seed <value>          Deterministic random seed.
--anchor YYYY-MM-DD     Anchor date for generated sales.
```

When `--seed` is provided and no `--anchor` is provided, the script uses a fixed anchor date so the generated dataset is repeatable across runs.

## Report Options

```text
--iterations <number>      Measured benchmark iterations. Default: 20
--warmups <number>         Warmup iterations before measuring. Default: 3
--history-limit <number>   Paid order history rows to load. Default: 25
--output <path>            Optional output file path for the saved text report.
```

Example:

```powershell
npm run perf:app -- --iterations 30 --warmups 5 --history-limit 200
```

## UI Report Options

```text
--iterations <number>     Measured UI iterations. Default: 5
--warmups <number>        Warmup UI iterations before measuring. Default: 1
--renderer-url <url>      Optional running renderer URL. Default: dist/index.html
--output <path>           Optional output file path for the saved UI text report.
--show                    Show the Electron window while benchmarking.
--nav-cycles <number>     Repeated heavy-page navigation cycles. Default: 5
--day-cycles <number>     Rolled-back simulated restaurant orders. Default: 20
```

Example:

```powershell
npm run perf:ui -- --iterations 10 --warmups 2 --nav-cycles 10 --day-cycles 100 --output data/perf/ui-before-history-change.txt
```

Example output block:

```text
Product Sales (Large Range)
Avg: 35.8ms
P95: 38.2ms
Max: 38.5ms
Rows: 220
Guideline: OK (P95 under 1500.0ms)
Reconciliation: PASS (Rs 9005236.71)
```

## Performance Guidelines

These targets are review guidelines, not build blockers. Timings vary by laptop.

```text
Today: p95 under 200ms
Current month: p95 under 500ms
Large range: p95 under 1500ms
```

If a benchmark is slow, inspect the query manually with `EXPLAIN QUERY PLAN` before adding indexes.

Use this decision rule:

```text
Guideline: OK      Performance is healthy for that range.
Guideline: REVIEW  P95 is above the guideline; inspect if the UI feels slow.
Reconciliation: FAIL  Correctness issue; fix before judging performance.
```

For Order History, use `--history-limit 25` as the normal app benchmark because the real History screen starts with a small page. Use `--history-limit 100` as a stress test.

For UI results, use the same rule:

```text
Guideline: OK      Healthy for that page or workflow.
Guideline: REVIEW  Above the guideline; check whether the UI actually feels slow.
```

UI timings include renderer work, IPC calls, React rendering, and some Electron overhead. They will usually be noisier than the service-layer timings.

The long-running UI guidelines scale with the requested stress size:

```text
Repeated Navigation: 1600ms per --nav-cycles value
Day Simulation: 250ms per --day-cycles value
Report PDF Export Total: 7000ms
```

For example, `--nav-cycles 20` uses a repeated-navigation guideline of `32000ms`.

The UI report prints memory as checkpoints rather than only one final number. Use these checkpoints to find where memory grows:

```text
=== Memory Checkpoints ===
Memory After Login
Memory After Page Navigation
Memory After Search Tests
Memory After Billing Workflow
Memory After PDF Export
Memory After Repeated Navigation
Memory After Day Simulation
Memory Growth From Login To Final Checkpoint
```

If memory jumps after PDF export, investigate Electron PDF rendering. If it grows mostly after repeated navigation, inspect heavy pages such as Audit, Customers, Reports, and Menu for retained state or large in-memory lists.

When repeated navigation runs, the UI report also samples memory during the first, middle, and final navigation cycle:

```text
=== Repeated Navigation Memory Summary ===
Sorted by positive renderer growth.
Menu: Samples 20 | Renderer Net 77.0 MB | Renderer Positive 79.3 MB | Max Renderer Step 16.8 MB | Total Net 67.9 MB | Main Net -9.9 MB

=== Repeated Navigation Memory Attribution ===
Memory Before Repeated Navigation
Memory Repeated Navigation Cycle 1 After Reports
Memory Repeated Navigation Cycle 1 After History
Memory Repeated Navigation Cycle 1 After Audit
Memory Repeated Navigation Cycle 1 After Menu
Memory Repeated Navigation Cycle 1 After Tables
...
```

Use the summary first. `Renderer Positive` shows total upward renderer-memory movement attributed to that page across all repeated-navigation cycles. `Renderer Net` includes memory releases, so it may be lower. Use the detailed `Delta Since Previous` lines when you need to inspect a specific sampled cycle.

For PDF export, the UI report prints both a total and a breakdown:

```text
Report PDF Export Total
Avg: 6280.2ms
P95: 6560.6ms
Max: 6560.6ms
Rows: 1
Guideline: OK (P95 under 7000.0ms)
PDF Breakdown
Renderer HTML Handoff: Avg 120.0ms, P95 135.0ms, Max 135.0ms
Temp HTML Write: Avg 3.0ms, P95 4.0ms, Max 4.0ms
Electron HTML Load: Avg 900.0ms, P95 980.0ms, Max 980.0ms
Electron printToPDF: Avg 5200.0ms, P95 5450.0ms, Max 5450.0ms
PDF Handler Total: Avg 6100.0ms, P95 6400.0ms, Max 6400.0ms
Latest HTML Size: 180.0 KB
Latest PDF Size: 250.0 KB
```

Use the breakdown to decide where to investigate:

- High renderer handoff means the report HTML generation or renderer-side export flow is slow.
- High HTML load means the temporary export page is expensive for Chromium to load.
- High `printToPDF` usually points to Electron/Chromium PDF rendering cost rather than SQLite queries.

## Reconciliation Check

For every benchmarked range, Product Sales is reconciled against Sales Summary:

```text
sum(categorySales.sales)
==
sum(itemSales.sales)
==
Sales Summary total sales
```

Reconciliation failures print `FAIL` and exit with a non-zero status.

Only Product Sales prints reconciliation because it is the report that can be cross-checked against category, item, and sales-summary totals.

## Running On Another Laptop

The perf database is local and ignored by git. Another laptop will not have your generated data after pulling the repo.

Regenerate comparable data on that laptop:

```powershell
npm run perf:seed -- --seed 123
npm run perf:app
```

With the same seed and options, row counts and totals should match. Timings can differ because hardware differs.

## Native SQLite Note

The scripts start with Node:

```text
node scripts/perf-seed.cjs
node scripts/perf-reports.cjs
```

If `better-sqlite3` was rebuilt for Electron instead of Node, the scripts automatically rerun through the local Electron runtime so they can load the same native SQLite module used by the app.

## Quick UI Stress Commands

```powershell
npm run perf:seed -- --orders 10000 --items 300 --categories 25 --audits 100000 --customers 2000 --staff 150 --print-jobs 1000 --days 180 --seed 123 --anchor 2026-05-31
npm run build:renderer
npm run perf:ui -- --iterations 5 --warmups 1
npm run perf:ui -- --iterations 5 --warmups 1 --nav-cycles 20 --day-cycles 100
```

Get-Printer | Select-Object Name,PrinterStatus,Default
