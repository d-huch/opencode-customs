using System;
using System.IO;
using System.Net.Security;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace OpenCode.Customs.AvatarBridge
{
    public interface IAvatarTransport : IDisposable
    {
        WebSocketState State { get; }
        Task ConnectAsync(Uri uri, string certificateFingerprint, CancellationToken cancellation);
        Task SendTextAsync(string value, CancellationToken cancellation);
        Task<AvatarTransportMessage> ReceiveAsync(CancellationToken cancellation);
        Task CloseAsync(CancellationToken cancellation);
    }

    public sealed class AvatarTransportMessage
    {
        public bool binary;
        public byte[] data;
        public string text => binary ? null : Encoding.UTF8.GetString(data);
    }

    public sealed class ClientWebSocketTransport : IAvatarTransport
    {
        readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);
        ClientWebSocket socket;
        public WebSocketState State => socket == null ? WebSocketState.None : socket.State;

        public async Task ConnectAsync(Uri uri, string certificateFingerprint, CancellationToken cancellation)
        {
            socket = new ClientWebSocket();
            if (uri.Scheme == "wss")
            {
                if (string.IsNullOrWhiteSpace(certificateFingerprint))
                    throw new InvalidOperationException("A pinned certificate fingerprint is required for Quest/LAN WSS.");
                var expected = NormalizeFingerprint(certificateFingerprint);
                socket.Options.RemoteCertificateValidationCallback = (_, certificate, _, errors) =>
                    ValidateCertificate(certificate, errors, expected);
            }
            await socket.ConnectAsync(uri, cancellation);
        }

        public async Task SendTextAsync(string value, CancellationToken cancellation)
        {
            if (socket == null || socket.State != WebSocketState.Open) throw new InvalidOperationException("Avatar transport is not connected.");
            var bytes = Encoding.UTF8.GetBytes(value);
            await sendLock.WaitAsync(cancellation);
            try { await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancellation); }
            finally { sendLock.Release(); }
        }

        public async Task<AvatarTransportMessage> ReceiveAsync(CancellationToken cancellation)
        {
            if (socket == null) throw new InvalidOperationException("Avatar transport is not connected.");
            var buffer = new byte[32 * 1024];
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellation);
                if (result.MessageType == WebSocketMessageType.Close) return null;
                message.Write(buffer, 0, result.Count);
                if (message.Length > 32 * 1024 * 1024) throw new InvalidDataException("Avatar Bridge payload exceeded 32 MB.");
            } while (!result.EndOfMessage);
            return new AvatarTransportMessage { binary = result.MessageType == WebSocketMessageType.Binary, data = message.ToArray() };
        }

        public async Task CloseAsync(CancellationToken cancellation)
        {
            if (socket == null || socket.State != WebSocketState.Open) return;
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Unity stopped", cancellation);
        }

        public void Dispose()
        {
            socket?.Dispose();
            sendLock.Dispose();
        }

        static bool ValidateCertificate(X509Certificate certificate, SslPolicyErrors errors, string expected)
        {
            if (certificate == null) return false;
            using var sha = SHA256.Create();
            var actual = BitConverter.ToString(sha.ComputeHash(certificate.GetRawCertData())).Replace("-", "");
            return string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase) &&
                (errors == SslPolicyErrors.None || errors == SslPolicyErrors.RemoteCertificateChainErrors || errors == SslPolicyErrors.RemoteCertificateNameMismatch);
        }

        static string NormalizeFingerprint(string value) => value.Replace(":", "").Replace("-", "").Trim();
    }

    public static class AvatarTransportFactory
    {
        public static IAvatarTransport Create()
        {
            // Unity 6's ClientWebSocket supports certificate pinning on the managed backend.
            // Projects whose Quest IL2CPP profile strips the callback must register a native
            // IAvatarTransport implementation instead; never fall back to accepting all certificates.
            return new ClientWebSocketTransport();
        }
    }
}
