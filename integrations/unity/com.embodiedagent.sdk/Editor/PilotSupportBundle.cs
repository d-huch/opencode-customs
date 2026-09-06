using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EmbodiedAgent.Unity.Editor
{
    [Serializable]
    sealed class PilotMilestone
    {
        public string id;
        public long timestamp;
    }

    [Serializable]
    sealed class PilotOnboardingRecord
    {
        public long startedAt;
        public List<PilotMilestone> milestones = new List<PilotMilestone>();
    }

    public static class PilotOnboarding
    {
        const string Key = "EmbodiedAgent.PilotOnboarding.v1";

        public static string ElapsedLabel
        {
            get
            {
                var record = Read();
                if (record.startedAt <= 0) return "Not started";
                var elapsed = TimeSpan.FromMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - record.startedAt);
                return elapsed.TotalHours >= 1 ? elapsed.ToString(@"h\:mm\:ss") : elapsed.ToString(@"m\:ss");
            }
        }

        public static void Mark(string id)
        {
            var record = Read();
            if (record.startedAt <= 0) record.startedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (record.milestones.All(value => value.id != id))
                record.milestones.Add(new PilotMilestone { id = id, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
            EditorPrefs.SetString(Key, JsonConvert.SerializeObject(record));
        }

        public static object Snapshot() => Read();
        public static void Reset() => EditorPrefs.DeleteKey(Key);

        static PilotOnboardingRecord Read()
        {
            var json = EditorPrefs.GetString(Key, string.Empty);
            if (string.IsNullOrWhiteSpace(json)) return new PilotOnboardingRecord();
            try { return JsonConvert.DeserializeObject<PilotOnboardingRecord>(json) ?? new PilotOnboardingRecord(); }
            catch { return new PilotOnboardingRecord(); }
        }
    }

    public static class PilotSupportBundle
    {
        public static void Export(string runtimeStatus, string modelStatus, string voiceStatus)
        {
            var path = EditorUtility.SaveFilePanel("Export sanitized Embodied Agent support bundle", "", "embodied-agent-support.json", "json");
            if (string.IsNullOrWhiteSpace(path)) return;
            var scenarios = Resources.FindObjectsOfTypeAll<EmbodiedScenario>()
                .Where(value => AssetDatabase.Contains(value))
                .Select(value => new { value.scenarioID, value.revision, schemaVersion = value.schemaVersion })
                .ToArray();
            var clients = UnityEngine.Object.FindObjectsByType<EmbodiedAgentClient>(FindObjectsInactive.Include);
            var registries = UnityEngine.Object.FindObjectsByType<AvatarCapabilityRegistry>(FindObjectsInactive.Include);
            var packages = UnityEditor.PackageManager.PackageInfo.GetAllRegisteredPackages()
                .Where(value => value.name == "com.embodiedagent.sdk" || value.name.StartsWith("com.unity.xr.") || value.name == "com.unity.inputsystem")
                .Select(value => new { value.name, value.version })
                .OrderBy(value => value.name)
                .ToArray();
            var payload = new
            {
                format = "embodied-agent-support-v1",
                generatedAt = DateTimeOffset.UtcNow.ToString("O"),
                unity = new { version = Application.unityVersion, platform = Application.platform.ToString(), activeBuildTarget = EditorUserBuildSettings.activeBuildTarget.ToString() },
                scene = new { name = SceneManager.GetActiveScene().name, sdkClients = clients.Length, connectedClients = clients.Count(value => value.IsConnected) },
                runtime = new { status = Summary(runtimeStatus), model = Summary(modelStatus), voice = Summary(voiceStatus) },
                scenarios,
                capabilities = new { registries = registries.Length, count = registries.Sum(value => value.Manifests().Length), critical = registries.Sum(value => value.Manifests().Count(item => item.risk == "critical")) },
                packages,
                onboarding = PilotOnboarding.Snapshot(),
                privacy = new { rawAudio = false, prompts = false, credentials = false, traineeIdentity = false, memoryContent = false },
            };
            File.WriteAllText(path, JsonConvert.SerializeObject(payload, Formatting.Indented));
            EditorUtility.RevealInFinder(path);
        }

        static string Summary(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "unknown";
            var summary = value.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "unknown";
            return summary.Length <= 160 ? summary : summary.Substring(0, 160);
        }
    }
}
