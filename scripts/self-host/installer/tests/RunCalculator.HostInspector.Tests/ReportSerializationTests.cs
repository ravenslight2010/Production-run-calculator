using System.Text.Json;
using Xunit;

namespace RunCalculator.HostInspector.Tests;

public sealed class ReportSerializationTests
{
    [Fact]
    public void JsonUsesStableStatesAndExplicitInspectionOnlyBoundary()
    {
        var report = HostInspector.Inspect(TestHosts.Pavilion12GiB(), new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero));
        var json = ReportJson.Serialize(report);
        using var document = JsonDocument.Parse(json);

        Assert.True(document.RootElement.GetProperty("inspectionOnly").GetBoolean());
        Assert.Equal("warn", document.RootElement.GetProperty("overallStatus").GetString());
        Assert.Equal("candidate", document.RootElement.GetProperty("ai").GetProperty("status").GetString());
        Assert.Equal("unmeasured", document.RootElement.GetProperty("ai").GetProperty("qualification").GetString());
        Assert.Equal("notQualified", document.RootElement.GetProperty("ai").GetProperty("visionOcr").GetString());
    }

    [Fact]
    public void ReportSchemaContainsNoHostIdentityOrRawCommandChannels()
    {
        var json = ReportJson.Serialize(HostInspector.Inspect(TestHosts.Pavilion12GiB(), DateTimeOffset.UnixEpoch));
        Assert.DoesNotContain("machineName", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("computerName", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("serialNumber", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("macAddress", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("ipAddress", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("standardOutput", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("standardError", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("exception", json, StringComparison.OrdinalIgnoreCase);
    }
}
