using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Text;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    public static class AvatarProtocol
    {
        public const int Version = 2;
        public const int Minor = 7;
        public const int MaxCapabilities = 128;
        public const int MaxEntities = 256;
        public const int MaxPayloadBytes = 64 * 1024;
    }

    public static class AvatarIDs
    {
        public static string Normalize(string value, string fallback)
        {
            var source = string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
            var output = new StringBuilder(source.Length);
            foreach (var character in source)
                output.Append(char.IsLetterOrDigit(character) || character == '.' || character == '_' || character == ':' || character == '-' ? character : '_');
            if (output.Length == 0) output.Append(fallback);
            if (!char.IsLetterOrDigit(output[0])) output.Insert(0, "id_");
            return output.ToString(0, Math.Min(128, output.Length));
        }
    }

    public enum AvatarRisk { Ambient, Interaction, Critical }
    public enum AvatarConnectionMode { Auto, Manual, QuestPaired }

    [Serializable]
    public sealed class AvatarConnectionProfile
    {
        public string url = "ws://127.0.0.1:0/avatar";
        public string token;
        public string certificateFingerprint;
        public string clientID = "unity-vr";
        public string characterID = "assistant";
        public string gameID = "game";
        public string saveSlotID = "default";
        public string sessionID;
        public string profileID;
        public int profileRevision;
        public long expiresAt;
    }

    [Serializable]
    public sealed class AvatarBootstrapRequest
    {
        public string clientID;
        public string characterID;
        public string gameID;
        public string saveSlotID;
        public int protocol = AvatarProtocol.Version;
        public int protocolMinor = AvatarProtocol.Minor;
    }

    [Serializable]
    public sealed class AvatarDiscoveryAnnouncement
    {
        public string service;
        public int version;
        public string instanceID;
        public int protocol;
        public int protocolMinor;
        public string[] addresses = Array.Empty<string>();
        public string certificateFingerprint;
        public long timestamp;
    }

    public sealed class AvatarCapabilityManifest
    {
        public string id;
        public string title;
        public string description;
        public JObject parameters = new JObject { ["type"] = "object" };
        public string risk = "ambient";
        public int cooldownMs;
        public int timeoutMs = 15000;
        public bool cancellable = true;
        public string[] preconditions = Array.Empty<string>();
        public string permissionCategory;
        public string[] postconditions = Array.Empty<string>();
        public string[] sideEffects = Array.Empty<string>();
    }

    public sealed class WorldEntityState
    {
        public string id;
        public string kind;
        public string label;
        public string[] tags = Array.Empty<string>();
        public Vector3 position;
        public float distance;
        public bool visible;
        public Dictionary<string, object> state = new Dictionary<string, object>();
        public string[] affordances = Array.Empty<string>();
    }

    public sealed class WorldSnapshot
    {
        public string gameID;
        public string saveSlotID;
        public string characterID;
        public long revision;
        public long timestamp;
        public List<WorldEntityState> entities = new List<WorldEntityState>();
        public Dictionary<string, object> inventory = new Dictionary<string, object>();
        public Dictionary<string, object> quests = new Dictionary<string, object>();
        public Dictionary<string, object> relationships = new Dictionary<string, object>();
        public List<object> events = new List<object>();
    }

    public sealed class GameActionRequest
    {
        public string type;
        public string id;
        public string actionID;
        public JObject args;
        public string cycleID;
        public string idempotencyKey;
        public int timeoutMs;
    }

    public sealed class ApprovalRequest
    {
        public string type;
        public string id;
        public string actionID;
        public string title;
        public string risk;
        public JObject args;
        public long expiresAt;
    }

    public sealed class GoalStepState
    {
        public string id;
        public string text;
        public string status;
        public int attempts;
        public string failureReason;
    }

    public sealed class AgentGoalState
    {
        public string id;
        public string characterID;
        public string text;
        public string parentID;
        public string status;
        public string[] stopConditions = Array.Empty<string>();
        public string[] riskBudget = Array.Empty<string>();
        public GoalStepState[] steps = Array.Empty<GoalStepState>();
        public string replanReason;
    }

    public sealed class AvatarActionResult
    {
        public bool ok;
        public string code;
        public string message;
        public Dictionary<string, object> data;
        public string[] changedEntityIDs = Array.Empty<string>();
        public bool observeAgain = true;

        public static AvatarActionResult Success(string message = "completed", params string[] changedEntityIDs) => new AvatarActionResult
        {
            ok = true, code = "completed", message = message, changedEntityIDs = changedEntityIDs ?? Array.Empty<string>(), observeAgain = true,
        };
        public static AvatarActionResult Failure(string message, string code = "failed") => new AvatarActionResult
        {
            ok = false, code = code, message = message, observeAgain = true,
        };
    }

    public sealed class VisemeCue
    {
        public int timeMs;
        public string shape;
    }

    [Serializable]
    public sealed class AvatarPresentationFrame
    {
        public string characterID;
        public string sessionID;
        public string profileID;
        public string surface;
        public string state = "idle";
        public string emotion = "neutral";
        public float intensity = 0.4f;
        public string subtitle;
        public string goal;
        public string requestID;
        public long updatedAt;
    }

    [Serializable]
    public sealed class JarvisTurnFrame
    {
        public string turnID;
        public string requestID;
        public string sessionID;
        public string surface;
        public string phase;
        public long sequence;
        public string cancelReason;
        public string error;
    }

    [Serializable]
    public sealed class JarvisPresentationCue
    {
        public string emotion = "neutral";
        public float intensity = 0.4f;
        public string gestureHint;
        public string gazeTarget;
        public int expectedDurationMs;
    }

    [Serializable]
    public sealed class JarvisMediaFrame
    {
        public string state = "idle";
        public string owner;
        public int queued;
        public int active;
    }

    [Serializable]
    public sealed class AvatarSpeechFrame
    {
        public string requestID;
        public string codec = "pcm_s16le";
        public int sampleRate = 16000;
        public int channels = 1;
        public string locale = "uk-UA";
        public string mode = "push_to_talk";
    }

    public static class AvatarJson
    {
        static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            NullValueHandling = NullValueHandling.Ignore,
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            Converters = { new Vector3Converter() }
        };

        public static string Serialize(object value) => JsonConvert.SerializeObject(value, Formatting.None, Settings);
        public static JObject Parse(string value) => JObject.Parse(value);

        sealed class Vector3Converter : JsonConverter<Vector3>
        {
            public override void WriteJson(JsonWriter writer, Vector3 value, JsonSerializer serializer)
            {
                writer.WriteStartObject();
                writer.WritePropertyName("x"); writer.WriteValue(value.x);
                writer.WritePropertyName("y"); writer.WriteValue(value.y);
                writer.WritePropertyName("z"); writer.WriteValue(value.z);
                writer.WriteEndObject();
            }

            public override Vector3 ReadJson(JsonReader reader, Type objectType, Vector3 existingValue, bool hasExistingValue, JsonSerializer serializer)
            {
                var value = JObject.Load(reader);
                return new Vector3(value.Value<float>("x"), value.Value<float>("y"), value.Value<float>("z"));
            }
        }
    }
}
