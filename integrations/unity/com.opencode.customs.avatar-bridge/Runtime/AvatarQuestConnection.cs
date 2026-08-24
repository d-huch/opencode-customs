using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    public static class AvatarQuestConnection
    {
        const int DiscoveryPort = 57116;
        const string Service = "opencode-customs-avatar";
        const string CredentialKey = "opencode.customs.avatar.quest.credential.v1";

        [Serializable]
        sealed class StoredCredential
        {
            public string deviceID;
            public string encryptedToken;
            public string certificateFingerprint;
            public string instanceID;
        }

        public static async Task<AvatarConnectionProfile> ResolveAsync(
            string clientID,
            string characterID,
            string gameID,
            string saveSlotID,
            CancellationToken cancellation)
        {
            var stored = Load();
            if (stored == null) throw new InvalidOperationException("Quest is not paired with OpenCode Customs. Enter the six-digit PIN first.");
            var announcement = await DiscoverAsync(stored.certificateFingerprint, cancellation);
            if (announcement.addresses == null || announcement.addresses.Length == 0)
                throw new InvalidOperationException("The paired Mac did not advertise a usable WSS address.");
            return new AvatarConnectionProfile
            {
                url = announcement.addresses[0],
                token = Decrypt(stored.encryptedToken),
                certificateFingerprint = stored.certificateFingerprint,
                clientID = string.IsNullOrWhiteSpace(stored.deviceID) ? clientID : stored.deviceID,
                characterID = characterID,
                gameID = gameID,
                saveSlotID = saveSlotID,
            };
        }

        public static Task<AvatarDiscoveryAnnouncement> DiscoverForPairingAsync(CancellationToken cancellation)
        {
            return DiscoverAsync(null, cancellation);
        }

        public static void StorePairedProfile(AvatarConnectionProfile profile, string instanceID = null)
        {
            if (profile == null || string.IsNullOrWhiteSpace(profile.token) || string.IsNullOrWhiteSpace(profile.certificateFingerprint))
                throw new ArgumentException("A complete Quest pairing profile is required.");
            PlayerPrefs.SetString(CredentialKey, JsonConvert.SerializeObject(new StoredCredential
            {
                deviceID = profile.clientID,
                encryptedToken = Encrypt(profile.token),
                certificateFingerprint = profile.certificateFingerprint,
                instanceID = instanceID,
            }));
            PlayerPrefs.Save();
        }

        public static void Clear()
        {
            PlayerPrefs.DeleteKey(CredentialKey);
            PlayerPrefs.Save();
        }

        static StoredCredential Load()
        {
            if (!PlayerPrefs.HasKey(CredentialKey)) return null;
            var value = JsonConvert.DeserializeObject<StoredCredential>(PlayerPrefs.GetString(CredentialKey));
            if (value == null || string.IsNullOrWhiteSpace(value.encryptedToken) || string.IsNullOrWhiteSpace(value.certificateFingerprint)) return null;
            return value;
        }

        static async Task<AvatarDiscoveryAnnouncement> DiscoverAsync(string fingerprint, CancellationToken cancellation)
        {
            using var client = new UdpClient(AddressFamily.InterNetwork) { EnableBroadcast = true };
            client.Client.Bind(new IPEndPoint(IPAddress.Any, 0));
            var request = Encoding.UTF8.GetBytes(AvatarJson.Serialize(new { service = Service, version = 1 }));
            await client.SendAsync(request, request.Length, new IPEndPoint(IPAddress.Broadcast, DiscoveryPort));
            var timeout = Task.Delay(TimeSpan.FromSeconds(5), cancellation);
            while (!cancellation.IsCancellationRequested)
            {
                var receive = client.ReceiveAsync();
                var completed = await Task.WhenAny(receive, timeout);
                if (completed != receive) throw new TimeoutException("OpenCode Customs was not discovered on the local network. Check LAN access on the Mac.");
                var announcement = JsonConvert.DeserializeObject<AvatarDiscoveryAnnouncement>(Encoding.UTF8.GetString(receive.Result.Buffer));
                if (announcement?.service != Service || announcement.version != 1) continue;
                if (!string.IsNullOrWhiteSpace(fingerprint) &&
                    !string.Equals(Normalize(announcement.certificateFingerprint), Normalize(fingerprint), StringComparison.OrdinalIgnoreCase)) continue;
                return announcement;
            }
            cancellation.ThrowIfCancellationRequested();
            throw new OperationCanceledException();
        }

        static string Encrypt(string value)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            using var store = new AndroidJavaClass("ai.opencode.customs.AvatarCredentialStore");
            return store.CallStatic<string>("encrypt", value);
#else
            throw new PlatformNotSupportedException("Quest credentials can only be stored through Android Keystore on a Quest build.");
#endif
        }

        static string Decrypt(string value)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            using var store = new AndroidJavaClass("ai.opencode.customs.AvatarCredentialStore");
            return store.CallStatic<string>("decrypt", value);
#else
            throw new PlatformNotSupportedException("Quest credentials can only be read through Android Keystore on a Quest build.");
#endif
        }

        static string Normalize(string value) => (value ?? "").Replace(":", "").Replace("-", "").Trim();
    }
}
