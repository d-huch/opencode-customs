using System.Threading;
using System.Threading.Tasks;

namespace EmbodiedAgent.Unity
{
    public sealed class ScenarioTestResetResult
    {
        public bool ok;
        public string code;
        public string message;
        public string baselineFingerprint;
        public string sanitizedFixture;
    }

    public interface IScenarioTestEnvironment
    {
        string BaselineFingerprint { get; }
        Task<ScenarioTestResetResult> ResetForValidationAsync(CancellationToken cancellationToken);
        string CaptureSanitizedFixture();
    }
}
