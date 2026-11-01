namespace RunCalculator.HostInspector;

public static class Program
{
    public static int Main(string[] args)
    {
        if (args is ["--help"] or ["-h"])
        {
            PrintHelp();
            return 0;
        }

        if (args.Length > 1 || (args.Length == 1 && args[0] != "--json"))
        {
            Console.Error.WriteLine("Usage: RunCalculator.HostInspector [--json]");
            return 2;
        }

        try
        {
            IHostFactsCollector collector = OperatingSystem.IsWindows()
                ? new WindowsHostFactsCollector()
                : new UnsupportedHostFactsCollector();
            var report = HostInspector.Inspect(collector.Collect(), DateTimeOffset.UtcNow);
            if (args is ["--json"])
            {
                Console.WriteLine(ReportJson.Serialize(report));
            }
            else
            {
                PrintText(report);
            }
            return 0;
        }
        catch
        {
            Console.Error.WriteLine("Inspection failed safely. No installation or system changes were attempted.");
            return 1;
        }
    }

    private static void PrintHelp()
    {
        Console.WriteLine("Run Calculator Windows host inspector — read-only Phase 1");
        Console.WriteLine("Usage: RunCalculator.HostInspector [--json]");
        Console.WriteLine("  --json   Emit the complete safety-filtered report as JSON.");
        Console.WriteLine("No option installs software, changes Windows, downloads models, or accesses application data.");
    }

    private static void PrintText(InspectionReport report)
    {
        Console.WriteLine("Run Calculator Windows host inspection (read-only)");
        Console.WriteLine($"Overall: {report.OverallStatus}");
        Console.WriteLine();
        foreach (var check in report.Checks)
        {
            Console.WriteLine($"[{check.Status}] {check.Id}: {check.Summary}");
            foreach (var evidence in check.Evidence)
            {
                Console.WriteLine($"  {evidence}");
            }
        }
        Console.WriteLine();
        Console.WriteLine($"AI candidate: {report.Ai.Status} — {report.Ai.CandidateModel ?? "none"}");
        Console.WriteLine($"AI qualification: {report.Ai.Qualification}; vision/OCR: {report.Ai.VisionOcr}");
        foreach (var reason in report.Ai.Reasons)
        {
            Console.WriteLine($"  {reason}");
        }
        foreach (var excluded in report.Ai.ExcludedModels)
        {
            Console.WriteLine($"  Excluded: {excluded}");
        }
        Console.WriteLine();
        Console.WriteLine("No installation, configuration, model download, provider call, or application-data access was performed.");
    }
}
