using System.Text.Json;
using System.Text.Json.Serialization;

namespace RunCalculator.HostInspector;

public enum InspectionStatus
{
    Pass,
    Warn,
    Blocked,
    Unknown,
}

public sealed record CheckResult
{
    public required string Id { get; init; }

    public required InspectionStatus Status { get; init; }

    public required string Summary { get; init; }

    public IReadOnlyList<string> Evidence { get; init; } = [];
}

public sealed record InspectionReport
{
    public int SchemaVersion { get; init; } = 1;

    public string Tool { get; init; } = "RunCalculator.HostInspector";

    public bool InspectionOnly { get; init; } = true;

    public DateTimeOffset GeneratedAtUtc { get; init; }

    public required HostFacts Host { get; init; }

    public required InspectionStatus OverallStatus { get; init; }

    public required IReadOnlyList<CheckResult> Checks { get; init; }

    public required AiRecommendation Ai { get; init; }

    public IReadOnlyList<string> Limitations { get; init; } =
    [
        "No installation, configuration, model download, provider call, or application-data access was performed.",
        "A candidate model is not a measured app-quality or performance qualification.",
        "Windows GPU detection does not prove WSL2, Docker, or Ollama GPU access.",
        "Native Windows CI does not qualify a specific physical laptop or production hosting.",
    ];
}

public static class ReportJson
{
    public static JsonSerializerOptions Options { get; } = CreateOptions();

    public static string Serialize(InspectionReport report) =>
        JsonSerializer.Serialize(report, Options);

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}
