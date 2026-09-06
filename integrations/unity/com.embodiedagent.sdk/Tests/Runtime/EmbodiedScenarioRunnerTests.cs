using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace EmbodiedAgent.Unity.Tests
{
    public sealed class EmbodiedScenarioRunnerTests
    {
        [Test]
        public void RunnerCompletesAValidatedScenarioOnce()
        {
            var root = new GameObject("scenario-test");
            var scenario = ScriptableObject.CreateInstance<EmbodiedScenario>();
            scenario.scenarioID = "training.runner";
            scenario.entryStepID = "start";
            scenario.steps = new List<ScenarioStep>
            {
                new ScenarioStep
                {
                    id = "start", type = ScenarioStepType.Instruction, timeoutSeconds = 10,
                    transitions = new List<ScenarioTransition> { new ScenarioTransition { outcome = "success", targetStepID = "complete" } },
                },
                new ScenarioStep { id = "complete", type = ScenarioStepType.Complete, timeoutSeconds = 10 },
            };
            var runner = root.AddComponent<EmbodiedScenarioRunner>();
            runner.scenario = scenario;
            var completions = 0;
            runner.Completed += _ => completions++;
            runner.StartScenario();
            runner.CompleteCurrentStep();
            runner.CompleteCurrentStep();
            Assert.AreEqual("completed", runner.Run.status);
            Assert.AreEqual(1, completions);
            Assert.IsNull(runner.LastOutcome.actor);
            Object.DestroyImmediate(root);
            Object.DestroyImmediate(scenario);
        }

        [Test]
        public void InstructorControlsPreserveAttemptsAndEvidenceBoundaries()
        {
            var root = new GameObject("instructor-scenario-test");
            var scenario = ScriptableObject.CreateInstance<EmbodiedScenario>();
            scenario.scenarioID = "training.instructor";
            scenario.revision = 2;
            scenario.entryStepID = "inspect";
            scenario.steps = new List<ScenarioStep>
            {
                new ScenarioStep
                {
                    id = "inspect", type = ScenarioStepType.Verify, timeoutSeconds = 30,
                    evidence = new List<EvidenceRule>
                    {
                        new EvidenceRule { id = "sensor-proof", source = "game", required = true },
                        new EvidenceRule { id = "instructor-signoff", source = "instructor", required = true },
                    },
                    transitions = new List<ScenarioTransition> { new ScenarioTransition { outcome = "success", targetStepID = "complete" } },
                },
                new ScenarioStep { id = "complete", type = ScenarioStepType.Complete, timeoutSeconds = 10 },
            };
            var runner = root.AddComponent<EmbodiedScenarioRunner>();
            runner.scenario = scenario;
            runner.instructorID = "instructor-1";
            runner.StartScenario();
            var runID = runner.Run.runID;

            var pause = runner.ApplyInstructorCommand(Command("pause", runID, "inspect"));
            Assert.IsTrue(pause.ok);
            Assert.AreEqual("paused", runner.Run.status);
            Assert.Greater(runner.TimeoutRemainingMs, 0);
            var hint = Command("hint", runID, "inspect");
            hint.text = "Inspect the isolation point before continuing.";
            Assert.IsTrue(runner.ApplyInstructorCommand(hint).ok);
            Assert.AreEqual(hint.text, runner.InstructorHint);
            runner.DismissInstructorHint();
            Assert.IsNull(runner.InstructorHint);

            var invalidEvidence = Command("evidence", runID, "inspect");
            invalidEvidence.evidenceID = "sensor-proof";
            invalidEvidence.value = "verified";
            invalidEvidence.reason = "Observed by instructor";
            Assert.AreEqual("evidence_not_instructor_owned", runner.ApplyInstructorCommand(invalidEvidence).code);
            var evidence = Command("evidence", runID, "inspect");
            evidence.evidenceID = "instructor-signoff";
            evidence.value = "verified";
            evidence.reason = "Procedure was demonstrated safely";
            Assert.IsTrue(runner.ApplyInstructorCommand(evidence).ok);
            Assert.AreEqual("paused", runner.Run.status);
            Assert.Contains("instructor-signoff", runner.InstructorEvidenceIDs);

            Assert.IsTrue(runner.ApplyInstructorCommand(Command("retry_current_step", runID, "inspect")).ok);
            Assert.AreEqual(2, runner.CurrentAttempt);
            Assert.AreEqual("instructor_retry", runner.Run.steps[0].outcome);
            Assert.AreEqual(1, runner.Run.steps[0].attempt);
            Assert.IsTrue(runner.ApplyInstructorCommand(Command("resume", runID, "inspect")).ok);
            Assert.AreEqual("running", runner.Run.status);
            Assert.IsTrue(runner.ApplyInstructorCommand(Command("pause", runID, "inspect")).ok);
            Assert.IsTrue(runner.ApplyInstructorCommand(Command("terminate", runID, "inspect")).ok);
            Assert.AreEqual("cancelled", runner.Run.status);
            Assert.AreEqual("instructor_terminated", runner.LastOutcome.reason);
            Assert.AreEqual(7, runner.LastOutcome.instructorInterventions.Count);

            Object.DestroyImmediate(root);
            Object.DestroyImmediate(scenario);
        }

        [Test]
        public void TraineeActionsEnforceOrderWithoutAdvancingAndProduceAssessment()
        {
            var root = new GameObject("trainee-action-test");
            var scenario = ScriptableObject.CreateInstance<EmbodiedScenario>();
            scenario.scenarioID = "training.recorded";
            scenario.entryStepID = "ppe";
            scenario.steps = new List<ScenarioStep>
            {
                Action("ppe", "safety.inspect_ppe", "stop"),
                Action("stop", "safety.stop_machine", "complete"),
                new ScenarioStep { id = "complete", type = ScenarioStepType.Complete, timeoutSeconds = 10 },
            };
            var runner = root.AddComponent<EmbodiedScenarioRunner>();
            runner.scenario = scenario;
            runner.demonstrationRevision = "demo-1:1";
            runner.StartScenario();
            runner.SetAITraineeActor("ai-run-1", "lmstudio/trainee", "guided", 2);
            scenario.steps[0].allowedCapabilityIDs = new[] { "safety.inspect_ppe" };
            scenario.steps[1].allowedCapabilityIDs = new[] { "safety.stop_machine" };

            Assert.IsFalse(runner.CanAcceptTraineeAction("safety.stop_machine", AvatarRisk.Interaction, out var feedback));
            StringAssert.Contains("Wrong order", feedback);
            Assert.AreEqual("ppe", runner.Run.currentStepID);
            Assert.AreEqual(2, runner.CurrentAttempt);
            Assert.IsTrue(runner.SubmitTraineeAction("safety.inspect_ppe", "ppe_station", AvatarActionResult.Success(), AvatarRisk.Ambient, out _));
            Assert.IsTrue(runner.SubmitTraineeAction("safety.stop_machine", "stop_button", AvatarActionResult.Success(), AvatarRisk.Interaction, out _));

            Assert.AreEqual("completed", runner.Run.status);
            Assert.AreEqual(0.5f, runner.LastOutcome.assessment.firstAttemptAccuracy);
            Assert.AreEqual("demo-1:1", runner.LastOutcome.assessment.demonstrationRevision);
            Assert.AreEqual("ai", runner.LastOutcome.actor.type);
            Assert.AreEqual("lmstudio/trainee", runner.LastOutcome.actor.model);
            Assert.AreEqual("guided", runner.LastOutcome.actor.profile);
            Assert.AreEqual(2, runner.LastOutcome.actor.decisions);
            Object.DestroyImmediate(root);
            Object.DestroyImmediate(scenario);
        }

        static ScenarioStep Action(string id, string capability, string next) => new ScenarioStep
        {
            id = id,
            type = ScenarioStepType.RequestAction,
            timeoutSeconds = 10,
            allowedCapabilityIDs = System.Array.Empty<string>(),
            transitions = new List<ScenarioTransition> { new ScenarioTransition { outcome = "success", targetStepID = next } },
        };

        static InstructorCommandFrame Command(string command, string runID, string stepID) => new InstructorCommandFrame
        {
            type = "instructor.command", requestID = command + "-request", runID = runID,
            scenarioRevision = 2, expectedStepID = stepID, instructorID = "instructor-1", command = command,
        };
    }
}
