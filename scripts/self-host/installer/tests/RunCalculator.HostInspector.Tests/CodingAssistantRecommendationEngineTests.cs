using Xunit;

namespace RunCalculator.HostInspector.Tests;

public sealed class CodingAssistantRecommendationEngineTests
{
    [Fact]
    public void HighHeadroomHostGetsLongContextQwen3CoderCandidate()
    {
        var host = TestHosts.Pavilion12GiB() with
        {
            TotalMemoryBytes = TestHosts.Gib(64),
            AvailableMemoryBytes = TestHosts.Gib(40),
            SystemDriveFreeBytes = TestHosts.Gib(120),
        };

        var recommendation = CodingAssistantRecommendationEngine.Recommend(host);

        Assert.Equal(CodingAssistantCandidateStatus.Candidate, recommendation.Status);
        Assert.Equal("ollama", recommendation.Provider);
        Assert.Equal("qwen3-coder:30b", recommendation.CandidateModel);
        Assert.Equal(65_536, recommendation.ContextTokens);
        Assert.Equal(19d, recommendation.ApproximateArtifactSizeGB.GetValueOrDefault());
        Assert.Equal(CodingAssistantModelQualificationStatus.Unmeasured, recommendation.Qualification);
        Assert.Equal(1, recommendation.MaxLoadedModels);
        Assert.Equal(1, recommendation.MaxParallelRequests);
        Assert.Contains(recommendation.Reasons, reason => reason.Contains("unmeasured", StringComparison.Ordinal));
    }

    [Fact]
    public void ModerateHeadroomHostGetsSmallerQwenCoderCandidate()
    {
        var host = TestHosts.Pavilion12GiB() with
        {
            TotalMemoryBytes = TestHosts.Gib(24),
            AvailableMemoryBytes = TestHosts.Gib(12),
            SystemDriveFreeBytes = TestHosts.Gib(8),
        };

        var recommendation = CodingAssistantRecommendationEngine.Recommend(host);

        Assert.Equal(CodingAssistantCandidateStatus.Candidate, recommendation.Status);
        Assert.Equal("qwen2.5-coder:7b", recommendation.CandidateModel);
        Assert.Equal(32_768, recommendation.ContextTokens);
        Assert.Contains(recommendation.Reasons, reason => reason.Contains("below the preferred 64K", StringComparison.Ordinal));
    }

    [Fact]
    public void FallsBackToSmallerCandidateWhenLargeModelDiskThresholdIsNotMet()
    {
        var host = TestHosts.Pavilion12GiB() with
        {
            TotalMemoryBytes = TestHosts.Gib(64),
            AvailableMemoryBytes = TestHosts.Gib(40),
            SystemDriveFreeBytes = TestHosts.Gib(12),
        };

        var recommendation = CodingAssistantRecommendationEngine.Recommend(host);

        Assert.Equal("qwen2.5-coder:7b", recommendation.CandidateModel);
    }

    [Fact]
    public void TwelveGiBHostGetsNoCodingModelCandidate()
    {
        var recommendation = CodingAssistantRecommendationEngine.Recommend(TestHosts.Pavilion12GiB());

        Assert.Equal(CodingAssistantCandidateStatus.NotRecommended, recommendation.Status);
        Assert.Null(recommendation.CandidateModel);
        Assert.Contains(recommendation.Reasons, reason => reason.Contains("No model", StringComparison.Ordinal));
    }

    [Fact]
    public void MissingResourceFactsRemainUnknown()
    {
        var host = TestHosts.Pavilion12GiB() with { AvailableMemoryBytes = null };

        var recommendation = CodingAssistantRecommendationEngine.Recommend(host);

        Assert.Equal(CodingAssistantCandidateStatus.Unknown, recommendation.Status);
        Assert.Null(recommendation.CandidateModel);
    }

    [Theory]
    [InlineData(-1, 12)]
    [InlineData(12, 13)]
    public void InconsistentMemoryFactsRemainUnknown(long totalGiB, long availableGiB)
    {
        var host = TestHosts.Pavilion12GiB() with
        {
            TotalMemoryBytes = TestHosts.Gib(totalGiB),
            AvailableMemoryBytes = TestHosts.Gib(availableGiB),
            SystemDriveFreeBytes = TestHosts.Gib(120),
        };

        var recommendation = CodingAssistantRecommendationEngine.Recommend(host);

        Assert.Equal(CodingAssistantCandidateStatus.Unknown, recommendation.Status);
        Assert.Null(recommendation.CandidateModel);
    }

    [Fact]
    public void NonWindowsHostDoesNotReceiveCandidate()
    {
        var host = TestHosts.Pavilion12GiB() with { IsWindows = false };

        var recommendation = CodingAssistantRecommendationEngine.Recommend(host);

        Assert.Equal(CodingAssistantCandidateStatus.NotRecommended, recommendation.Status);
        Assert.Null(recommendation.CandidateModel);
    }

    [Fact]
    public void UnsupportedArchitectureDoesNotReceiveCandidate()
    {
        var host = TestHosts.Pavilion12GiB() with { CpuArchitecture = "arm64" };

        var recommendation = CodingAssistantRecommendationEngine.Recommend(host);

        Assert.Equal(CodingAssistantCandidateStatus.NotRecommended, recommendation.Status);
        Assert.Null(recommendation.CandidateModel);
    }

    [Fact]
    public void LowAvailableMemoryAndExtraVramDoNotOverrideSystemMemoryThreshold()
    {
        var host = TestHosts.Pavilion12GiB() with
        {
            TotalMemoryBytes = TestHosts.Gib(24),
            AvailableMemoryBytes = TestHosts.Gib(8),
            SystemDriveFreeBytes = TestHosts.Gib(20),
            Gpus = [new GpuFacts { Name = "Example GPU", VideoMemoryBytes = TestHosts.Gib(24) }],
        };

        var recommendation = CodingAssistantRecommendationEngine.Recommend(host);

        Assert.Equal(CodingAssistantCandidateStatus.NotRecommended, recommendation.Status);
        Assert.Null(recommendation.CandidateModel);
        Assert.Contains("unverified", recommendation.Acceleration, StringComparison.Ordinal);
    }
}
