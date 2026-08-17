using System;
using System.IO;

namespace OpenCode.Customs.AvatarBridge
{
    internal static class AvatarWav
    {
        internal sealed class Data { public float[] samples; public int channels; public int rate; }

        internal static Data Decode(byte[] bytes)
        {
            using var stream = new MemoryStream(bytes);
            using var reader = new BinaryReader(stream);
            if (new string(reader.ReadChars(4)) != "RIFF") throw new InvalidDataException("Not a RIFF WAV file.");
            reader.ReadInt32();
            if (new string(reader.ReadChars(4)) != "WAVE") throw new InvalidDataException("Not a WAVE file.");
            short format = 0, channels = 0, bits = 0;
            var rate = 0;
            byte[] audio = null;
            while (stream.Position + 8 <= stream.Length)
            {
                var chunk = new string(reader.ReadChars(4));
                var size = reader.ReadInt32();
                if (chunk == "fmt ")
                {
                    format = reader.ReadInt16(); channels = reader.ReadInt16(); rate = reader.ReadInt32();
                    reader.ReadInt32(); reader.ReadInt16(); bits = reader.ReadInt16();
                    stream.Position += size - 16;
                }
                else if (chunk == "data") audio = reader.ReadBytes(size);
                else stream.Position += size;
            }
            if (audio == null || channels < 1 || rate < 1 || bits < 1) throw new InvalidDataException("WAV data chunk is missing.");
            var count = audio.Length / (bits / 8);
            var samples = new float[count];
            if (format == 1 && bits == 16)
                for (var index = 0; index < count; index++) samples[index] = BitConverter.ToInt16(audio, index * 2) / 32768f;
            else if (format == 3 && bits == 32)
                for (var index = 0; index < count; index++) samples[index] = BitConverter.ToSingle(audio, index * 4);
            else throw new InvalidDataException($"Unsupported WAV encoding {format}/{bits}.");
            return new Data { samples = samples, channels = channels, rate = rate };
        }
    }
}
