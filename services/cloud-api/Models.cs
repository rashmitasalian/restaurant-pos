namespace RestoNiti.CloudApi;

public class CloudOptions
{
    public string? R2AccountId { get; set; }
    public string? R2AccessKeyId { get; set; }
    public string? R2SecretAccessKey { get; set; }
    public string? R2Bucket { get; set; }
    public string? R2ServiceUrl { get; set; }
    public bool UseLocalFileStorage { get; set; } = true;
    public string LocalStoragePath { get; set; } = "local-r2";
    public long MaxUploadBytes { get; set; } = 512L * 1024 * 1024;
    public int RetentionDays { get; set; } = 14;
}

public class Restaurant
{
    public string Id { get; set; } = "";
    public string Code { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}

public class Installation
{
    public string Id { get; set; } = "";
    public string RestaurantId { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public string? AppVersion { get; set; }
    public string? DeviceLabel { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}

public class RestaurantSecret
{
    public string RestaurantId { get; set; } = "";
    public string RecoveryVerifierAlgo { get; set; } = "";
    public string RecoveryVerifierSalt { get; set; } = "";
    public string RecoveryVerifierHash { get; set; } = "";
    public string WrappedBackupKey { get; set; } = "";
    public int KeyVersion { get; set; } = 1;
}

public static class BackupStatuses
{
    public const string Uploading = "Uploading";
    public const string Stored = "Stored";
    public const string Verified = "Verified";
    public const string Failed = "Failed";
    public const string Deleted = "Deleted";
}

public class BackupRecord
{
    public string Id { get; set; } = "";
    public string RestaurantId { get; set; } = "";
    public string InstallationId { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public string? AppVersion { get; set; }
    public int DatabaseSchemaVersion { get; set; }
    public int BackupFormatVersion { get; set; }
    public long OriginalSize { get; set; }
    public long CompressedSize { get; set; }
    public long EncryptedSize { get; set; }
    public string Checksum { get; set; } = "";
    public string ObjectKey { get; set; } = "";
    public string Status { get; set; } = BackupStatuses.Uploading;
    public DateTimeOffset? VerifiedAt { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public int KeyVersion { get; set; } = 1;
}

public record ActivateRequest(
    string? RecoveryKeyVerifierAlgo,
    string RecoveryKeyVerifierSalt,
    string RecoveryKeyVerifierHash,
    string WrappedBackupKey,
    int KeyVersion,
    string? AppVersion,
    string? DeviceLabel);

public record ActivateResponse(
    string RestaurantId,
    string InstallationId,
    string DeviceId,
    string RestaurantCode,
    string InstallationToken);

public record RecoverRequest(
    string RestaurantCode,
    string RecoveryKey,
    string? AppVersion,
    string? DeviceLabel);

public record RecoverResponse(
    string RestaurantId,
    string InstallationId,
    string DeviceId,
    string RestaurantCode,
    string InstallationToken,
    string WrappedBackupKey,
    int KeyVersion);

public record UploadIntentRequest(
    string Checksum,
    long OriginalSize,
    long CompressedSize,
    long EncryptedSize,
    int BackupFormatVersion,
    int DatabaseSchemaVersion,
    string? AppVersion,
    int KeyVersion);

public record VerifyRequest(string Checksum);
