using System;

namespace Evaluation.Health
{
    public static class HealthEvents
    {
        public static event Action<int, int> Changed;
        public static void Publish(int current, int maximum) => Changed?.Invoke(current, maximum);
    }
}
