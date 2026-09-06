using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace EmbodiedAgent.Unity
{
    public abstract class EmbodiedInteractable : MonoBehaviour
    {
        [SerializeField] string stableID;
        [SerializeField] string[] affordances = { "inspect", "use" };
        public string StableID => AvatarIDs.Normalize(stableID, gameObject.scene.name + ":" + gameObject.name);
        public IReadOnlyList<string> Affordances => affordances;
        public abstract Task<AvatarActionResult> InteractAsync(string affordance, JObject arguments, CancellationToken cancellation);
    }
}
