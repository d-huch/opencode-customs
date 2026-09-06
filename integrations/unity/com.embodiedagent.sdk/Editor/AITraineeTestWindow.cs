using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace EmbodiedAgent.Unity.Editor
{
    public sealed class AITraineeTestWindow : EditorWindow
    {
        const string RuntimeUrl = "http://127.0.0.1:57110";
        enum Profile { Guided, Blind }
        enum RunMode { Live, Fixture }
        Profile profile;
        RunMode mode;
        TextAsset fixture;
        int runs = 10;
        int seed = 1;
        string status = "Start Runtime and a simulation scenario, then run one visible AI Trainee or a safe fixture batch.";
        MessageType statusType = MessageType.Info;
        bool busy;
        bool polling;
        double nextRefresh;

        [MenuItem("Embodied Agent/Test with AI")]
        public static void Open() => GetWindow<AITraineeTestWindow>("AI Scenario Tests");

        void OnEnable() => EditorApplication.update += Poll;
        void OnDisable() => EditorApplication.update -= Poll;

        void OnGUI()
        {
            EditorGUILayout.LabelField("AI Trainee", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Guided sees the current instruction. Blind sees only the overall goal, world snapshot and typed capabilities. Critical auto-approval is allowed only when the Unity deployment explicitly declares a simulation allowlist.", MessageType.Info);
            profile = (Profile)EditorGUILayout.EnumPopup("Profile", profile);
            mode = (RunMode)EditorGUILayout.EnumPopup("Run mode", mode);
            seed = EditorGUILayout.IntSlider("Seed", seed, 0, 100000);
            if (mode == RunMode.Fixture)
            {
                fixture = (TextAsset)EditorGUILayout.ObjectField("Fixture JSON", fixture, typeof(TextAsset), false);
                runs = EditorGUILayout.IntSlider("Runs", runs, 1, 100);
            }
            EditorGUILayout.HelpBox(status, statusType);
            using (new EditorGUI.DisabledScope(busy || mode == RunMode.Fixture && fixture == null))
                if (GUILayout.Button(mode == RunMode.Live ? "Start live AI Trainee" : "Run fixture batch", GUILayout.Height(34f))) StartTest();
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(busy))
                {
                    if (GUILayout.Button("Pause")) SendControl("pause");
                    if (GUILayout.Button("Resume")) SendControl("resume");
                    if (GUILayout.Button("Stop")) SendControl("cancel");
                }
            }
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Live requirements", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("• Runtime is running and local model is configured");
            EditorGUILayout.LabelField("• Unity Play Mode has a connected protocol v2.12 client");
            EditorGUILayout.LabelField("• Scenario Runner is active and world entities expose stable IDs");
        }

        async void StartTest()
        {
            busy = true;
            status = "Starting AI Trainee…";
            statusType = MessageType.Info;
            Repaint();
            try
            {
                using var client = AuthorizedClient();
                var payload = mode == RunMode.Live
                    ? new JObject { ["profile"] = profile == Profile.Guided ? "guided" : "blind", ["seed"] = seed }
                    : new JObject { ["profile"] = profile == Profile.Guided ? "guided" : "blind", ["seed"] = seed, ["runs"] = runs, ["fixture"] = JObject.Parse(fixture.text) };
                var response = await client.PostAsync(RuntimeUrl + (mode == RunMode.Live ? "/v1/ai-trainee/live" : "/v1/ai-trainee/batch"), new StringContent(payload.ToString(), Encoding.UTF8, "application/json"));
                var value = JObject.Parse(await response.Content.ReadAsStringAsync());
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException(value.Value<string>("error") ?? "AI Trainee could not start.");
                status = mode == RunMode.Live ? "Live AI Trainee started. Watch the Game view and trainee HUD." : "Fixture batch started. It cannot change live Unity state.";
                statusType = MessageType.Info;
            }
            catch (Exception error)
            {
                status = error.Message;
                statusType = MessageType.Error;
            }
            busy = false;
            Repaint();
        }

        async void SendControl(string command)
        {
            busy = true;
            try
            {
                using var client = AuthorizedClient();
                var response = await client.PostAsync(RuntimeUrl + "/v1/ai-trainee/" + command, new StringContent("{}", Encoding.UTF8, "application/json"));
                var value = JObject.Parse(await response.Content.ReadAsStringAsync());
                status = response.IsSuccessStatusCode ? "AI Trainee command: " + command + "." : value.Value<string>("error") ?? value.Value<string>("code") ?? "Command failed.";
                statusType = response.IsSuccessStatusCode ? MessageType.Info : MessageType.Error;
            }
            catch (Exception error) { status = error.Message; statusType = MessageType.Error; }
            busy = false;
            Repaint();
        }

        async void Poll()
        {
            if (busy || polling || EditorApplication.timeSinceStartup < nextRefresh) return;
            nextRefresh = EditorApplication.timeSinceStartup + 1;
            polling = true;
            try
            {
                using var client = AuthorizedClient();
                var value = JObject.Parse(await client.GetStringAsync(RuntimeUrl + "/v1/ai-trainee"));
                var active = value["active"] as JObject;
                var batch = value["batch"] as JObject;
                if (active != null) status = "Live · " + active.Value<string>("profile") + " · " + active.Value<string>("status") + " · " + (active["attempts"] as JArray)?.Count + "/64 decisions" + (active.Value<string>("reason") is string reason ? " · " + reason : string.Empty);
                else if (batch != null) status = "Batch · " + batch.Value<string>("status") + " · " + batch.Value<int>("completedRuns") + "/" + batch.Value<int>("requestedRuns") + " · pass " + (batch.Value<float>("passRate") * 100f).ToString("0") + "%";
                statusType = active?.Value<string>("status") == "failed" || batch?.Value<string>("status") == "failed" ? MessageType.Error : MessageType.Info;
                Repaint();
            }
            catch (Exception error)
            {
                status = "Runtime unavailable: " + error.Message;
                statusType = MessageType.Warning;
                Repaint();
            }
            finally { polling = false; }
        }

        internal static HttpClient AuthorizedClient()
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Embodied Agent Runtime", "control.json");
            if (Application.platform == RuntimePlatform.OSXEditor)
                path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Personal), "Library", "Application Support", "Embodied Agent Runtime", "control.json");
            if (!File.Exists(path)) throw new FileNotFoundException("Runtime control file was not found. Start Embodied Agent Runtime first.", path);
            var token = JObject.Parse(File.ReadAllText(path)).Value<string>("token");
            if (string.IsNullOrWhiteSpace(token)) throw new InvalidDataException("Runtime control token is unavailable.");
            var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return client;
        }
    }
}
