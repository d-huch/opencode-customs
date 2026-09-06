using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;

namespace EmbodiedAgent.Unity.Tests
{
    public sealed class EmbodiedScenarioTests
    {
        readonly List<EmbodiedScenario> assets = new List<EmbodiedScenario>();

        [TearDown]
        public void TearDown()
        {
            foreach (var asset in assets) UnityEngine.Object.DestroyImmediate(asset);
            assets.Clear();
        }

        [Test]
        public void CompilerIsDeterministicAcrossStepOrdering()
        {
            var first = Scenario(new[] { Complete(), Start() });
            var second = Scenario(new[] { Start(), Complete() });
            var manifest = EmbodiedScenarioCompiler.Compile(first);
            Assert.AreEqual(manifest, EmbodiedScenarioCompiler.Compile(second));
            Assert.Less(manifest.IndexOf("\"id\":\"complete\"", StringComparison.Ordinal), manifest.IndexOf("\"id\":\"start\"", StringComparison.Ordinal));
        }

        [Test]
        public void ValidatorRejectsDuplicateIDsAndUnknownTargets()
        {
            var scenario = Scenario(new[] { Start(), Start() });
            scenario.steps[0].transitions[0].targetStepID = "missing";
            var codes = EmbodiedScenarioValidator.Validate(scenario).Select(issue => issue.code).ToArray();
            CollectionAssert.Contains(codes, "step.id");
            CollectionAssert.Contains(codes, "transition.target");
        }

        [Test]
        public void ValidatorRejectsUnboundedCycles()
        {
            var first = Start();
            var second = Start();
            second.id = "second";
            first.transitions[0].targetStepID = "second";
            second.transitions[0].targetStepID = "start";
            Assert.IsTrue(EmbodiedScenarioValidator.Validate(Scenario(new[] { first, second })).Any(issue => issue.code == "scenario.unbounded_cycle"));
        }

        [Test]
        public async Task AuditBundleContainsAHashChainWithoutPromptsOrAudio()
        {
            var directory = Path.Combine(Path.GetTempPath(), "embodied-agent-audit-" + Guid.NewGuid().ToString("N"));
            var outcome = new TrainingOutcome
            {
                runID = "run-1", scenarioID = "training.test", status = "completed", startedAt = 1, completedAt = 2,
                steps = new List<ScenarioStepOutcome>
                {
                    new ScenarioStepOutcome { stepID = "start", outcome = "success", startedAt = 1, completedAt = 2, evidence = new Dictionary<string, string> { ["verified"] = "true" } },
                },
            };
            await new AuditBundleTrainingResultSink(directory).WriteAsync(outcome);
            var bundle = File.ReadAllText(Path.Combine(directory, "run-1.audit.json"));
            Assert.IsTrue(bundle.Contains("\"rootHash\""));
            Assert.IsFalse(bundle.Contains("prompt"));
            Assert.IsFalse(bundle.Contains("audio"));
            Directory.Delete(directory, true);
        }

        EmbodiedScenario Scenario(IEnumerable<ScenarioStep> steps)
        {
            var scenario = ScriptableObject.CreateInstance<EmbodiedScenario>();
            scenario.scenarioID = "training.test";
            scenario.entryStepID = "start";
            scenario.steps = steps.ToList();
            assets.Add(scenario);
            return scenario;
        }

        static ScenarioStep Start() => new ScenarioStep
        {
            id = "start", type = ScenarioStepType.Instruction, title = "Start", timeoutSeconds = 10,
            transitions = new List<ScenarioTransition> { new ScenarioTransition { outcome = "success", targetStepID = "complete" } },
        };
        static ScenarioStep Complete() => new ScenarioStep { id = "complete", type = ScenarioStepType.Complete, title = "Complete", timeoutSeconds = 10 };
    }
}
