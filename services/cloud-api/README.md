# RestoNiti Cloud API

.NET 8 Minimal API for encrypted POS backup metadata and object storage.

## Local development

```bash
cd services/cloud-api
dotnet restore
dotnet run
```

Defaults to SQLite metadata (`restoniti-cloud.db`) and local file storage under `local-r2/` (no R2 credentials required).

Point the desktop POS at it:

```env
POS_CLOUD_API_URL=http://localhost:5000
POS_CLOUD_BACKUP_ENABLED=1
```

Production should use HTTPS, Azure SQL (`ConnectionStrings:CloudDb`), and Cloudflare R2:

```json
{
  "Cloud": {
    "UseLocalFileStorage": false,
    "R2AccountId": "...",
    "R2AccessKeyId": "...",
    "R2SecretAccessKey": "...",
    "R2Bucket": "restoniti-backups",
    "R2ServiceUrl": "https://<accountid>.r2.cloudflarestorage.com"
  }
}
```

## Tests

```bash
dotnet test
```
