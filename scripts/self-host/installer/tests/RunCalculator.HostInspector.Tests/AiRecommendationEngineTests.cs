using Xunit;

namespace RunCalculator.HostInspector.Tests;

public sealed class AiRecommendationEngineTests
{
    [Fact]
    public void TwelveGiBPavilionGetsOneConservativeSharedTextCandidate()
    {
        var recommendation = AiRecommendationEngine.Recommend(TestHosts.Pavilion12GiB());

        Assert.Equal(AiCandidateStatus.Candidate, recommendation.Status);
        Assert.Equal("qwen3:4b", recommendation.CandidateModel);
        Assert.Equal("qwen3:4b", recommendation.CheapRoleModel);
        Assert.Equal("qwen3:4b", recommendation.FullTextRoleModel);
        Assert.Equal(1, recommendation.MaxLoadedModels);
        Assert.Equal(1, recommendation.MaxParallelRequests);
        Assert.Equal(ModelQualificationStatus.Unmeasured, recommendation.Qualification);
        Assert.Equal(VisionQualificationStatus.NotQualified, recommendation.VisionOcr);
        Assert.Contains("qwen3:14b", Assert.Single(recommendation.ExcludedModels));
        Assert.Contains(recommendation.Reasons, reason => reason.Contains("container GPU acceleration is unverified", StringComparison.Ordinal));
        Assert.Contains(recommendation.Reasons, reason => reason.Contains("core-app-without-AI", StringComparison.Ordinal));
    }

    [Fact]
    public void LessThanTwelveGiBRecommendsCoreWithoutAi()
    {
        var host = TestHosts.Pavilion12GiB() with { TotalMemoryBytes = TestHosts.Gib(11) };
        var recommendation = AiRecommendationEngine.Recommend(host);
        Assert.Equal(AiCandidateStatus.NotRecommended, recommendation.Status);
        Assert.Null(recommendation.CandidateModel);
        Assert.True(recommendation.CoreAppWithoutAiAllowed);
    }

    [Fact]
    public void MissingMemoryDoesNotBecomeAGuess()
    {
        var host = TestHosts.Pavilion12GiB() with { TotalMemoryBytes = null };
        var recommendation = AiRecommendationEngine.Recommend(host);
        Assert.Equal(AiCandidateStatus.Unknown, recommendation.Status);
        Assert.Null(recommendation.CandidateModel);
    }

    [Fact]
    public void UnsupportedArchitectureDoesNotReceiveModelCandidate()
    {
        var host = TestHosts.Pavilion12GiB() with { CpuArchitecture = "arm64" };
        var recommendation = AiRecommendationEngine.Recommend(host);
        Assert.Equal(AiCandidateStatus.NotRecommended, recommendation.Status);
        Assert.Null(recommendation.CandidateModel);
    }

    [Fact]
    public void LargerGpuNeverTurnsUnmeasuredCandidateIntoVerifiedAcceleration()
    {
        var host = TestHosts.Pavilion12GiB() with
        {
            TotalMemoryBytes = TestHosts.Gib(32),
            Gpus = [new GpuFacts { Name = "Example GPU", VideoMemoryBytes = TestHosts.Gib(24), DriverVersion = "example" }],
        };
        var recommendation = AiRecommendationEngine.Recommend(host);
        Assert.Equal("qwen3:4b", recommendation.CandidateModel);
        Assert.Equal(ModelQualificationStatus.Unmeasured, recommendation.Qualification);
        Assert.Equal("unverified; CPU benchmark fallback required", recommendation.Acceleration);
        Assert.Empty(recommendation.ExcludedModels);
    }

    [Fact]
    public void LowAvailableMemoryRequiresRemeasurementWithNormalServices()
    {
        var host = TestHosts.Pavilion12GiB() with { AvailableMemoryBytes = TestHosts.Gib(4) };
        var recommendation = AiRecommendationEngine.Recommend(host);
        Assert.Contains(recommendation.Reasons, reason => reason.Contains("below 8 GiB", StringComparison.Ordinal));
    }
}
