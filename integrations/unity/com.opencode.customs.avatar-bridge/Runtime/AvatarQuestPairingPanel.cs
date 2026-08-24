using System;
using System.Threading;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    public sealed class AvatarQuestPairingPanel : MonoBehaviour
    {
        public OpenCodeAvatarBridgeV2 bridge;
        public bool visible;
        public string deviceName = "Quest 3";
        public string pin = "";
        string status = "Searching for OpenCode Customs…";
        AvatarDiscoveryAnnouncement announcement;
        CancellationTokenSource operation;

        void Start()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            visible = true;
            _ = Discover();
#else
            visible = false;
#endif
        }

        async System.Threading.Tasks.Task Discover()
        {
            operation?.Cancel();
            operation?.Dispose();
            operation = new CancellationTokenSource(TimeSpan.FromSeconds(6));
            status = "Searching for OpenCode Customs…";
            try
            {
                announcement = await AvatarQuestConnection.DiscoverForPairingAsync(operation.Token);
                status = announcement.addresses?.Length > 0 ? "Mac found. Enter the six-digit PIN." : "Mac found without a WSS address.";
            }
            catch (Exception error) when (!(error is OperationCanceledException)) { status = error.Message; }
        }

        public void RequirePairing(string message = null)
        {
            status = string.IsNullOrWhiteSpace(message) ? "Enter the six-digit PIN." : message;
            visible = true;
            _ = Discover();
        }

        async void Pair()
        {
            if (announcement?.addresses == null || announcement.addresses.Length == 0 || pin.Length != 6) return;
            operation?.Cancel();
            operation?.Dispose();
            operation = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            status = "Pairing…";
            try
            {
                var profile = await QuestPairing.PairProfileAsync(
                    announcement.addresses[0], pin, deviceName, announcement.certificateFingerprint,
                    bridge.gameID, bridge.saveSlotID, bridge.characterID, operation.Token);
                AvatarQuestConnection.StorePairedProfile(profile, announcement.instanceID);
                status = "Paired. Connecting…";
                visible = false;
                await bridge.ReconnectAsync();
            }
            catch (Exception error) when (!(error is OperationCanceledException)) { status = error.Message; }
        }

        void OnDestroy()
        {
            operation?.Cancel();
            operation?.Dispose();
        }

        void OnGUI()
        {
            if (!visible) return;
            GUI.Box(new Rect(30, 30, 520, 250), "OpenCode Customs — Quest pairing");
            GUI.Label(new Rect(55, 75, 470, 48), status);
            GUI.Label(new Rect(55, 126, 100, 30), "PIN");
            pin = GUI.TextField(new Rect(155, 124, 180, 34), pin, 6);
            GUI.enabled = announcement?.addresses?.Length > 0 && pin.Length == 6;
            if (GUI.Button(new Rect(55, 180, 140, 40), "Pair")) Pair();
            GUI.enabled = true;
            if (GUI.Button(new Rect(210, 180, 140, 40), "Search again")) _ = Discover();
            if (GUI.Button(new Rect(365, 180, 140, 40), "Cancel")) { operation?.Cancel(); visible = false; }
        }
    }
}
