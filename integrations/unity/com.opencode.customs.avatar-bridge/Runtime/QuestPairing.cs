using System;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine.Networking;

namespace OpenCode.Customs.AvatarBridge
{
    public static class QuestPairing
    {
        public static async Task<string> PairAsync(
            string wssAddress,
            string pin,
            string deviceName,
            string certificateFingerprint,
            string gameID,
            string saveSlotID,
            string characterID,
            CancellationToken cancellation = default)
        {
            return AvatarJson.Serialize(await PairProfileAsync(
                wssAddress, pin, deviceName, certificateFingerprint, gameID, saveSlotID, characterID, cancellation));
        }

        public static async Task<AvatarConnectionProfile> PairProfileAsync(
            string wssAddress,
            string pin,
            string deviceName,
            string certificateFingerprint,
            string gameID,
            string saveSlotID,
            string characterID,
            CancellationToken cancellation = default)
        {
            var websocket = new Uri(wssAddress);
            if (websocket.Scheme != "wss") throw new ArgumentException("Quest pairing requires a WSS address.");
            var builder = new UriBuilder(websocket) { Scheme = "https", Path = "/pair" };
            using var request = new UnityWebRequest(builder.Uri, "POST")
            {
                uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(AvatarJson.Serialize(new { pin, name = deviceName }))),
                downloadHandler = new DownloadHandlerBuffer(),
                certificateHandler = new PinnedCertificateHandler(certificateFingerprint),
            };
            request.SetRequestHeader("content-type", "application/json");
            request.SendWebRequest();
            while (!request.isDone)
            {
                if (cancellation.IsCancellationRequested) { request.Abort(); cancellation.ThrowIfCancellationRequested(); }
                await Task.Yield();
            }
            if (request.result != UnityWebRequest.Result.Success)
                throw new InvalidOperationException("Quest pairing failed: " + request.error);
            var result = JObject.Parse(request.downloadHandler.text);
            var addresses = result["addresses"]?.ToObject<string[]>() ?? Array.Empty<string>();
            if (addresses.Length == 0 || string.IsNullOrWhiteSpace(result.Value<string>("token")))
                throw new InvalidOperationException("Quest pairing returned an invalid device credential.");
            var profile = new AvatarConnectionProfile
            {
                url = addresses[0],
                token = result.Value<string>("token"),
                certificateFingerprint = result.Value<string>("certificateFingerprint"),
                clientID = result.Value<string>("deviceID") ?? deviceName,
                characterID = characterID,
                gameID = gameID,
                saveSlotID = saveSlotID,
            };
            return profile;
        }

        sealed class PinnedCertificateHandler : CertificateHandler
        {
            readonly string expected;
            public PinnedCertificateHandler(string fingerprint) => expected = fingerprint.Replace(":", "").Replace("-", "").ToLowerInvariant();

            protected override bool ValidateCertificate(byte[] certificateData)
            {
                using var sha = SHA256.Create();
                var actual = BitConverter.ToString(sha.ComputeHash(certificateData)).Replace("-", "").ToLowerInvariant();
                return actual == expected;
            }
        }
    }
}
