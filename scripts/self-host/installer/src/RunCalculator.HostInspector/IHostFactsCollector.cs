namespace RunCalculator.HostInspector;

public interface IHostFactsCollector
{
    HostFacts Collect();
}

public sealed class UnsupportedHostFactsCollector : IHostFactsCollector
{
    public HostFacts Collect() => new() { IsWindows = false };
}
