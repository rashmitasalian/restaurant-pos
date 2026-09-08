using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Norgerman.Cryptography.Scrypt;
using RestoNiti.CloudApi;
using Xunit;

public class CloudApiTests
{
    private static WebApplicationFactory<Program> CreateFactory()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"restoniti-cloud-test-{Guid.NewGuid():N}.db");
        var storagePath = Path.Combine(Path.GetTempPath(), $"restoniti-r2-test-{Guid.NewGuid():N}");
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            var contentRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", ".."));
            builder.UseContentRoot(contentRoot);
            builder.UseSetting("ConnectionStrings:CloudDb", $"Data Source={dbPath}");
            builder.UseSetting("Cloud:UseLocalFileStorage", "true");
            builder.UseSetting("Cloud:LocalStoragePath", storagePath);
        });
    }

    private static byte[] ScryptHash(string secret, byte[] salt) =>
        ScryptUtil.Scrypt(Encoding.UTF8.GetBytes(secret), salt, 131072, 8, 1, 64);

    [Fact]
    public async Task Activate_Upload_Verify_And_TenantIsolation()
    {
        await using var factory = CreateFactory();
        var client = factory.CreateClient();

        var recoveryKey = "ABCD-EFGH-IJKM-NPQR-STUV-WXYZ-2345-6789";
        var normalized = CryptoService.NormalizeRecoveryKey(recoveryKey);
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = ScryptHash(normalized, salt);
        var wrapped = Convert.ToBase64String(RandomNumberGenerator.GetBytes(60));

        var activate = await client.PostAsJsonAsync("/api/v1/cloud/activate", new
        {
            recoveryKeyVerifierAlgo = "SCRYPT-N131072-R8-P1",
            recoveryKeyVerifierSalt = Convert.ToHexString(salt).ToLowerInvariant(),
            recoveryKeyVerifierHash = Convert.ToHexString(hash).ToLowerInvariant(),
            wrappedBackupKey = wrapped,
            keyVersion = 1,
            appVersion = "0.6.0-test",
            deviceLabel = "test-a"
        });
        activate.EnsureSuccessStatusCode();
        var activated = await activate.Content.ReadFromJsonAsync<JsonElement>();
        var tokenA = activated.GetProperty("installationToken").GetString()!;
        var restaurantIdA = activated.GetProperty("restaurantId").GetString()!;

        var activateB = await client.PostAsJsonAsync("/api/v1/cloud/activate", new
        {
            recoveryKeyVerifierAlgo = "SCRYPT-N131072-R8-P1",
            recoveryKeyVerifierSalt = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant(),
            recoveryKeyVerifierHash = Convert.ToHexString(RandomNumberGenerator.GetBytes(64)).ToLowerInvariant(),
            wrappedBackupKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(60)),
            keyVersion = 1,
            appVersion = "0.6.0-test",
            deviceLabel = "test-b"
        });
        activateB.EnsureSuccessStatusCode();
        var activatedB = await activateB.Content.ReadFromJsonAsync<JsonElement>();
        var tokenB = activatedB.GetProperty("installationToken").GetString()!;

        var checksum = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("payload"))).ToLowerInvariant();
        using var intentReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/backups/upload-intent");
        intentReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        intentReq.Content = JsonContent.Create(new
        {
            checksum,
            originalSize = 10,
            compressedSize = 8,
            encryptedSize = 12,
            backupFormatVersion = 1,
            databaseSchemaVersion = 26,
            appVersion = "0.6.0-test",
            keyVersion = 1
        });
        var intentRes = await client.SendAsync(intentReq);
        intentRes.EnsureSuccessStatusCode();
        var intent = await intentRes.Content.ReadFromJsonAsync<JsonElement>();
        var backupId = intent.GetProperty("backupId").GetString()!;
        var uploadUrl = intent.GetProperty("uploadUrl").GetString()!;

        using var put = new HttpRequestMessage(HttpMethod.Put, uploadUrl);
        put.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        put.Content = new ByteArrayContent(Encoding.UTF8.GetBytes("encrypted-backup"));
        put.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        var putRes = await client.SendAsync(put);
        if (!putRes.IsSuccessStatusCode)
        {
            var body = await putRes.Content.ReadAsStringAsync();
            throw new Exception($"Upload failed {(int)putRes.StatusCode}: {body}");
        }

        using var verifyReq = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/backups/{backupId}/verify");
        verifyReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        verifyReq.Content = JsonContent.Create(new { checksum });
        var verifyRes = await client.SendAsync(verifyReq);
        if (!verifyRes.IsSuccessStatusCode)
        {
            var body = await verifyRes.Content.ReadAsStringAsync();
            throw new Exception($"Verify failed {(int)verifyRes.StatusCode}: {body}");
        }

        using var listB = new HttpRequestMessage(HttpMethod.Get, "/api/v1/backups");
        listB.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        var listBRes = await client.SendAsync(listB);
        listBRes.EnsureSuccessStatusCode();
        var listBBody = await listBRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(listBBody.GetProperty("items").EnumerateArray());

        using var steal = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/backups/{backupId}/download");
        steal.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        var stealRes = await client.SendAsync(steal);
        Assert.Equal(System.Net.HttpStatusCode.NotFound, stealRes.StatusCode);

        using var listA = new HttpRequestMessage(HttpMethod.Get, "/api/v1/backups");
        listA.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        var listARes = await client.SendAsync(listA);
        listARes.EnsureSuccessStatusCode();
        var listABody = await listARes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Single(listABody.GetProperty("items").EnumerateArray());
        Assert.Equal(restaurantIdA, activated.GetProperty("restaurantId").GetString());
    }

    [Fact]
    public async Task Recover_Requires_Valid_Recovery_Key_And_Issues_New_Installation()
    {
        await using var factory = CreateFactory();
        var client = factory.CreateClient();
        var recoveryKey = "ZZZZ-YYYY-XXXX-WWWW-VVVV-UUUU-TTTT-SSSS";
        var normalized = CryptoService.NormalizeRecoveryKey(recoveryKey);
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = ScryptHash(normalized, salt);

        var activate = await client.PostAsJsonAsync("/api/v1/cloud/activate", new
        {
            recoveryKeyVerifierAlgo = "SCRYPT-N131072-R8-P1",
            recoveryKeyVerifierSalt = Convert.ToHexString(salt).ToLowerInvariant(),
            recoveryKeyVerifierHash = Convert.ToHexString(hash).ToLowerInvariant(),
            wrappedBackupKey = Convert.ToBase64String(Encoding.UTF8.GetBytes("wrapped-key-bytes-here!!!!!!")),
            keyVersion = 1,
            appVersion = "0.6.0-test"
        });
        activate.EnsureSuccessStatusCode();
        var activated = await activate.Content.ReadFromJsonAsync<JsonElement>();
        var code = activated.GetProperty("restaurantCode").GetString()!;
        var oldInstallation = activated.GetProperty("installationId").GetString()!;

        var bad = await client.PostAsJsonAsync("/api/v1/cloud/recover", new
        {
            restaurantCode = code,
            recoveryKey = "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
            appVersion = "0.6.0-test"
        });
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, bad.StatusCode);

        var ok = await client.PostAsJsonAsync("/api/v1/cloud/recover", new
        {
            restaurantCode = code,
            recoveryKey,
            appVersion = "0.6.0-test"
        });
        ok.EnsureSuccessStatusCode();
        var recovered = await ok.Content.ReadFromJsonAsync<JsonElement>();
        Assert.NotEqual(oldInstallation, recovered.GetProperty("installationId").GetString());
        Assert.False(string.IsNullOrWhiteSpace(recovered.GetProperty("installationToken").GetString()));
        Assert.Equal(code, recovered.GetProperty("restaurantCode").GetString());
    }
}
