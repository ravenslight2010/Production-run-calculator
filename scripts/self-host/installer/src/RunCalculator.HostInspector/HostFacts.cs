namespace RunCalculator.HostInspector;

public sealed record HostFacts
{
    public bool IsWindows { get; init; }

    public string? WindowsEdition { get; init; }

    public string? WindowsDisplayVersion { get; init; }

    public int? WindowsBuild { get; init; }

    public int? WindowsUpdateBuildRevision { get; init; }

    public string? CpuName { get; init; }

    public string? CpuArchitecture { get; init; }

    public int? LogicalProcessorCount { get; init; }

    public bool? SlatSupported { get; init; }

    public bool? VirtualizationFirmwareEnabled { get; init; }

    public bool? HypervisorPresent { get; init; }

    public long? TotalMemoryBytes { get; init; }

    public long? AvailableMemoryBytes { get; init; }

    public string? SystemDrive { get; init; }

    public long? SystemDriveFreeBytes { get; init; }

    public IReadOnlyList<GpuFacts> Gpus { get; init; } = [];

    public WslFacts Wsl { get; init; } = new();

    public DockerFacts Docker { get; init; } = new();

    public bool? NetworkAvailable { get; init; }

    public bool? HttpPortsAvailable { get; init; }

    public PowerConnection PowerConnection { get; init; } = PowerConnection.Unknown;
}

public sealed record GpuFacts
{
    public required string Name { get; init; }

    public string? DriverVersion { get; init; }

    public long? VideoMemoryBytes { get; init; }

    public string? VideoMemorySource { get; init; }

    public string? NvidiaComputeCapability { get; init; }
}

public sealed record WslFacts
{
    public bool CommandAvailable { get; init; }

    public string? Version { get; init; }

    public int? DefaultVersion { get; init; }
}

public sealed record DockerFacts
{
    public bool CommandAvailable { get; init; }

    public bool ServerResponding { get; init; }

    public string? ServerVersion { get; init; }

    public string? ServerOperatingSystem { get; init; }

    public string? ServerArchitecture { get; init; }
}

public enum PowerConnection
{
    Unknown,
    Online,
    Offline,
}
