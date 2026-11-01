using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace RunCalculator.HostInspector;

public static partial class WindowsStatusParser
{
    public static string? WslVersion(string output)
    {
        var match = WslVersionRegex().Match(Normalize(output));
        return match.Success ? match.Groups[1].Value : null;
    }

    public static int? WslDefaultVersion(string output)
    {
        var match = WslDefaultVersionRegex().Match(Normalize(output));
        return match.Success && int.TryParse(match.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var version)
            ? version
            : null;
    }

    public static IReadOnlyList<GpuFacts> NvidiaCsv(string output)
    {
        var gpus = new List<GpuFacts>();
        foreach (var rawLine in Normalize(output).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var columns = CsvLine(rawLine);
            if (columns.Count < 3 || !decimal.TryParse(columns[1], NumberStyles.Number, CultureInfo.InvariantCulture, out var memoryMiB))
            {
                continue;
            }

            try
            {
                gpus.Add(new GpuFacts
                {
                    Name = columns[0],
                    VideoMemoryBytes = checked((long)(memoryMiB * 1024m * 1024m)),
                    VideoMemorySource = "nvidia-smi",
                    DriverVersion = columns[2],
                    NvidiaComputeCapability = columns.Count > 3 ? columns[3] : null,
                });
            }
            catch (OverflowException)
            {
                // An implausible local-tool value remains unknown rather than aborting the report.
            }
        }
        return gpus;
    }

    private static string Normalize(string value) => value.Replace("\0", string.Empty, StringComparison.Ordinal).Replace("\r", string.Empty, StringComparison.Ordinal);

    private static IReadOnlyList<string> CsvLine(string line)
    {
        var values = new List<string>();
        var current = new StringBuilder();
        var quoted = false;
        for (var index = 0; index < line.Length; index++)
        {
            var character = line[index];
            if (character == '"')
            {
                if (quoted && index + 1 < line.Length && line[index + 1] == '"')
                {
                    current.Append('"');
                    index++;
                }
                else
                {
                    quoted = !quoted;
                }
            }
            else if (character == ',' && !quoted)
            {
                values.Add(current.ToString().Trim());
                current.Clear();
            }
            else
            {
                current.Append(character);
            }
        }
        values.Add(current.ToString().Trim());
        return values;
    }

    [GeneratedRegex(@"^\s*WSL(?:\s+version)?\s*:\s*(\d+(?:\.\d+){2,3})", RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex WslVersionRegex();

    [GeneratedRegex(@"^\s*Default\s+Version\s*:\s*(\d+)", RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex WslDefaultVersionRegex();
}
