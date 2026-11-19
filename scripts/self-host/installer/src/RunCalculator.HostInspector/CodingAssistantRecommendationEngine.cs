namespace RunCalculator.HostInspector;

public enum CodingAssistantCandidateStatus
{
    Candidate,
    NotRecommended,
    Unknown,
}

public enum CodingAssistantModelQualificationStatus
{
    Unmeasured,
}

public sealed record CodingAssistantRecommendation
{
    public required CodingAssistantCandidateStatus Status { get; init; }

    public string? Provider { get; init; }

    public string? CandidateModel { get; init; }

    public int? ContextTokens { get; init; }

    public double? ApproximateArtifactSizeGB { get; init; }

    public CodingAssistantModelQualificationStatus Qualification { get; init; } =
        CodingAssistantModelQualificationStatus.Unmeasured;

    public string Acceleration { get; init; } =
        "GPU acceleration unverified; CPU inference speed unmeasured";

    public int MaxLoadedModels { get; init; } = 1;

    public int MaxParallelRequests { get; init; } = 1;

    public IReadOnlyList<string> Reasons { get; init; } = [];
}

public static class CodingAssistantRecommendationEngine
{
    private const long GiB = 1024L * 1024 * 1024;
    private const long Qwen7BMinTotalMemory = 24 * GiB;
    private const long Qwen7BMinAvailableMemory = 12 * GiB;
    private const long Qwen7BMinSystemDriveFree = 8 * GiB;
    private const long Qwen30BMinTotalMemory = 64 * GiB;
    private const long Qwen30BMinAvailableMemory = 32 * GiB;
    private const long Qwen30BMinSystemDriveFree = 24 * GiB;

    public static CodingAssistantRecommendation Recommend(HostFacts host)
    {
        if (!host.IsWindows)
        {
            return NotRecommended("The coding-assistant installer path is supported only on Windows x64 hosts.");
        }

        if (string.IsNullOrWhiteSpace(host.CpuArchitecture))
        {
            return Unknown("CPU architecture could not be determined reliably.");
        }

        if (!string.Equals(host.CpuArchitecture, "x64", StringComparison.OrdinalIgnoreCase))
        {
            return NotRecommended("The initial local coding-model catalogue supports x64 hosts only.");
        }

        if (host.TotalMemoryBytes is not long totalMemoryBytes ||
            host.AvailableMemoryBytes is not long availableMemoryBytes ||
            host.SystemDriveFreeBytes is not long systemDriveFreeBytes)
        {
            return Unknown("Installed memory, available memory, or system-drive free space is unknown; no model is selected.");
        }

        if (totalMemoryBytes <= 0 || availableMemoryBytes < 0 || systemDriveFreeBytes < 0 ||
            availableMemoryBytes > totalMemoryBytes)
        {
            return Unknown("Host memory or disk facts are inconsistent; no model is selected.");
        }

        if (totalMemoryBytes >= Qwen30BMinTotalMemory &&
            availableMemoryBytes >= Qwen30BMinAvailableMemory &&
            systemDriveFreeBytes >= Qwen30BMinSystemDriveFree)
        {
            return Candidate(
                model: "qwen3-coder:30b",
                contextTokens: 65_536,
                approximateArtifactSizeGB: 19,
                reasons:
                [
                    "Selected from the initial catalogue because this snapshot meets its conservative 64 GiB installed RAM, 32 GiB available RAM, and 24 GiB system-drive free-space thresholds.",
                    "The model supports a longer context; the generated profile caps it at 65,536 tokens to limit resource use.",
                    "System-drive free space is only a proxy; recheck the actual model-store destination before any download.",
                ]);
        }

        if (totalMemoryBytes >= Qwen7BMinTotalMemory &&
            availableMemoryBytes >= Qwen7BMinAvailableMemory &&
            systemDriveFreeBytes >= Qwen7BMinSystemDriveFree)
        {
            return Candidate(
                model: "qwen2.5-coder:7b",
                contextTokens: 32_768,
                approximateArtifactSizeGB: 4.7,
                reasons:
                [
                    "Selected from the initial catalogue because this snapshot meets its conservative 24 GiB installed RAM, 12 GiB available RAM, and 8 GiB system-drive free-space thresholds.",
                    "This 32,768-token context is below the preferred 64K target for repository-scale work; verify it with the coding-assistant evaluation tasks.",
                    "System-drive free space is only a proxy; recheck the actual model-store destination before any download.",
                ]);
        }

        return NotRecommended(
            "No model in the initial reviewed catalogue meets the conservative memory and disk headroom thresholds on this snapshot.",
            "Keep the coding assistant/model uninstalled; the core plant application can run without it.");
    }

    private static CodingAssistantRecommendation Candidate(
        string model,
        int contextTokens,
        double approximateArtifactSizeGB,
        IReadOnlyList<string> reasons) => new()
    {
        Status = CodingAssistantCandidateStatus.Candidate,
        Provider = "ollama",
        CandidateModel = model,
        ContextTokens = contextTokens,
        ApproximateArtifactSizeGB = approximateArtifactSizeGB,
        Qualification = CodingAssistantModelQualificationStatus.Unmeasured,
        Reasons =
        [
            .. reasons,
            "This is a hardware-fit candidate only; coding quality, inference speed, and impact under normal plant load are unmeasured.",
            "No software or model is installed or downloaded; require explicit opt-in and a host-load test before use.",
        ],
    };

    private static CodingAssistantRecommendation NotRecommended(params string[] reasons) => new()
    {
        Status = CodingAssistantCandidateStatus.NotRecommended,
        Reasons = reasons,
    };

    private static CodingAssistantRecommendation Unknown(string reason) => new()
    {
        Status = CodingAssistantCandidateStatus.Unknown,
        Reasons = [reason, "Unknown is not converted to a model recommendation."],
    };
}
