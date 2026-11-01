using Xunit;

namespace RunCalculator.HostInspector.Tests;

public sealed class WindowsStatusParserTests
{
    [Fact]
    public void ParsesWslVersionAndDefaultGenerationIncludingUtf16Nulls()
    {
        var version = "W\0S\0L\0 \0v\0e\0r\0s\0i\0o\0n\0:\0 \02\0.\06\0.\01\0.\00\0";
        Assert.Equal("2.6.1.0", WindowsStatusParser.WslVersion(version));
        Assert.Equal(2, WindowsStatusParser.WslDefaultVersion("Default Version: 2\r\n"));
    }

    [Fact]
    public void ParsesQuotedNvidiaCsvWithoutTreatingGpuNameCommaAsDelimiter()
    {
        var gpus = WindowsStatusParser.NvidiaCsv("\"NVIDIA GeForce RTX 4060, Laptop GPU\", 6144, 580.1, 8.9\r\n");
        var gpu = Assert.Single(gpus);
        Assert.Equal("NVIDIA GeForce RTX 4060, Laptop GPU", gpu.Name);
        Assert.Equal(6144L * 1024 * 1024, gpu.VideoMemoryBytes);
        Assert.Equal("580.1", gpu.DriverVersion);
        Assert.Equal("8.9", gpu.NvidiaComputeCapability);
        Assert.Equal("nvidia-smi", gpu.VideoMemorySource);
    }

    [Fact]
    public void MalformedNvidiaRowsStayUnknownInsteadOfFabricatingMemory()
    {
        Assert.Empty(WindowsStatusParser.NvidiaCsv("NVIDIA example, [N/A], unknown\r\nnot-enough-columns\r\nNVIDIA overflow, 999999999999999999999999999999, unknown\r\n"));
    }
}
