namespace RunCalculator.HostInspector;

public enum AiCandidateStatus
{
    Candidate,
    NotRecommended,
    Unknown,
}

public enum ModelQualificationStatus
{
    Unmeasured,
}

public enum VisionQualificationStatus
{
    NotQualified,
}

public sealed record AiRecommendation
{
    public required AiCandidateStatus Status { get; init; }

    public string? CandidateModel { get; init; }

    public string? CheapRoleModel { get; init; }

    public string? FullTextRoleModel { get; init; }

    public ModelQualificationStatus Qualification { get; init; } = ModelQualificationStatus.Unmeasured;

    public VisionQualificationStatus VisionOcr { get; init; } = VisionQualificationStatus.NotQualified;

    public string Acceleration { get; init; } = "unverified; CPU benchmark fallback required";

    public int MaxLoadedModels { get; init; } = 1;

    public int MaxParallelRequests { get; init; } = 1;

    public bool CoreAppWithoutAiAllowed { get; init; } = true;

    public IReadOnlyList<string> Reasons { get; init; } = [];

    public IReadOnlyList<string> ExcludedModels { get; init; } = [];
}

public static class AiRecommendationEngine
{
    private const long TwelveGiB = 12L * 1024 * 1024 * 1024;
    private const long EightGiB = 8L * 1024 * 1024 * 1024;

    public static AiRecommendation Recommend(HostFacts host)
    {
        if (!host.IsWindows)
        {
            return Unknown("Local-AI hardware recommendation requires a Windows host inspection.");
        }

        if (host.TotalMemoryBytes is null || string.IsNullOrWhiteSpace(host.CpuArchitecture))
        {
            return Unknown("Installed memory or CPU architecture could not be determined reliably.");
        }

        if (!string.Equals(host.CpuArchitecture, "x64", StringComparison.OrdinalIgnoreCase))
        {
            return NotRecommended(
                $"The phase-1 model policy supports x64 hosts, not {host.CpuArchitecture}.",
                "The core application may still be evaluated independently of AI.");
        }

        if (host.TotalMemoryBytes < TwelveGiB)
        {
            return NotRecommended(
                "The conservative qwen3:4b candidate requires at least 12 GiB installed RAM under the phase-1 policy.",
                "Run the core application without AI or re-evaluate after a hardware upgrade.");
        }

        var reasons = new List<string>
        {
            "qwen3:4b is a conservative shared candidate for matching/classification and text extraction; app quality and latency remain unmeasured.",
            "Only one loaded model and one inference at a time are intended for this host profile.",
            "A final outcome of core-app-without-AI remains valid if later evaluation fails.",
        };

        if (host.AvailableMemoryBytes is not null && host.AvailableMemoryBytes < EightGiB)
        {
            reasons.Add("Currently available RAM is below 8 GiB; close workloads and measure real headroom before any model test.");
        }

        if (host.Gpus.Count > 0)
        {
            reasons.Add("A display adapter was detected, but container GPU acceleration is unverified; do not infer GPU inference support.");
        }
        else
        {
            reasons.Add("No usable GPU facts were detected; plan for a CPU benchmark fallback.");
        }

        var excluded = new List<string>();
        if (host.TotalMemoryBytes <= TwelveGiB)
        {
            excluded.Add("qwen3:14b — rejected for a 12 GiB host because the roughly 10 GiB runtime estimate leaves inadequate OS/application headroom.");
        }

        return new AiRecommendation
        {
            Status = AiCandidateStatus.Candidate,
            CandidateModel = "qwen3:4b",
            CheapRoleModel = "qwen3:4b",
            FullTextRoleModel = "qwen3:4b",
            Reasons = reasons,
            ExcludedModels = excluded,
        };
    }

    private static AiRecommendation Unknown(string reason) => new()
    {
        Status = AiCandidateStatus.Unknown,
        Reasons = [reason, "No model should be downloaded from this unresolved recommendation."],
    };

    private static AiRecommendation NotRecommended(params string[] reasons) => new()
    {
        Status = AiCandidateStatus.NotRecommended,
        Reasons = reasons,
    };
}
