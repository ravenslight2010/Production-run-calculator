using System.Globalization;
using System.Management;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Win32;

namespace RunCalculator.HostInspector;

[SupportedOSPlatform("windows")]
public sealed class WindowsHostFactsCollector : IHostFactsCollector
{
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(8);
    private readonly ICommandRunner _commands;

    public WindowsHostFactsCollector() : this(new ReadOnlyCommandRunner())
    {
    }

    internal WindowsHostFactsCollector(ICommandRunner commands) => _commands = commands;

    public HostFacts Collect()
    {
        var windows = ReadWindowsFacts();
        var computer = SafeQuery("SELECT Model, TotalPhysicalMemory, HypervisorPresent FROM Win32_ComputerSystem").FirstOrDefault();
        var processor = SafeQuery("SELECT Name, NumberOfLogicalProcessors, SecondLevelAddressTranslationExtensions, VirtualizationFirmwareEnabled FROM Win32_Processor").FirstOrDefault();
        var memory = ReadMemory();
        var installedMemory = ReadInstalledMemory();
        var systemDrive = ReadSystemDrive();

        return new HostFacts
        {
            IsWindows = true,
            WindowsEdition = windows.Edition,
            WindowsDisplayVersion = windows.DisplayVersion,
            WindowsBuild = windows.Build,
            WindowsUpdateBuildRevision = windows.UpdateBuildRevision,
            CpuName = StringValue(processor, "Name"),
            CpuArchitecture = RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant(),
            LogicalProcessorCount = IntValue(processor, "NumberOfLogicalProcessors") ?? Environment.ProcessorCount,
            SlatSupported = BoolValue(processor, "SecondLevelAddressTranslationExtensions"),
            VirtualizationFirmwareEnabled = BoolValue(processor, "VirtualizationFirmwareEnabled"),
            HypervisorPresent = BoolValue(computer, "HypervisorPresent"),
            TotalMemoryBytes = installedMemory ?? memory.Total ?? UInt64Value(computer, "TotalPhysicalMemory"),
            AvailableMemoryBytes = memory.Available,
            SystemDrive = systemDrive.Name,
            SystemDriveFreeBytes = systemDrive.FreeBytes,
            Gpus = ReadGpus(),
            Wsl = ReadWsl(),
            Docker = ReadDocker(),
            NetworkAvailable = ReadNetworkAvailability(),
            HttpPortsAvailable = ReadHttpPortAvailability(),
            PowerConnection = ReadPowerConnection(),
        };
    }

    private static WindowsFacts ReadWindowsFacts()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            var buildText = key?.GetValue("CurrentBuildNumber") as string ?? key?.GetValue("CurrentBuild") as string;
            return new WindowsFacts
            {
                Edition = key?.GetValue("EditionID") as string,
                DisplayVersion = key?.GetValue("DisplayVersion") as string ?? key?.GetValue("ReleaseId") as string,
                Build = int.TryParse(buildText, NumberStyles.None, CultureInfo.InvariantCulture, out var build) ? build : null,
                UpdateBuildRevision = Int32Value(key?.GetValue("UBR")),
            };
        }
        catch
        {
            return new WindowsFacts();
        }
    }

    private static (long? Total, long? Available) ReadMemory()
    {
        try
        {
            var status = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
            return GlobalMemoryStatusEx(ref status)
                ? (CheckedLong(status.TotalPhysical), CheckedLong(status.AvailablePhysical))
                : (null, null);
        }
        catch
        {
            return (null, null);
        }
    }

    private static long? ReadInstalledMemory()
    {
        try
        {
            var capacities = SafeQuery("SELECT Capacity FROM Win32_PhysicalMemory")
                .Select(row => UInt64Value(row, "Capacity"))
                .Where(value => value is > 0)
                .Select(value => value!.Value)
                .ToArray();
            if (capacities.Length == 0) return null;
            var total = capacities.Aggregate(0L, (sum, value) => checked(sum + value));
            return total;
        }
        catch
        {
            return null;
        }
    }

    private static (string? Name, long? FreeBytes) ReadSystemDrive()
    {
        try
        {
            var name = Path.GetPathRoot(Environment.SystemDirectory);
            if (string.IsNullOrWhiteSpace(name)) return (null, null);
            var drive = new DriveInfo(name);
            return (name, drive.IsReady ? drive.AvailableFreeSpace : null);
        }
        catch
        {
            return (null, null);
        }
    }

    private IReadOnlyList<GpuFacts> ReadGpus()
    {
        var gpus = SafeQuery("SELECT Name, AdapterRAM, DriverVersion FROM Win32_VideoController")
            .Select(row => new GpuFacts
            {
                Name = StringValue(row, "Name") ?? "Unknown display adapter",
                DriverVersion = StringValue(row, "DriverVersion"),
                VideoMemoryBytes = WmiVideoMemory(row),
                VideoMemorySource = WmiVideoMemory(row) is null ? null : "WMI AdapterRAM (approximate)",
            })
            .ToList();

        var nvidia = ReadNvidiaGpus();
        if (gpus.Count == 0) return nvidia;

        for (var index = 0; index < gpus.Count; index++)
        {
            var match = nvidia.FirstOrDefault(candidate => string.Equals(candidate.Name, gpus[index].Name, StringComparison.OrdinalIgnoreCase));
            if (match is null && nvidia.Count == 1 && gpus[index].Name.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase))
            {
                match = nvidia[0];
            }
            if (match is null) continue;

            gpus[index] = gpus[index] with
            {
                Name = match.Name,
                DriverVersion = match.DriverVersion ?? gpus[index].DriverVersion,
                VideoMemoryBytes = match.VideoMemoryBytes ?? gpus[index].VideoMemoryBytes,
                VideoMemorySource = match.VideoMemorySource ?? gpus[index].VideoMemorySource,
                NvidiaComputeCapability = match.NvidiaComputeCapability,
            };
        }
        return gpus;
    }

    private IReadOnlyList<GpuFacts> ReadNvidiaGpus()
    {
        var full = _commands.Run("nvidia-smi",
            ["--query-gpu=name,memory.total,driver_version,compute_cap", "--format=csv,noheader,nounits"], CommandTimeout);
        if (full.Started && full.ExitCode == 0)
        {
            return WindowsStatusParser.NvidiaCsv(full.StandardOutput);
        }

        var fallback = _commands.Run("nvidia-smi",
            ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"], CommandTimeout);
        return fallback.Started && fallback.ExitCode == 0
            ? WindowsStatusParser.NvidiaCsv(fallback.StandardOutput)
            : [];
    }

    private WslFacts ReadWsl()
    {
        var version = _commands.Run("wsl.exe", ["--version"], CommandTimeout);
        var status = _commands.Run("wsl.exe", ["--status"], CommandTimeout);
        return new WslFacts
        {
            CommandAvailable = version.Started || status.Started,
            Version = version.ExitCode == 0 ? WindowsStatusParser.WslVersion(version.StandardOutput) : null,
            DefaultVersion = status.ExitCode == 0 ? WindowsStatusParser.WslDefaultVersion(status.StandardOutput) : null,
        };
    }

    private DockerFacts ReadDocker()
    {
        var result = _commands.Run("docker", ["info", "--format", "{{.ServerVersion}}|{{.OSType}}|{{.Architecture}}"], CommandTimeout);
        if (!result.Started)
        {
            return new DockerFacts();
        }
        if (result.ExitCode != 0)
        {
            return new DockerFacts { CommandAvailable = true };
        }

        var fields = result.StandardOutput.Trim().Split('|');
        return new DockerFacts
        {
            CommandAvailable = true,
            ServerResponding = true,
            ServerVersion = Field(fields, 0),
            ServerOperatingSystem = Field(fields, 1),
            ServerArchitecture = Field(fields, 2),
        };
    }

    private static bool? ReadNetworkAvailability()
    {
        try
        {
            return NetworkInterface.GetIsNetworkAvailable();
        }
        catch
        {
            return null;
        }
    }

    private static bool? ReadHttpPortAvailability()
    {
        try
        {
            var listeners = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners();
            return !listeners.Any(endpoint => endpoint.Port is 80 or 443);
        }
        catch
        {
            return null;
        }
    }

    private static PowerConnection ReadPowerConnection()
    {
        try
        {
            if (!GetSystemPowerStatus(out var status)) return PowerConnection.Unknown;
            return status.AcLineStatus switch
            {
                0 => PowerConnection.Offline,
                1 => PowerConnection.Online,
                _ => PowerConnection.Unknown,
            };
        }
        catch
        {
            return PowerConnection.Unknown;
        }
    }

    private static IReadOnlyList<IReadOnlyDictionary<string, object?>> SafeQuery(string query)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(query);
            using var results = searcher.Get();
            var rows = new List<IReadOnlyDictionary<string, object?>>();
            foreach (ManagementObject result in results)
            {
                using (result)
                {
                    var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                    foreach (var property in result.Properties)
                    {
                        row[property.Name] = property.Value;
                    }
                    rows.Add(row);
                }
            }
            return rows;
        }
        catch
        {
            return [];
        }
    }

    private static long? WmiVideoMemory(IReadOnlyDictionary<string, object?> row)
    {
        var bytes = UInt64Value(row, "AdapterRAM");
        return bytes is null or 0 or uint.MaxValue ? null : bytes.Value;
    }

    private static string? StringValue(IReadOnlyDictionary<string, object?>? row, string key) =>
        row is not null && row.TryGetValue(key, out var value) ? value?.ToString() : null;

    private static bool? BoolValue(IReadOnlyDictionary<string, object?>? row, string key) =>
        row is not null && row.TryGetValue(key, out var value) && value is not null ? Convert.ToBoolean(value, CultureInfo.InvariantCulture) : null;

    private static int? IntValue(IReadOnlyDictionary<string, object?>? row, string key)
    {
        var value = UInt64Value(row, key);
        return value is <= int.MaxValue ? (int)value.Value : null;
    }

    private static long? UInt64Value(IReadOnlyDictionary<string, object?>? row, string key) =>
        row is not null && row.TryGetValue(key, out var value) && value is not null
            ? CheckedLong(Convert.ToUInt64(value, CultureInfo.InvariantCulture))
            : null;

    private static int? Int32Value(object? value)
    {
        if (value is null) return null;
        try { return Convert.ToInt32(value, CultureInfo.InvariantCulture); }
        catch { return null; }
    }

    private static long? CheckedLong(ulong value) => value <= long.MaxValue ? (long)value : null;

    private static string? Field(string[] fields, int index) =>
        fields.Length > index && !string.IsNullOrWhiteSpace(fields[index]) ? fields[index].Trim() : null;

    private sealed record WindowsFacts
    {
        public string? Edition { get; init; }
        public string? DisplayVersion { get; init; }
        public int? Build { get; init; }
        public int? UpdateBuildRevision { get; init; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhysical;
        public ulong AvailablePhysical;
        public ulong TotalPageFile;
        public ulong AvailablePageFile;
        public ulong TotalVirtual;
        public ulong AvailableVirtual;
        public ulong AvailableExtendedVirtual;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SystemPowerStatus
    {
        public byte AcLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte SystemStatusFlag;
        public uint BatteryLifeTime;
        public uint BatteryFullLifeTime;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);
}
