namespace RunCalculator.HostInspector.Tests;

internal static class TestHosts
{
    private const long GiB = 1024L * 1024 * 1024;

    public static HostFacts Pavilion12GiB() => new()
    {
        IsWindows = true,
        WindowsEdition = "Professional",
        WindowsDisplayVersion = "22H2",
        WindowsBuild = 19045,
        WindowsUpdateBuildRevision = 6575,
        CpuName = "Example dual-core 2.5 GHz processor",
        CpuArchitecture = "x64",
        LogicalProcessorCount = 4,
        SlatSupported = true,
        VirtualizationFirmwareEnabled = true,
        HypervisorPresent = false,
        TotalMemoryBytes = 12 * GiB,
        AvailableMemoryBytes = 9 * GiB,
        SystemDrive = "C:\\",
        SystemDriveFreeBytes = 120 * GiB,
        Gpus =
        [
            new GpuFacts
            {
                Name = "NVIDIA GeForce example",
                DriverVersion = "example-driver",
                VideoMemoryBytes = 6 * GiB,
                VideoMemorySource = "nvidia-smi",
                NvidiaComputeCapability = "8.9",
            },
        ],
        Wsl = new WslFacts { CommandAvailable = true, Version = "2.6.1.0", DefaultVersion = 2 },
        Docker = new DockerFacts
        {
            CommandAvailable = true,
            ServerResponding = true,
            ServerVersion = "example",
            ServerOperatingSystem = "linux",
            ServerArchitecture = "x86_64",
        },
        NetworkAvailable = true,
        HttpPortsAvailable = true,
        PowerConnection = PowerConnection.Online,
    };

    public static long Gib(long value) => value * GiB;
}
