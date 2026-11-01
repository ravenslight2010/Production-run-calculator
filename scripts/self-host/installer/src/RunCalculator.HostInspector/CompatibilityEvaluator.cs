namespace RunCalculator.HostInspector;

public static class CompatibilityEvaluator
{
    private const long EightGiB = 8L * 1024 * 1024 * 1024;
    private const long TwelveGiB = 12L * 1024 * 1024 * 1024;
    private const long FiftyGiB = 50L * 1024 * 1024 * 1024;
    private const long HundredGiB = 100L * 1024 * 1024 * 1024;

    public static IReadOnlyList<CheckResult> Evaluate(HostFacts host)
    {
        if (!host.IsWindows)
        {
            return [Check("windows-platform", InspectionStatus.Blocked,
                "The Docker Desktop/WSL2 server-installer path requires Windows; this host is not Windows.")];
        }

        return
        [
            EvaluateWindowsPlatform(host),
            EvaluateWindowsServicing(host),
            EvaluateCpuArchitecture(host),
            EvaluateVirtualization(host),
            EvaluateInstalledMemory(host),
            EvaluateAvailableMemory(host),
            EvaluateDisk(host),
            EvaluateWsl(host.Wsl),
            EvaluateDocker(host.Docker),
            EvaluateNetwork(host.NetworkAvailable),
            EvaluateHttpPorts(host.HttpPortsAvailable),
            EvaluatePower(host.PowerConnection),
            EvaluateGpuContainerAccess(host.Gpus),
        ];
    }

    public static InspectionStatus Overall(IEnumerable<CheckResult> checks)
    {
        var statuses = checks.Select(check => check.Status).ToArray();
        if (statuses.Length == 0) return InspectionStatus.Unknown;
        if (statuses.Contains(InspectionStatus.Blocked)) return InspectionStatus.Blocked;
        if (statuses.Contains(InspectionStatus.Warn)) return InspectionStatus.Warn;
        if (statuses.Contains(InspectionStatus.Unknown)) return InspectionStatus.Unknown;
        return InspectionStatus.Pass;
    }

    private static CheckResult EvaluateWindowsPlatform(HostFacts host)
    {
        if (host.WindowsBuild is null || string.IsNullOrWhiteSpace(host.WindowsEdition))
        {
            return Check("windows-platform", InspectionStatus.Unknown,
                "Windows edition or build could not be determined; Docker Desktop support is not established.");
        }

        if (IsHomeEdition(host.WindowsEdition))
        {
            return Check("windows-platform", InspectionStatus.Blocked,
                "Windows Home is not on the intended Docker Desktop server path; use a supported Pro, Enterprise, or Education edition.",
                $"Detected edition: {host.WindowsEdition}.");
        }

        if (!IsSupportedBusinessEdition(host.WindowsEdition))
        {
            return Check("windows-platform", InspectionStatus.Unknown,
                "The Windows edition is not recognized by the phase-1 Docker Desktop support policy.",
                $"Detected edition: {host.WindowsEdition}.");
        }

        if (host.WindowsBuild == 19045)
        {
            return Check("windows-platform", InspectionStatus.Pass,
                "Windows 10 22H2 (build 19045) meets the Docker Desktop edition/build baseline.",
                $"Detected edition: {host.WindowsEdition}; display version: {host.WindowsDisplayVersion ?? "unknown"}.");
        }

        if (host.WindowsBuild >= 22000)
        {
            return Check("windows-platform", InspectionStatus.Pass,
                "The Windows 11 edition/build meets the phase-1 platform baseline; servicing still requires verification.",
                $"Detected edition: {host.WindowsEdition}; build: {host.WindowsBuild}.");
        }

        return Check("windows-platform", InspectionStatus.Blocked,
            "Docker Desktop requires Windows 10 22H2 build 19045 or a supported Windows 11 release on this installer path.",
            $"Detected build: {host.WindowsBuild}.");
    }

    private static CheckResult EvaluateWindowsServicing(HostFacts host)
    {
        if (host.WindowsBuild == 19045)
        {
            return Check("windows-servicing", InspectionStatus.Warn,
                "Windows 10 general support ended on 2025-10-14; verify active ESU/security servicing before using the host.",
                "The inspector does not infer ESU enrollment from edition or build.");
        }

        if (host.WindowsBuild >= 22000)
        {
            return Check("windows-servicing", InspectionStatus.Unknown,
                "Windows servicing state was not verified; Docker supports Windows releases only within Microsoft's servicing timeline.");
        }

        return Check("windows-servicing", InspectionStatus.Unknown,
            "Windows servicing state is unavailable or irrelevant because the platform baseline is not met.");
    }

    private static CheckResult EvaluateCpuArchitecture(HostFacts host)
    {
        if (string.IsNullOrWhiteSpace(host.CpuArchitecture))
        {
            return Check("cpu-architecture", InspectionStatus.Unknown, "CPU architecture could not be determined.");
        }

        return string.Equals(host.CpuArchitecture, "x64", StringComparison.OrdinalIgnoreCase)
            ? Check("cpu-architecture", InspectionStatus.Pass, "The host has an x64 CPU architecture.", host.CpuName ?? "CPU name unavailable.")
            : Check("cpu-architecture", InspectionStatus.Blocked, "The phase-1 Docker/model policy requires an x64 CPU.", $"Detected architecture: {host.CpuArchitecture}.");
    }

    private static CheckResult EvaluateVirtualization(HostFacts host)
    {
        if (host.SlatSupported is null || (host.VirtualizationFirmwareEnabled is null && host.HypervisorPresent is null))
        {
            return Check("cpu-virtualization", InspectionStatus.Unknown,
                "SLAT or hardware-virtualization state could not be determined.");
        }

        if (host.SlatSupported == false)
        {
            return Check("cpu-virtualization", InspectionStatus.Blocked,
                "The CPU does not report Second Level Address Translation (SLAT), required by the WSL2 path.");
        }

        if (host.VirtualizationFirmwareEnabled == true || host.HypervisorPresent == true)
        {
            return Check("cpu-virtualization", InspectionStatus.Pass,
                "SLAT and hardware virtualization (or an active hypervisor) are reported.");
        }

        return Check("cpu-virtualization", InspectionStatus.Blocked,
            "Hardware virtualization is not enabled; enable it in firmware before WSL2 can be qualified.");
    }

    private static CheckResult EvaluateInstalledMemory(HostFacts host)
    {
        if (host.TotalMemoryBytes is null)
        {
            return Check("installed-memory", InspectionStatus.Unknown, "Installed physical memory could not be determined.");
        }

        if (host.TotalMemoryBytes >= TwelveGiB)
        {
            return Check("installed-memory", InspectionStatus.Pass,
                "Installed RAM meets the conservative 12 GiB host target.", FormatBytes(host.TotalMemoryBytes.Value));
        }

        if (host.TotalMemoryBytes >= EightGiB)
        {
            return Check("installed-memory", InspectionStatus.Warn,
                "Installed RAM meets Docker's documented 8 GiB minimum but is below the conservative 12 GiB host target.",
                FormatBytes(host.TotalMemoryBytes.Value));
        }

        return Check("installed-memory", InspectionStatus.Blocked,
            "Installed RAM is below Docker Desktop's documented 8 GiB minimum.", FormatBytes(host.TotalMemoryBytes.Value));
    }

    private static CheckResult EvaluateAvailableMemory(HostFacts host)
    {
        if (host.AvailableMemoryBytes is null)
        {
            return Check("available-memory", InspectionStatus.Unknown, "Currently available physical memory could not be determined.");
        }

        return host.AvailableMemoryBytes >= EightGiB
            ? Check("available-memory", InspectionStatus.Pass, "At least 8 GiB RAM is currently available.", FormatBytes(host.AvailableMemoryBytes.Value))
            : Check("available-memory", InspectionStatus.Warn,
                "Less than 8 GiB RAM is currently available; remeasure with normal services running before selecting a model.",
                FormatBytes(host.AvailableMemoryBytes.Value));
    }

    private static CheckResult EvaluateDisk(HostFacts host)
    {
        if (host.SystemDriveFreeBytes is null)
        {
            return Check("system-disk", InspectionStatus.Unknown, "Free space on the Windows system drive could not be determined.");
        }

        if (host.SystemDriveFreeBytes >= HundredGiB)
        {
            return Check("system-disk", InspectionStatus.Pass, "At least 100 GiB is free for images, application data, and future models.",
                $"{host.SystemDrive ?? "System drive"}: {FormatBytes(host.SystemDriveFreeBytes.Value)} free.");
        }

        if (host.SystemDriveFreeBytes >= FiftyGiB)
        {
            return Check("system-disk", InspectionStatus.Warn, "Free disk space is below the conservative 100 GiB target.",
                $"{host.SystemDrive ?? "System drive"}: {FormatBytes(host.SystemDriveFreeBytes.Value)} free.");
        }

        return Check("system-disk", InspectionStatus.Blocked, "Less than 50 GiB is free on the system drive.",
            $"{host.SystemDrive ?? "System drive"}: {FormatBytes(host.SystemDriveFreeBytes.Value)} free.");
    }

    private static CheckResult EvaluateWsl(WslFacts wsl)
    {
        if (!wsl.CommandAvailable)
        {
            return Check("wsl2", InspectionStatus.Warn,
                "WSL was not detected. A later consented prerequisite phase must install/configure it; no change was made now.");
        }

        if (wsl.Version is null || wsl.DefaultVersion is null)
        {
            return Check("wsl2", InspectionStatus.Unknown,
                "WSL is present, but its version or default WSL generation could not be parsed reliably.");
        }

        if (!Version.TryParse(wsl.Version, out var version))
        {
            return Check("wsl2", InspectionStatus.Unknown, "The WSL version was not recognized.", wsl.Version);
        }

        if (version < new Version(2, 1, 5))
        {
            return Check("wsl2", InspectionStatus.Warn, "WSL is below Docker Desktop's 2.1.5 minimum.", $"Detected WSL version: {wsl.Version}.");
        }

        return wsl.DefaultVersion == 2
            ? Check("wsl2", InspectionStatus.Pass, "WSL meets the version baseline and defaults to WSL2.", $"Detected WSL version: {wsl.Version}.")
            : Check("wsl2", InspectionStatus.Warn, "WSL does not default to generation 2.", $"Detected default generation: {wsl.DefaultVersion}.");
    }

    private static CheckResult EvaluateDocker(DockerFacts docker)
    {
        if (!docker.CommandAvailable)
        {
            return Check("docker", InspectionStatus.Warn,
                "Docker was not detected. A later consented prerequisite phase must install it; no change was made now.");
        }

        if (!docker.ServerResponding)
        {
            return Check("docker", InspectionStatus.Warn,
                "Docker is installed but its Linux server did not respond to the read-only status query.");
        }

        if (string.Equals(docker.ServerOperatingSystem, "windows", StringComparison.OrdinalIgnoreCase))
        {
            return Check("docker", InspectionStatus.Blocked,
                "Docker is using Windows containers; the self-host stack requires Linux containers.");
        }

        if (!string.Equals(docker.ServerOperatingSystem, "linux", StringComparison.OrdinalIgnoreCase))
        {
            return Check("docker", InspectionStatus.Unknown, "Docker responded, but its container operating system was not established.");
        }

        return Check("docker", InspectionStatus.Pass, "Docker is responding with a Linux container server.",
            $"Server version: {docker.ServerVersion ?? "unknown"}; architecture: {docker.ServerArchitecture ?? "unknown"}.");
    }

    private static CheckResult EvaluateNetwork(bool? available) => available switch
    {
        true => Check("network", InspectionStatus.Pass, "Windows reports that a network is available."),
        false => Check("network", InspectionStatus.Warn, "No network is currently available; initial downloads and LAN clients require connectivity."),
        null => Check("network", InspectionStatus.Unknown, "Network availability could not be determined."),
    };

    private static CheckResult EvaluateHttpPorts(bool? available) => available switch
    {
        true => Check("https-ports", InspectionStatus.Pass, "No existing TCP listener was detected on port 80 or 443; no port was reserved."),
        false => Check("https-ports", InspectionStatus.Warn, "Port 80 or 443 already has a TCP listener; resolve the conflict before starting Caddy."),
        null => Check("https-ports", InspectionStatus.Unknown, "TCP listener state for ports 80 and 443 could not be determined."),
    };

    private static CheckResult EvaluatePower(PowerConnection power) => power switch
    {
        PowerConnection.Online => Check("power", InspectionStatus.Pass, "The host reports AC power."),
        PowerConnection.Offline => Check("power", InspectionStatus.Warn, "The host is on battery; connect AC power before installation or benchmarks."),
        _ => Check("power", InspectionStatus.Unknown, "AC/battery state could not be determined."),
    };

    private static CheckResult EvaluateGpuContainerAccess(IReadOnlyList<GpuFacts> gpus)
    {
        var evidence = gpus.Count == 0
            ? ["No display-adapter facts were collected."]
            : gpus.Select(gpu => $"{gpu.Name}; VRAM: {(gpu.VideoMemoryBytes is long bytes ? FormatBytes(bytes) : "unknown")}; driver: {gpu.DriverVersion ?? "unknown"}.").ToArray();
        return Check("gpu-container-access", InspectionStatus.Unknown,
            "Phase 1 does not probe WSL2/Docker/Ollama GPU execution; Windows GPU detection alone is not acceleration evidence.",
            evidence);
    }

    private static bool IsHomeEdition(string edition) =>
        edition.Contains("home", StringComparison.OrdinalIgnoreCase) ||
        edition.StartsWith("Core", StringComparison.OrdinalIgnoreCase);

    private static bool IsSupportedBusinessEdition(string edition) =>
        edition.Contains("Professional", StringComparison.OrdinalIgnoreCase) ||
        edition.Contains("Enterprise", StringComparison.OrdinalIgnoreCase) ||
        edition.Contains("Education", StringComparison.OrdinalIgnoreCase) ||
        edition.Contains("Pro", StringComparison.OrdinalIgnoreCase);

    private static string FormatBytes(long bytes) => $"{bytes / (1024d * 1024 * 1024):F1} GiB";

    private static CheckResult Check(string id, InspectionStatus status, string summary, params string[] evidence) => new()
    {
        Id = id,
        Status = status,
        Summary = summary,
        Evidence = evidence,
    };
}
