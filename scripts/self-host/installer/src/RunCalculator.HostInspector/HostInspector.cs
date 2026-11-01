namespace RunCalculator.HostInspector;

public static class HostInspector
{
    public static InspectionReport Inspect(HostFacts host, DateTimeOffset generatedAtUtc)
    {
        var checks = CompatibilityEvaluator.Evaluate(host);
        return new InspectionReport
        {
            GeneratedAtUtc = generatedAtUtc,
            Host = host,
            OverallStatus = CompatibilityEvaluator.Overall(checks),
            Checks = checks,
            Ai = AiRecommendationEngine.Recommend(host),
        };
    }
}
