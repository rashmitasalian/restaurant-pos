using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RestoNiti.CloudApi;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<CloudOptions>(builder.Configuration.GetSection("Cloud"));
builder.Services.AddDbContext<CloudDbContext>(options =>
{
    var cs = builder.Configuration.GetConnectionString("CloudDb")
        ?? "Data Source=restoniti-cloud.db";
    if (cs.Contains("Data Source=", StringComparison.OrdinalIgnoreCase) ||
        cs.Contains("Filename=", StringComparison.OrdinalIgnoreCase))
    {
        options.UseSqlite(cs);
    }
    else
    {
        // Azure SQL serverless can be paused (error 40613); retry while it wakes.
        options.UseSqlServer(cs, sql => sql.EnableRetryOnFailure(
            maxRetryCount: 10,
            maxRetryDelay: TimeSpan.FromSeconds(10),
            errorNumbersToAdd: null));
    }
});
builder.Services.AddSingleton<ObjectStorageService>();
builder.Services.AddSingleton<CryptoService>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<CloudDbContext>();
    db.Database.EnsureCreated();
}

app.MapGet("/health", (ObjectStorageService storage) =>
    Results.Ok(new { ok = true, storage = storage.UsesR2 ? "r2" : "local" }));

app.MapPost("/api/v1/cloud/activate", async (
    [FromBody] ActivateRequest request,
    CloudDbContext db,
    CryptoService crypto) =>
{
    if (string.IsNullOrWhiteSpace(request.RecoveryKeyVerifierHash) ||
        string.IsNullOrWhiteSpace(request.WrappedBackupKey) ||
        string.IsNullOrWhiteSpace(request.RecoveryKeyVerifierSalt))
    {
        return Results.BadRequest(new { error = "invalid-activation-payload" });
    }

    var restaurantId = Guid.NewGuid().ToString("N");
    var installationId = Guid.NewGuid().ToString("N");
    var deviceId = Guid.NewGuid().ToString("N");
    var restaurantCode = CryptoService.GenerateRestaurantCode();
    var installationToken = CryptoService.NewToken();

    db.Restaurants.Add(new Restaurant
    {
        Id = restaurantId,
        Code = restaurantCode,
        CreatedAt = DateTimeOffset.UtcNow
    });
    db.Installations.Add(new Installation
    {
        Id = installationId,
        RestaurantId = restaurantId,
        DeviceId = deviceId,
        TokenHash = crypto.HashSecret(installationToken),
        AppVersion = request.AppVersion,
        DeviceLabel = request.DeviceLabel,
        CreatedAt = DateTimeOffset.UtcNow
    });
    db.RestaurantSecrets.Add(new RestaurantSecret
    {
        RestaurantId = restaurantId,
        RecoveryVerifierAlgo = request.RecoveryKeyVerifierAlgo ?? "SCRYPT-N131072-R8-P1",
        RecoveryVerifierSalt = request.RecoveryKeyVerifierSalt,
        RecoveryVerifierHash = request.RecoveryKeyVerifierHash,
        WrappedBackupKey = request.WrappedBackupKey,
        KeyVersion = request.KeyVersion <= 0 ? 1 : request.KeyVersion
    });
    await db.SaveChangesAsync();

    return Results.Ok(new ActivateResponse(
        restaurantId,
        installationId,
        deviceId,
        restaurantCode,
        installationToken));
});

app.MapPost("/api/v1/cloud/recover", async (
    [FromBody] RecoverRequest request,
    CloudDbContext db,
    CryptoService crypto) =>
{
    var code = (request.RestaurantCode ?? "").Trim().ToUpperInvariant();
    if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(request.RecoveryKey))
    {
        return Results.BadRequest(new { error = "invalid-recovery-payload" });
    }

    var restaurant = await db.Restaurants.FirstOrDefaultAsync(r => r.Code == code);
    if (restaurant is null)
    {
        crypto.HashSecret(request.RecoveryKey);
        return Results.Json(new { error = "unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
    }

    var secrets = await db.RestaurantSecrets.FirstOrDefaultAsync(s => s.RestaurantId == restaurant.Id);
    if (secrets is null)
    {
        return Results.Json(new { error = "unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
    }

    var normalized = CryptoService.NormalizeRecoveryKey(request.RecoveryKey);
    if (!crypto.VerifyScrypt(normalized, secrets.RecoveryVerifierSalt, secrets.RecoveryVerifierHash))
    {
        return Results.Json(new { error = "unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
    }

    var installationId = Guid.NewGuid().ToString("N");
    var deviceId = Guid.NewGuid().ToString("N");
    var installationToken = CryptoService.NewToken();
    db.Installations.Add(new Installation
    {
        Id = installationId,
        RestaurantId = restaurant.Id,
        DeviceId = deviceId,
        TokenHash = crypto.HashSecret(installationToken),
        AppVersion = request.AppVersion,
        DeviceLabel = request.DeviceLabel,
        CreatedAt = DateTimeOffset.UtcNow
    });
    await db.SaveChangesAsync();

    return Results.Ok(new RecoverResponse(
        restaurant.Id,
        installationId,
        deviceId,
        restaurant.Code,
        installationToken,
        secrets.WrappedBackupKey,
        secrets.KeyVersion));
});

app.MapPost("/api/v1/backups/upload-intent", async (
    HttpRequest http,
    [FromBody] UploadIntentRequest request,
    CloudDbContext db,
    CryptoService crypto,
    ObjectStorageService storage,
    IConfiguration config) =>
{
    var auth = await InstallationAuth.RequireAsync(http, db, crypto);
    if (auth.Error is not null) return auth.Error;

    var maxBytes = config.GetValue("Cloud:MaxUploadBytes", 512L * 1024 * 1024);
    if (request.EncryptedSize <= 0 || request.EncryptedSize > maxBytes)
    {
        return Results.BadRequest(new { error = "backup-too-large" });
    }
    if (string.IsNullOrWhiteSpace(request.Checksum) || request.Checksum.Length != 64)
    {
        return Results.BadRequest(new { error = "invalid-checksum" });
    }

    var backupId = Guid.NewGuid().ToString("N");
    var objectKey = $"backups/{auth.Installation!.RestaurantId}/{auth.Installation.Id}/{backupId}.rnbak";
    var retentionDays = config.GetValue("Cloud:RetentionDays", 14);

    db.Backups.Add(new BackupRecord
    {
        Id = backupId,
        RestaurantId = auth.Installation.RestaurantId,
        InstallationId = auth.Installation.Id,
        CreatedAt = DateTimeOffset.UtcNow,
        AppVersion = request.AppVersion,
        DatabaseSchemaVersion = request.DatabaseSchemaVersion,
        BackupFormatVersion = request.BackupFormatVersion,
        OriginalSize = request.OriginalSize,
        CompressedSize = request.CompressedSize,
        EncryptedSize = request.EncryptedSize,
        Checksum = request.Checksum.ToLowerInvariant(),
        ObjectKey = objectKey,
        Status = BackupStatuses.Uploading,
        ExpiresAt = DateTimeOffset.UtcNow.AddDays(retentionDays),
        KeyVersion = request.KeyVersion
    });
    await db.SaveChangesAsync();

    var uploadUrl = await storage.CreatePresignedPutAsync(backupId, objectKey, TimeSpan.FromMinutes(30));
    return Results.Ok(new
    {
        backupId,
        uploadUrl,
        objectKey,
        headers = new Dictionary<string, string> { ["Content-Type"] = "application/octet-stream" }
    });
});

app.MapPut("/api/v1/backups/{backupId}/content", async (
    string backupId,
    HttpRequest http,
    CloudDbContext db,
    CryptoService crypto,
    ObjectStorageService storage,
    IConfiguration config) =>
{
    var auth = await InstallationAuth.RequireAsync(http, db, crypto);
    if (auth.Error is not null) return auth.Error;

    var backup = await db.Backups.FirstOrDefaultAsync(b =>
        b.Id == backupId && b.RestaurantId == auth.Installation!.RestaurantId);
    if (backup is null)
    {
        return Results.NotFound(new { error = "backup-not-found" });
    }

    var maxBytes = config.GetValue("Cloud:MaxUploadBytes", 512L * 1024 * 1024);
    if (http.ContentLength is long len && len > maxBytes)
    {
        return Results.BadRequest(new { error = "backup-too-large" });
    }

    try
    {
        // Buffer first — R2/S3 PutObject needs a seekable stream with known length.
        await using var buffer = new MemoryStream();
        await http.Body.CopyToAsync(buffer);
        if (buffer.Length > maxBytes)
        {
            return Results.BadRequest(new { error = "backup-too-large" });
        }
        buffer.Position = 0;
        await storage.SaveAsync(backup.ObjectKey, buffer);
        backup.Status = BackupStatuses.Stored;
        await db.SaveChangesAsync();
        return Results.Ok(new { ok = true });
    }
    catch (Exception ex)
    {
        return Results.Json(
            new { error = "cloud-upload-store-failed", detail = ex.Message },
            statusCode: StatusCodes.Status500InternalServerError);
    }
});

app.MapGet("/api/v1/backups/{backupId}/content", async (
    string backupId,
    HttpRequest http,
    CloudDbContext db,
    CryptoService crypto,
    ObjectStorageService storage) =>
{
    var auth = await InstallationAuth.RequireAsync(http, db, crypto);
    if (auth.Error is not null) return auth.Error;

    var backup = await db.Backups.FirstOrDefaultAsync(b =>
        b.Id == backupId
        && b.RestaurantId == auth.Installation!.RestaurantId
        && (b.Status == BackupStatuses.Verified || b.Status == BackupStatuses.Stored));
    if (backup is null)
    {
        return Results.NotFound(new { error = "backup-not-found" });
    }

    if (!await storage.ObjectExistsAsync(backup.ObjectKey))
    {
        return Results.NotFound(new { error = "object-missing" });
    }

    var stream = await storage.OpenReadAsync(backup.ObjectKey);
    return Results.File(stream, "application/octet-stream");
});

app.MapPost("/api/v1/backups/{backupId}/verify", async (
    string backupId,
    HttpRequest http,
    [FromBody] VerifyRequest request,
    CloudDbContext db,
    CryptoService crypto,
    ObjectStorageService storage) =>
{
    var auth = await InstallationAuth.RequireAsync(http, db, crypto);
    if (auth.Error is not null) return auth.Error;

    var backup = await db.Backups.FirstOrDefaultAsync(b =>
        b.Id == backupId && b.RestaurantId == auth.Installation!.RestaurantId);
    if (backup is null)
    {
        return Results.NotFound(new { error = "backup-not-found" });
    }

    if (!string.Equals(backup.Checksum, (request.Checksum ?? "").ToLowerInvariant(), StringComparison.Ordinal))
    {
        backup.Status = BackupStatuses.Failed;
        await db.SaveChangesAsync();
        return Results.BadRequest(new { error = "checksum-mismatch" });
    }

    if (!await storage.ObjectExistsAsync(backup.ObjectKey))
    {
        backup.Status = BackupStatuses.Failed;
        await db.SaveChangesAsync();
        return Results.BadRequest(new { error = "object-missing" });
    }

    backup.Status = BackupStatuses.Verified;
    backup.VerifiedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();

    var cutoff = DateTimeOffset.UtcNow;
    var candidates = await db.Backups
        .Where(b => b.RestaurantId == auth.Installation!.RestaurantId
                    && b.Status == BackupStatuses.Verified
                    && b.Id != backup.Id)
        .ToListAsync();
    var expired = candidates.Where(b => b.ExpiresAt != null && b.ExpiresAt < cutoff).ToList();
    foreach (var old in expired)
    {
        await storage.DeleteObjectAsync(old.ObjectKey);
        old.Status = BackupStatuses.Deleted;
    }
    if (expired.Count > 0)
    {
        await db.SaveChangesAsync();
    }

    return Results.Ok(new { ok = true, status = backup.Status });
});

app.MapGet("/api/v1/backups", async (HttpRequest http, CloudDbContext db, CryptoService crypto) =>
{
    var auth = await InstallationAuth.RequireAsync(http, db, crypto);
    if (auth.Error is not null) return auth.Error;

    var rows = await db.Backups
        .Where(b => b.RestaurantId == auth.Installation!.RestaurantId && b.Status == BackupStatuses.Verified)
        .ToListAsync();
    var items = rows
        .OrderByDescending(b => b.CreatedAt)
        .Select(b => new
        {
            id = b.Id,
            createdAt = b.CreatedAt,
            sizeBytes = b.EncryptedSize,
            checksum = b.Checksum,
            status = b.Status,
            installationId = b.InstallationId
        })
        .ToList();

    return Results.Ok(new { items });
});

app.MapGet("/api/v1/backups/{backupId}/download", async (
    string backupId,
    HttpRequest http,
    CloudDbContext db,
    CryptoService crypto,
    ObjectStorageService storage) =>
{
    var auth = await InstallationAuth.RequireAsync(http, db, crypto);
    if (auth.Error is not null) return auth.Error;

    var backup = await db.Backups.FirstOrDefaultAsync(b =>
        b.Id == backupId
        && b.RestaurantId == auth.Installation!.RestaurantId
        && b.Status == BackupStatuses.Verified);
    if (backup is null)
    {
        return Results.NotFound(new { error = "backup-not-found" });
    }

    var downloadUrl = await storage.CreatePresignedGetAsync(backup.Id, backup.ObjectKey, TimeSpan.FromMinutes(15));
    return Results.Ok(new
    {
        downloadUrl,
        checksum = backup.Checksum,
        sizeBytes = backup.EncryptedSize
    });
});

app.Run();

public partial class Program { }
