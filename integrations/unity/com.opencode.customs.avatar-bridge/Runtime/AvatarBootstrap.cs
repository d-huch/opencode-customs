using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using UnityEngine.Networking;

namespace OpenCode.Customs.AvatarBridge
{
    public static class AvatarBootstrap
    {
        public const string DefaultUrl = "http://127.0.0.1:57112/v1/avatar/bootstrap";

        public static async Task<AvatarConnectionProfile> RequestAsync(
            string endpoint,
            AvatarBootstrapRequest input,
            CancellationToken cancellation)
        {
            using var request = new UnityWebRequest(string.IsNullOrWhiteSpace(endpoint) ? DefaultUrl : endpoint, "POST")
            {
                uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(AvatarJson.Serialize(input))),
                downloadHandler = new DownloadHandlerBuffer(),
                timeout = 5,
            };
            request.SetRequestHeader("content-type", "application/json");
            request.SendWebRequest();
            while (!request.isDone)
            {
                if (cancellation.IsCancellationRequested)
                {
                    request.Abort();
                    cancellation.ThrowIfCancellationRequested();
                }
                await Task.Yield();
            }
            cancellation.ThrowIfCancellationRequested();
            if (request.result != UnityWebRequest.Result.Success)
                throw new InvalidOperationException($"OpenCode Customs bootstrap failed ({request.responseCode}): {request.error}");
            var profile = JsonConvert.DeserializeObject<AvatarConnectionProfile>(request.downloadHandler.text);
            if (profile == null || string.IsNullOrWhiteSpace(profile.url) || string.IsNullOrWhiteSpace(profile.token))
                throw new InvalidOperationException("OpenCode Customs bootstrap returned an invalid connection profile.");
            if (profile.expiresAt > 0 && profile.expiresAt <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
                throw new InvalidOperationException("OpenCode Customs bootstrap profile expired before it could be used.");
            return profile;
        }
    }
}
