using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace OpenCode.Customs.AvatarBridge
{
    public interface IAvatarCapability
    {
        AvatarCapabilityManifest Manifest { get; }
        bool CheckPreconditions(JObject arguments, out string reason);
        Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation);
        void Cancel();
    }
}
