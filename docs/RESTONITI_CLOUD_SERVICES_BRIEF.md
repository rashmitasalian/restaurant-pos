# RestoNiti — Cloud services brief 

**Status:** Proposed  
**Date:** 12 September 2026  
**Ask:** Confirm this service map before production cutover.

---

## Decision in one line

**Azure App Service (Linux) + Azure Database for PostgreSQL Flexible Server + Cloudflare R2**  
(+ Cloudflare Pages later for QR / owner web).  
**Not** Azure SQL for production. POS stays offline SQLite.

---

## Service map

| Service | Role | Used for |
| --- | --- | --- |
| **Azure App Service Linux B1** (→ B2 if needed) | .NET 10 Cloud API | Activate, recover, backup upload/list, later owner APIs |
| **Azure Database for PostgreSQL Flexible Server B1ms** (→ B2s if needed), 32 GB, Central India | Shared multi-tenant DB | Backup **metadata**; later owner **read models** / events |
| **Cloudflare R2** (private bucket) | Object storage | Encrypted `.rnbak` blobs; later published menu JSON |
| **Cloudflare Pages** (later) | Static / PWA host | QR view-only menu; owner dashboard web app |
| **SMS OTP provider** (later, e.g. MSG91) | Auth | Owner login — not Azure SQL |

**Local / CI only:** SQLite file for Cloud API tests (unchanged).

---

## By product capability

| Capability | Status | Services |
| --- | --- | --- |
| Encrypted cloud backup / new-PC recover | Shipped (API) | App Service + Postgres (ids, tokens, backup rows) + R2 (ciphertext) |
| Owner dashboard | Planned | Same App Service + Postgres projections; Pages PWA; OTP |
| QR view-only menu | Planned | R2 (menu JSON) + Pages — **not** Postgres on every guest scan |
| Classic POS / Captain | Local only | No cloud services |

---

## Explicitly out

| Do not use (for this plan) | Why |
| --- | --- |
| Azure SQL Database (Serverless or provisioned) | Cost; wrong fit for this metadata/projection workload |
| Azure Blob / AWS S3 (instead of R2) | Prefer R2 (no egress fee; already integrated) |
| Rewriting API in Go / moving to AWS or Oracle now | Extra risk; little saving vs Postgres on Azure |
| Putting `.rnbak` bytes in Postgres | Blobs stay on R2 |

---

## Trust boundary

- POS **SQLite** = source of truth for billing.  
- Cloud stores **ciphertext + metadata** only.  
- Recovery key held by owner; server stores verifier + wrapped key only.

---

## Open questions (please answer)

1. Postgres: public + firewall vs Private Endpoint + App Service VNet?  
2. Single-AZ B1ms OK for v1 DR, or zone redundancy from day one?  
3. Key Vault mandatory for R2 + Postgres secrets in production?  
4. Is R2 (Cloudflare) acceptable beside Azure Central India for ciphertext?

---

## Ask

**Approve:** Linux App Service + PostgreSQL Flexible + R2 as the cloud platform for backup now and owner dashboard / QR later.  
**Reject alternatives:** Azure SQL for production metadata; greenfield AWS/Oracle rewrite before paying Premium clients.
