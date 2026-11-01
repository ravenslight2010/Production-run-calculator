using Xunit;

namespace RunCalculator.HostInspector.Tests;

public sealed class CompatibilityEvaluatorTests
{
    [Fact]
    public void PavilionProfilePassesPlatformButKeepsServicingAndGpuWarningsVisible()
    {
        var checks = Evaluate(TestHosts.Pavilion12GiB());

        Assert.Equal(InspectionStatus.Pass, Status(checks, "windows-platform"));
        Assert.Equal(InspectionStatus.Warn, Status(checks, "windows-servicing"));
        Assert.Equal(InspectionStatus.Unknown, Status(checks, "gpu-container-access"));
        Assert.Equal(InspectionStatus.Warn, CompatibilityEvaluator.Overall(checks));
    }

    [Theory]
    [InlineData("Core")]
    [InlineData("Windows 10 Home")]
    [InlineData("CoreSingleLanguage")]
    public void WindowsHomeIsBlockedForIntendedDockerDesktopPath(string edition)
    {
        var host = TestHosts.Pavilion12GiB() with { WindowsEdition = edition };
        Assert.Equal(InspectionStatus.Blocked, Status(Evaluate(host), "windows-platform"));
    }

    [Fact]
    public void Pre22H2Windows10IsBlocked()
    {
        var host = TestHosts.Pavilion12GiB() with { WindowsBuild = 19044, WindowsDisplayVersion = "21H2" };
        Assert.Equal(InspectionStatus.Blocked, Status(Evaluate(host), "windows-platform"));
    }

    [Fact]
    public void Windows11PlatformPassDoesNotInventServicingQualification()
    {
        var host = TestHosts.Pavilion12GiB() with { WindowsBuild = 26100, WindowsDisplayVersion = "24H2" };
        var checks = Evaluate(host);
        Assert.Equal(InspectionStatus.Pass, Status(checks, "windows-platform"));
        Assert.Equal(InspectionStatus.Unknown, Status(checks, "windows-servicing"));
    }

    [Fact]
    public void MissingPlatformFactsStayUnknown()
    {
        var host = TestHosts.Pavilion12GiB() with { WindowsBuild = null, WindowsEdition = null };
        Assert.Equal(InspectionStatus.Unknown, Status(Evaluate(host), "windows-platform"));
    }

    [Fact]
    public void MemoryBoundariesDistinguishDockerMinimumFromConservativeTarget()
    {
        var eight = TestHosts.Pavilion12GiB() with { TotalMemoryBytes = TestHosts.Gib(8) };
        var six = TestHosts.Pavilion12GiB() with { TotalMemoryBytes = TestHosts.Gib(6) };
        Assert.Equal(InspectionStatus.Warn, Status(Evaluate(eight), "installed-memory"));
        Assert.Equal(InspectionStatus.Blocked, Status(Evaluate(six), "installed-memory"));
    }

    [Fact]
    public void HypervisorCanEstablishVirtualizationWhenFirmwareFlagIsMasked()
    {
        var host = TestHosts.Pavilion12GiB() with { VirtualizationFirmwareEnabled = false, HypervisorPresent = true };
        Assert.Equal(InspectionStatus.Pass, Status(Evaluate(host), "cpu-virtualization"));
    }

    [Fact]
    public void DisabledVirtualizationIsBlocked()
    {
        var host = TestHosts.Pavilion12GiB() with { VirtualizationFirmwareEnabled = false, HypervisorPresent = false };
        Assert.Equal(InspectionStatus.Blocked, Status(Evaluate(host), "cpu-virtualization"));
    }

    [Fact]
    public void WindowsContainersAreBlockedAndMissingDockerIsOnlyPrerequisiteWarning()
    {
        var windows = TestHosts.Pavilion12GiB() with
        {
            Docker = new DockerFacts { CommandAvailable = true, ServerResponding = true, ServerOperatingSystem = "windows" },
        };
        var missing = TestHosts.Pavilion12GiB() with { Docker = new DockerFacts() };
        Assert.Equal(InspectionStatus.Blocked, Status(Evaluate(windows), "docker"));
        Assert.Equal(InspectionStatus.Warn, Status(Evaluate(missing), "docker"));
    }

    [Fact]
    public void OccupiedHttpPortIsVisibleWithoutReservingOrChangingIt()
    {
        var host = TestHosts.Pavilion12GiB() with { HttpPortsAvailable = false };
        Assert.Equal(InspectionStatus.Warn, Status(Evaluate(host), "https-ports"));
    }

    [Fact]
    public void OldWslNeedsPrerequisiteWorkRatherThanPassing()
    {
        var host = TestHosts.Pavilion12GiB() with
        {
            Wsl = new WslFacts { CommandAvailable = true, Version = "2.0.14.0", DefaultVersion = 2 },
        };
        Assert.Equal(InspectionStatus.Warn, Status(Evaluate(host), "wsl2"));
    }

    [Fact]
    public void NonWindowsHostIsBlockedWithoutPretendingOtherChecksRan()
    {
        var checks = Evaluate(new HostFacts { IsWindows = false });
        var check = Assert.Single(checks);
        Assert.Equal("windows-platform", check.Id);
        Assert.Equal(InspectionStatus.Blocked, check.Status);
    }

    [Fact]
    public void EmptyCheckSetCannotProducePass()
    {
        Assert.Equal(InspectionStatus.Unknown, CompatibilityEvaluator.Overall([]));
    }

    private static IReadOnlyList<CheckResult> Evaluate(HostFacts host) => CompatibilityEvaluator.Evaluate(host);

    private static InspectionStatus Status(IReadOnlyList<CheckResult> checks, string id) =>
        Assert.Single(checks, check => check.Id == id).Status;
}
