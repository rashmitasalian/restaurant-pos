using System.Security.Cryptography;
using System.Text;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Norgerman.Cryptography.Scrypt;

namespace RestoNiti.CloudApi;

public class CloudDbContext : DbContext
{
    public CloudDbContext(DbContextOptions<CloudDbContext> options) : base(options) { }

    public DbSet<Restaurant> Restaurants => Set<Restaurant>();
    public DbSet<Installation> Installations => Set<Installation>();
    public DbSet<RestaurantSecret> RestaurantSecrets => Set<RestaurantSecret>();
    public DbSet<BackupRecord> Backups => Set<BackupRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Restaurant>().HasKey(r => r.Id);
        modelBuilder.Entity<Restaurant>().HasIndex(r => r.Code).IsUnique();
        modelBuilder.Entity<Installation>().HasKey(i => i.Id);
        modelBuilder.Entity<Installation>().HasIndex(i => i.TokenHash);
        modelBuilder.Entity<RestaurantSecret>().HasKey(s => s.RestaurantId);
        modelBuilder.Entity<BackupRecord>().HasKey(b => b.Id);
        modelBuilder.Entity<BackupRecord>().HasIndex(b => new { b.RestaurantId, b.Status, b.CreatedAt });
    }
}

public class CryptoService
{
    public string HashSecret(string secret)
    {
        var salt = Encoding.UTF8.GetBytes("restoniti-installation-token-v1");
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(secret),
            salt,
            100_000,
            HashAlgorithmName.SHA256,
            32);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public bool VerifyScrypt(string secret, string saltHex, string expectedHashHex)
    {
        try
        {
            var salt = Convert.FromHexString(saltHex);
            var expected = Convert.FromHexString(expectedHashHex);
            // Match Node crypto.scryptSync N=2^17, r=8, p=1, keylen=64
            var actual = ScryptUtil.Scrypt(Encoding.UTF8.GetBytes(secret), salt, 131072, 8, 1, 64);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch
        {
            return false;
        }
    }

    public static string GenerateRestaurantCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        Span<char> chars = stackalloc char[8];
        chars[0] = 'R';
        chars[1] = 'N';
        chars[2] = '-';
        var bytes = RandomNumberGenerator.GetBytes(5);
        for (var i = 0; i < 5; i++)
        {
            chars[3 + i] = alphabet[bytes[i] % alphabet.Length];
        }
        return new string(chars);
    }

    public static string NormalizeRecoveryKey(string input)
    {
        return new string((input ?? string.Empty)
            .ToUpperInvariant()
            .Where(ch => char.IsLetterOrDigit(ch))
            .Select(ch => ch switch
            {
                'I' or 'L' => '1',
                'O' => '0',
                _ => ch
            })
            .ToArray());
    }

    public static string NewToken()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}

public class ObjectStorageService
{
    private readonly CloudOptions _options;
    private readonly IAmazonS3? _s3;

    public bool UsesR2 => _s3 is not null;

    public ObjectStorageService(IOptions<CloudOptions> options)
    {
        _options = options.Value;
        if (!_options.UseLocalFileStorage &&
            !string.IsNullOrWhiteSpace(_options.R2AccessKeyId) &&
            !string.IsNullOrWhiteSpace(_options.R2SecretAccessKey) &&
            !string.IsNullOrWhiteSpace(_options.R2Bucket))
        {
            var serviceUrl = string.IsNullOrWhiteSpace(_options.R2ServiceUrl)
                ? $"https://{_options.R2AccountId}.r2.cloudflarestorage.com"
                : _options.R2ServiceUrl.TrimEnd('/');
            var config = new AmazonS3Config
            {
                ServiceURL = serviceUrl,
                ForcePathStyle = true,
                AuthenticationRegion = "auto",
            };
            _s3 = new AmazonS3Client(_options.R2AccessKeyId, _options.R2SecretAccessKey, config);
        }
        else
        {
            Directory.CreateDirectory(_options.LocalStoragePath);
        }
    }

    public Task<string> CreatePresignedPutAsync(string backupId, string objectKey, TimeSpan expiry)
    {
        // Always upload via the API (Bearer). The API writes to R2 or local disk.
        // Avoids browser→R2 presigned PUT 401s from AWS SDK / R2 signature mismatches.
        _ = objectKey;
        _ = expiry;
        return Task.FromResult($"/api/v1/backups/{Uri.EscapeDataString(backupId)}/content");
    }

    public Task<string> CreatePresignedGetAsync(string backupId, string objectKey, TimeSpan expiry)
    {
        _ = objectKey;
        _ = expiry;
        return Task.FromResult($"/api/v1/backups/{Uri.EscapeDataString(backupId)}/content");
    }

    public async Task SaveAsync(string objectKey, Stream content)
    {
        if (_s3 is null)
        {
            var path = LocalPath(objectKey);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await using var file = File.Create(path);
            await content.CopyToAsync(file);
            return;
        }

        var put = new PutObjectRequest
        {
            BucketName = _options.R2Bucket,
            Key = objectKey,
            InputStream = content,
            ContentType = "application/octet-stream",
            AutoCloseStream = false,
            // Required for Cloudflare R2 (no Streaming SigV4 / default checksums).
            DisablePayloadSigning = true,
            DisableDefaultChecksumValidation = true,
        };
        if (content.CanSeek)
        {
            put.Headers.ContentLength = content.Length - content.Position;
        }
        await _s3.PutObjectAsync(put);
    }

    public async Task<bool> ObjectExistsAsync(string objectKey)
    {
        if (_s3 is null)
        {
            return File.Exists(LocalPath(objectKey));
        }

        try
        {
            await _s3.GetObjectMetadataAsync(_options.R2Bucket, objectKey);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task<Stream> OpenReadAsync(string objectKey)
    {
        if (_s3 is null)
        {
            return File.OpenRead(LocalPath(objectKey));
        }

        var response = await _s3.GetObjectAsync(_options.R2Bucket, objectKey);
        return response.ResponseStream;
    }

    public async Task DeleteObjectAsync(string objectKey)
    {
        if (_s3 is null)
        {
            var path = LocalPath(objectKey);
            if (File.Exists(path)) File.Delete(path);
            return;
        }

        await _s3.DeleteObjectAsync(_options.R2Bucket, objectKey);
    }

    private string LocalPath(string objectKey) =>
        Path.Combine(_options.LocalStoragePath, objectKey.Replace('/', Path.DirectorySeparatorChar));
}

public static class InstallationAuth
{
    public static async Task<(Installation? Installation, IResult? Error)> RequireAsync(
        HttpRequest http,
        CloudDbContext db,
        CryptoService crypto)
    {
        var header = http.Headers.Authorization.ToString();
        if (string.IsNullOrWhiteSpace(header) || !header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return (null, Results.Unauthorized());
        }

        var token = header["Bearer ".Length..].Trim();
        if (string.IsNullOrEmpty(token))
        {
            return (null, Results.Unauthorized());
        }

        var hash = crypto.HashSecret(token);
        var installation = await db.Installations.FirstOrDefaultAsync(i =>
            i.TokenHash == hash && i.RevokedAt == null);
        if (installation is null)
        {
            return (null, Results.Unauthorized());
        }

        return (installation, null);
    }
}
