using System.Diagnostics;

namespace RunCalculator.HostInspector;

public sealed record CommandResult
{
    public bool Started { get; init; }

    public int? ExitCode { get; init; }

    public string StandardOutput { get; init; } = string.Empty;
}

public interface ICommandRunner
{
    CommandResult Run(string fileName, IReadOnlyList<string> arguments, TimeSpan timeout);
}

public sealed class ReadOnlyCommandRunner : ICommandRunner
{
    public CommandResult Run(string fileName, IReadOnlyList<string> arguments, TimeSpan timeout)
    {
        try
        {
            using var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var argument in arguments)
            {
                process.StartInfo.ArgumentList.Add(argument);
            }

            if (!process.Start())
            {
                return new CommandResult();
            }

            var standardOutput = process.StandardOutput.ReadToEndAsync();
            var standardError = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit((int)timeout.TotalMilliseconds))
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit();
                return new CommandResult { Started = true };
            }

            process.WaitForExit();
            var output = standardOutput.GetAwaiter().GetResult();
            _ = standardError.GetAwaiter().GetResult();
            return new CommandResult
            {
                Started = true,
                ExitCode = process.ExitCode,
                StandardOutput = output.Length <= 32_768 ? output : output[..32_768],
            };
        }
        catch
        {
            // Missing commands, access denials, and malformed local tool output all remain unknown.
            return new CommandResult();
        }
    }
}
