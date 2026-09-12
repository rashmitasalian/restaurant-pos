# RestoNiti Cloud Data Platform — Architecture Plan

**Status:** Proposed for architect review  
**Date:** 10 September 2026  
**Decision:** Keep **Azure** for the API, keep **Cloudflare R2** for encrypted backups (and later QR menu files), replace **Azure SQL Database** with **Azure Database for PostgreSQL Flexible Server** for metadata and future owner-dashboard projections.  
**Out of scope for this change:** Rewriting the Electron POS, rewriting the cloud API in Go, moving to AWS or Oracle.

---

## 1. Decision requested

Approve the target platform:

| Layer | Choice |
| --- | --- |
| POS (source of truth) | Unchanged: local **SQLite** on the restaurant PC |
| Cloud API | Unchanged language: existing **.NET 10** Minimal API on **Azure App Service (Linux)** |
| Object storage | Unchanged: **Cloudflare R2** (S3-compatible, private bucket) |
| Relational store | **Change:** Azure SQL → **Azure Database for PostgreSQL Flexible Server** |
| QR view-only menu (later) | **Cloudflare Pages** + menu JSON on R2 |
| Owner dashboard (later) | Same API + **Postgres read models** (event projections), not a live copy of SQLite |

Please confirm or reject this direction before we migrate production metadata off SQL Server.

---

## 2. Context

### 2.1 Product constraints

RestoNiti is an **offline-first** desktop POS. Billing, KOT, and printing must work with no internet. Cloud is:

1. **Disaster recovery** — encrypted `.rnbak` off-site; new PC restore via restaurant code + owner recovery key.  
2. **Later: owner visibility** — phone/web dashboard of sales summaries, not the POS itself.  
3. **Later: QR view-only menu** — static public page, no ordering in v1.

SQLite on the PC remains the system of record. Cloud must never block POS operations.

### 2.2 What already exists

| Piece | Today |
| --- | --- |
| Desktop | Electron POS; local `.rnbak` pipeline (snapshot → gzip → AES-256-GCM); cloud client + scheduler |
| Cloud API | `services/cloud-api` — activate, recover, upload-intent, content PUT/GET, verify, list |
| Metadata schema | `Restaurants`, `Installations`, `RestaurantSecrets`, `BackupRecord` (EF Core `CloudDbContext`) |
| Dev DB | SQLite (`Data Source=...`) |
| Staging DB | Azure SQL (General Purpose **Serverless Gen5**) — expensive when left awake |
| Blobs | Private R2; API buffers upload and writes with R2-compatible S3 settings |
| App Service | Staging Windows; **production target is Linux B1** |

EF today: SQLite if the connection string looks like a file; otherwise `UseSqlServer` with retry (SQL error 40613 when serverless is paused).

### 2.3 Cost problem we are solving

Measured Azure retail (Central India, INR, 10 Sep 2026, 730 h/month):

| Database SKU | Compute / month |
| --- | ---: |
| SQL Serverless 0.5 vCore **left awake** | ~₹20,000 |
| SQL **provisioned 1 vCore** (honest owner-dashboard SKU) | ~₹11,679 |
| PostgreSQL Flexible **B1ms** (burstable, always on) | ~₹1,709 |

Full shared platform (API + DB + R2 + OTP buffer), owner dashboard live:

| Stack | Platform / month | Cloud break-even @ ₹10,000 Premium / year |
| --- | ---: | ---: |
| App Service Linux B1 + SQL 1 vCore + R2 | ~₹14,700 | ~19 Premium outlets |
| **App Service Linux B1 + Postgres B1ms + R2** | **~₹4,800** | **~6 Premium outlets** |
| Greenfield Go + Fly + Postgres + R2 | ~₹4,300 | ~5 Premium outlets |

Saving vs SQL 1 vCore: **~₹10,000 / month (~₹1.2 lakh / year)** on the shared platform. Almost all of it is SQL Server vs Postgres compute, not “Azure vs AWS.”

Supporting briefs (internal): `docs/RESTONITI_BUSINESS_PRICING_AND_EXPENSE.pdf`, `docs/RESTONITI_CLOUD_STACK_SAVINGS.pdf`.

---

## 3. Why Azure + Postgres (and not the alternatives)

### 3.1 Why stay on Azure for the API

- API is already written, deployed, and exercised (activate / upload / R2 / recover).  
- App Service Linux B1 is a known, cheap always-on SKU (~₹1,255/month).  
- Region **Central India** matches data-residency preference.  
- Changing **only the database provider** is a bounded EF change; changing cloud vendor re-proves identity, recover, and networking.

### 3.2 Why Postgres instead of Azure SQL

- Metadata and future projections are **relational OLTP**, not SQL Server–specific. Current schema is simple keys/indexes; no T-SQL, Agent, or SSMS-only features.  
- EF Core has a first-class **Npgsql** provider; local tests can stay on SQLite.  
- Always-on owner dashboard **cannot** rely on SQL Serverless auto-pause (wakes = ₹54.84/vCore-hour). Provisioned SQL 1 vCore is the honest SQL path and is ~7× Postgres B1ms.  
- Postgres is the default for later event-sourced **read models** (owner app). SQL Server would work; it is the wrong price for this workload.

### 3.3 Why keep Cloudflare R2 (not Azure Blob, not S3)

- Backups are large ciphertext blobs; R2 has **no egress fee** to the internet.  
- POS already uses the AWS S3 SDK against R2.  
- QR menus later are small JSON (+ images) on the same object store, fronted by Pages.  
- Azure Blob / AWS S3 would add egress and a second blob stack for little gain.

### 3.4 Alternatives considered and rejected

| Option | Why not (for production now) |
| --- | --- |
| **Keep Azure SQL Serverless** | Staging showed high bills when the DB stays awake; owner dashboard makes pause unreliable. |
| **Keep Azure SQL provisioned 1 vCore** | Correct SQL SKU for dashboard; **~₹10k/month extra** vs B1ms with no product benefit. |
| **AWS (RDS Postgres + App Runner/ECS)** | Similar or higher small-scale cost; re-platform before first paying Premium clients. Revisit at ~100+ Premium if SNS/Cognito matter. |
| **Oracle Cloud Always Free / ATP** | Attractive ₹0 lab; poor .NET fit, idle-stop risk, 20 GB cap, expensive jump to paid Autonomous. Unsuitable for recovery-key production. |
| **Rewrite API in Go + Fly.io** | Extra save vs Azure+Postgres is **~₹500/month**. Rewrite cost and re-test of recover dominate. |
| **Firebase / Cosmos as POS truth** | Violates offline-first SQLite design. |
| **Put backup bytes in Postgres** | Wrong store; size and cost explode. Blobs stay on R2. |

### 3.5 Drawbacks we accept (Postgres)

- **Migration work:** `UseSqlServer` → `UseNpgsql`; connection string; retry policy; staging cutover.  
- **B1ms is burstable:** enough for backup + light dashboard; heavy live-refresh for many tenants may need **B2s** (~₹6.8k/month compute) or a small GP SKU — still below SQL 1 vCore.  
- **Different ops:** pgAdmin / Azure Data Studio, Flexible Server backup/firewall, version upgrades.  
- **Not an Azure exit:** billing and Entra stay Azure.

---

## 4. Target architecture

```text
Restaurant PC (Electron)
  SQLite  = source of truth for billing / KOT
  .rnbak  = gzip + AES-256-GCM (key in OS secure storage)
       |
       | HTTPS (never blocks POS)
       v
Azure App Service (Linux)  .NET 10 Cloud API
       |
       +-- PostgreSQL Flexible Server     metadata + later owner projections
       |
       +-- Cloudflare R2                  ciphertext backups, later menu JSON
              |
              +-- Pages  menu.restoniti.com/menu/{slug}     QR view-only (later)
              +-- Pages  owner.restoniti.com                owner PWA (later)
```

**Trust boundary:** Cloud stores **ciphertext + metadata**. Plaintext POS DB never leaves the PC except inside owner-held recovery. Recovery key is not stored on the server (only scrypt verifier + wrapped key material as today).

---

## 5. How we will use each component

### 5.1 PostgreSQL — what goes in

| Data | Use |
| --- | --- |
| `restaurants` | Tenant id, public restaurant code |
| `installations` | Device, hashed installation token, app version |
| `restaurant_secrets` | Recovery-key **verifier** (scrypt), wrapped backup key — not the raw recovery key |
| `backups` | Backup id, object key, checksum, size, status, timestamps, retention |
| **Later** `events` / rollup tables | Projected sales, voids, daily totals for owner API (`restaurant_id` on every row) |

**Multi-tenant:** one shared database, `restaurant_id` isolation in every query (already the API model). Not one database per restaurant.

**What must not go in Postgres:** SQLite files, `.rnbak` bodies, menu images, owner session blobs.

### 5.2 R2 — what goes in

| Object | Use |
| --- | --- |
| `backups/{restaurantId}/{installationId}/{backupId}.rnbak` | Encrypted DR (as today) |
| **Later** `menus/{slug}.json` (+ optional images) | Published view-only menu for QR |

Access: private bucket; only the API (service credentials) reads/writes. Guests never hit Azure SQL/Postgres; QR reads CDN/R2 public or authenticated static URLs as designed in the menu work.

### 5.3 App Service — what it does

- Authenticate installation Bearer tokens.  
- Activate / recover.  
- Create backup records; **buffer and PUT** ciphertext to R2 (current reliable path; presigned browser PUT was dropped after R2 signature issues).  
- List / download / verify for the POS.  
- **Later:** owner auth (OTP), projection ingest, owner read APIs.  
- Health: `/health` must **not** keep Postgres awake with heavy work; liveness vs readiness to be split if needed.

### 5.4 Backup-only vs owner dashboard (same Postgres, different load)

| Phase | Postgres behaviour | SKU intent |
| --- | --- | --- |
| **Now — DR only** | Low QPS; daily uploads | B1ms always on **or** short auto-stop only if we accept recover latency; prefer **always-on B1ms** once clients are live so recover is predictable |
| **Owner dashboard** | Continuous small reads/writes | Keep B1ms; **watch CPU credits**; scale to B2s if throttled |

Do **not** use Azure SQL Serverless as the long-term dashboard store.

### 5.5 POS / API usage (unchanged contract)

Desktop continues to call:

- `POST /api/v1/cloud/activate`  
- `POST /api/v1/cloud/recover`  
- `POST /api/v1/backups/upload-intent`  
- `PUT /api/v1/backups/{id}/content`  
- `POST /api/v1/backups/{id}/verify`  
- `GET /api/v1/backups` (+ content GET)

`POS_CLOUD_API_URL` and `POS_CLOUD_BACKUP_ENABLED` stay the POS config. **No POS schema change** for the Postgres move.

### 5.6 Local development

Keep **SQLite** when `CloudDb` is a file path so engineers do not need Azure Postgres to run tests (`CloudApiTests` already uses SQLite). CI: SQLite. Staging/production: Postgres.

---

## 6. Implementation plan

### Phase 0 — Hygiene (before any client production)

- Production App Service: **Linux B1**, not Windows B1 (~₹4.5k/month wasted on Windows).  
- Staging SQL: auto-pause / stop unused; no chatty `/health` + `EnsureCreated` loops.  
- Document R2 + API env vars; secrets in App Service configuration / Key Vault, not source control.

### Phase 1 — Postgres for existing metadata (this decision)

1. Add `Npgsql.EntityFrameworkCore.PostgreSQL`; branch `UseNpgsql` when connection string is not SQLite.  
2. Enable Npgsql retry on transient errors (equivalent to current SQL 40613 retry).  
3. Provision **Flexible Server**, Central India, **B1ms**, public access denied except App Service outbound (or private endpoint if architect requires VNet). SSL required.  
4. Replace `EnsureCreated` in production with **EF migrations** (reviewable DDL).  
5. Staging cutover: empty Postgres → run API tests (activate, upload 1 object, list, recover path).  
6. If staging SQL has data to keep: one-off export/import script; otherwise start clean (no production restaurants yet).  
7. Dual-run window: API config points to Postgres; SQL decommissioned after sign-off.

**Success:** existing Jest/POS cloud tests + `dotnet test` + manual Backup Now → R2 object + list/restore.

### Phase 2 — Client rollout (DR only)

- Premium = Classic + cloud backup. Classic stays local backup only.  
- On-call: recover-key process, do not log recovery keys.

### Phase 3 — Owner dashboard (designed now, built later)

- POS **event log** (append-only) → API ingest → Postgres projections.  
- Do **not** upload full SQLite on an interval.  
- Owner PWA on Pages; API remains the only writer to projections.  
- Refresh 1–5 minutes or on open; no per-second trading-style poll.  
- If B1ms CPU credits exhaust: scale Flexible Server, don’t move back to SQL Server.

### Phase 4 — QR view-only (optional, cheap)

- Publish menu JSON to R2; one Pages app, route `/menu/{slug}`.  
- Independent of Postgres QPS if published as static files.

---

## 7. Security and compliance (architect checklist)

| Topic | Approach |
| --- | --- |
| Backup confidentiality | Client-side AES-256-GCM; R2 holds ciphertext |
| Recovery | Owner-held recovery key; server stores verifier + wrapped key only |
| Tenant isolation | Every backup/list/download scoped by `restaurantId` from installation auth (existing tests) |
| Secrets | Installation tokens hashed; App Service / Key Vault for R2 and Postgres credentials |
| Network | Postgres firewall: App Service outbound IPs or VNet integration |
| Region | Central India (API + Postgres); R2 account as already used |
| PII in Postgres | Restaurant code, device labels, later sales aggregates — minimize; no full customer dump required for DR |
| QR | Public read of menu only; no POS credentials |

---

## 8. SKU and cost envelope (production, shared)

| Resource | Target SKU | ~₹ / month |
| --- | ---: | ---: |
| App Service | Linux B1 | 1,255 |
| Postgres | Flexible B1ms + ~15 GB storage later | 1,709 + storage |
| R2 | Standard, backups + menus | 100–300 early |
| OTP / domain / logs | Buffer | 400–1,400 |
| **Full Premium platform** | | **~₹4,800–5,500** |

Scale trigger: Postgres CPU/credit or connection saturation → B2s or GP 1 vCore **Postgres**, not SQL Server.

---

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| EF/Npgsql behavioural differences vs SQL | Integration tests on real Flexible Server in staging before any client |
| B1ms throttle under dashboard load | Metrics + alert; pre-approved B2s |
| R2 signing / large PUT | Keep API-buffered upload (current); do not regress to naive presign without a spike |
| `EnsureCreated` in prod | Replace with migrations |
| Staging cost relapse | Auto-stop unused SQL; don’t leave Serverless awake |
| Scope creep (QR ordering, multi-outlet) | Explicitly later; not this DB decision |

---

## 10. Open questions for the architect

1. **Network:** Flexible Server public + firewall vs Private Endpoint + App Service VNet (cost vs isolation)?  
2. **HA:** Single-AZ B1ms is enough for v1 DR, or require zone redundancy from day one?  
3. **Migrations:** Approve EF migrations as the DDL source of truth?  
4. **Key Vault:** Mandatory for R2 + Postgres secrets in production?  
5. **B1ms vs always-on small GP:** Accept burstable for 12 months, or start GP to avoid credit surprises?  
6. **Data residency:** Is R2 (Cloudflare) acceptable alongside Azure Central India for ciphertext blobs?

---

## 11. Recommendation (summary)

**Approve Azure App Service Linux + PostgreSQL Flexible Server + Cloudflare R2.**

- Fits the product (offline POS, encrypted DR, later owner projections).  
- Saves ~**₹10k/month** vs the honest SQL 1 vCore dashboard SKU without rewriting the API.  
- Reject AWS/Oracle/Go rewrite **now**; they do not change the POS architecture and add migration risk before paying Premium customers.

**Ask of the architect:** Sign off on Phase 1 (Npgsql + Flexible Server B1ms + Linux B1 + R2 as-is), and on the answers in section 10, so engineering can migrate staging off Azure SQL.
