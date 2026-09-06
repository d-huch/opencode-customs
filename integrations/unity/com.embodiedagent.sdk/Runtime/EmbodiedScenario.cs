using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Events;

namespace EmbodiedAgent.Unity
{
    public enum ScenarioStepType { Instruction, Observe, WaitForUser, RequestAction, Verify, Branch, Complete }
    public enum ScenarioIssueSeverity { Info, Warning, Error }

    [Serializable]
    public sealed class ScenarioCondition
    {
        public string key;
        public string operation = "equals";
        public string value;
    }

    [Serializable]
    public sealed class ScenarioTransition
    {
        public string outcome = "success";
        public string targetStepID;
        public ScenarioCondition condition;
    }

    [Serializable]
    public sealed class EvidenceRule
    {
        public string id;
        public string label;
        public string source = "game";
        public bool required = true;
    }

    [Serializable]
    public sealed class ScenarioStep
    {
        public string id;
        public ScenarioStepType type;
        public string title;
        [TextArea(2, 6)] public string instruction;
        [Range(1, 600)] public int timeoutSeconds = 60;
        public string[] allowedCapabilityIDs = Array.Empty<string>();
        public List<ScenarioCondition> entryConditions = new List<ScenarioCondition>();
        public List<ScenarioCondition> completionConditions = new List<ScenarioCondition>();
        public List<EvidenceRule> evidence = new List<EvidenceRule>();
        public List<ScenarioTransition> transitions = new List<ScenarioTransition>();
    }

    [CreateAssetMenu(fileName = "EmbodiedScenario", menuName = "Embodied Agent/Scenario")]
    public sealed class EmbodiedScenario : ScriptableObject
    {
        public const int CurrentSchemaVersion = 1;
        public int schemaVersion = CurrentSchemaVersion;
        public string scenarioID = "training.scenario";
        public string title = "Training scenario";
        [TextArea(2, 6)] public string description;
        [Min(1)] public int revision = 1;
        public string entryStepID = "start";
        public List<ScenarioStep> steps = new List<ScenarioStep>();
    }

    [Serializable]
    public sealed class ScenarioIssue
    {
        public ScenarioIssueSeverity severity;
        public string code;
        public string message;
        public string stepID;

        public ScenarioIssue(ScenarioIssueSeverity severity, string code, string message, string stepID = null)
        {
            this.severity = severity;
            this.code = code;
            this.message = message;
            this.stepID = stepID;
        }
    }

    public static class EmbodiedScenarioValidator
    {
        public static List<ScenarioIssue> Validate(EmbodiedScenario scenario, IEnumerable<AvatarCapabilityManifest> capabilities = null)
        {
            var issues = new List<ScenarioIssue>();
            if (scenario == null)
            {
                issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "scenario.missing", "Scenario asset is missing."));
                return issues;
            }
            if (scenario.schemaVersion != EmbodiedScenario.CurrentSchemaVersion)
                issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "scenario.version", "Scenario schema version is not supported."));
            if (string.IsNullOrWhiteSpace(scenario.scenarioID))
                issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "scenario.id", "Scenario requires a stable ID."));
            if (scenario.steps == null || scenario.steps.Count == 0)
            {
                issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "scenario.steps", "Scenario has no steps."));
                return issues;
            }
            foreach (var duplicate in scenario.steps.Where(step => step != null).GroupBy(step => step.id).Where(group => string.IsNullOrWhiteSpace(group.Key) || group.Count() > 1))
                issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "step.id", string.IsNullOrWhiteSpace(duplicate.Key) ? "A step has no stable ID." : "Duplicate step ID: " + duplicate.Key, duplicate.Key));
            var steps = scenario.steps.Where(step => step != null && !string.IsNullOrWhiteSpace(step.id))
                .GroupBy(step => step.id, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
            if (scenario.scenarioID == "training.equipment-isolation")
                foreach (var required in new[] { "start", "inspect-ppe", "identify-hazards", "stop-machine", "open-disconnect", "apply-lockout", "verify-energy", "signoff", "complete" })
                    if (!steps.ContainsKey(required)) issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "scenario.locked_step", "Equipment Isolation cannot remove or rename stable step " + required + ". Create a new revision and preserve the ID.", required));
            if (!steps.ContainsKey(scenario.entryStepID ?? string.Empty))
                issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "scenario.entry", "Entry step does not exist: " + scenario.entryStepID));
            var manifests = (capabilities ?? Array.Empty<AvatarCapabilityManifest>()).Where(value => value != null && !string.IsNullOrWhiteSpace(value.id))
                .GroupBy(value => value.id, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
            foreach (var step in steps.Values)
            {
                if (step.timeoutSeconds < 1 || step.timeoutSeconds > 600)
                    issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "step.timeout", "Timeout must be between 1 and 600 seconds.", step.id));
                var allowedCapabilities = (step.allowedCapabilityIDs ?? Array.Empty<string>()).Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.Ordinal).ToArray();
                if (allowedCapabilities.Length > 4)
                    issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Warning, "capability.permission_scope", "Step exposes more than four capabilities. Narrow its authority to the actions required for this step.", step.id));
                foreach (var capabilityID in allowedCapabilities)
                {
                    if (!manifests.ContainsKey(capabilityID))
                        issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "capability.missing", "Capability is unavailable in the current scene: " + capabilityID, step.id));
                    if (manifests.TryGetValue(capabilityID, out var manifest) && manifest.risk == "critical" && string.IsNullOrWhiteSpace(manifest.permissionCategory))
                        issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "capability.permission", "Critical capability has no permission category: " + capabilityID, step.id));
                }
                foreach (var transition in step.transitions ?? new List<ScenarioTransition>())
                    if (transition == null || !steps.ContainsKey(transition.targetStepID ?? string.Empty))
                        issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "transition.target", "Transition points to an unknown step: " + transition?.targetStepID, step.id));
                foreach (var duplicate in (step.evidence ?? new List<EvidenceRule>()).Where(value => value != null).GroupBy(value => value.id).Where(group => string.IsNullOrWhiteSpace(group.Key) || group.Count() > 1))
                    issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "evidence.id", "Evidence IDs must be unique and non-empty within a step.", step.id));
                if (step.type != ScenarioStepType.Complete && (step.transitions == null || step.transitions.Count == 0))
                    issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "transition.missing", "Non-terminal step has no transition.", step.id));
            }
            foreach (var stepID in Unreachable(scenario.entryStepID, steps))
                issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Warning, "step.unreachable", "Step is unreachable from the entry step.", stepID));
            foreach (var stepID in UnboundedCycles(steps))
                issues.Add(new ScenarioIssue(ScenarioIssueSeverity.Error, "scenario.unbounded_cycle", "Cycle has no transition to a terminal or external step.", stepID));
            return issues;
        }

        static IEnumerable<string> Unreachable(string entryStepID, Dictionary<string, ScenarioStep> steps)
        {
            var reachable = new HashSet<string>(StringComparer.Ordinal);
            var pending = new Stack<string>();
            if (entryStepID != null && steps.ContainsKey(entryStepID)) pending.Push(entryStepID);
            while (pending.Count > 0)
            {
                var current = pending.Pop();
                if (!reachable.Add(current)) continue;
                foreach (var transition in steps[current].transitions ?? new List<ScenarioTransition>())
                    if (transition != null && steps.ContainsKey(transition.targetStepID ?? string.Empty)) pending.Push(transition.targetStepID);
            }
            return steps.Keys.Where(id => !reachable.Contains(id));
        }

        static IEnumerable<string> UnboundedCycles(Dictionary<string, ScenarioStep> steps)
        {
            var result = new HashSet<string>(StringComparer.Ordinal);
            foreach (var start in steps.Keys)
            {
                var path = new List<string>();
                var current = start;
                while (steps.TryGetValue(current, out var step) && step.type != ScenarioStepType.Complete)
                {
                    var cycleStart = path.IndexOf(current);
                    if (cycleStart >= 0)
                    {
                        var cycle = path.Skip(cycleStart).ToHashSet(StringComparer.Ordinal);
                        var exits = cycle.SelectMany(id => steps[id].transitions ?? new List<ScenarioTransition>())
                            .Any(transition => transition != null && !cycle.Contains(transition.targetStepID));
                        if (!exits) foreach (var id in cycle) result.Add(id);
                        break;
                    }
                    path.Add(current);
                    var transitions = step.transitions ?? new List<ScenarioTransition>();
                    if (transitions.Count != 1) break;
                    current = transitions[0]?.targetStepID;
                }
            }
            return result;
        }
    }

    public static class EmbodiedScenarioCompiler
    {
        public static string Compile(EmbodiedScenario scenario, IEnumerable<AvatarCapabilityManifest> capabilities = null)
        {
            var issues = EmbodiedScenarioValidator.Validate(scenario, capabilities);
            var error = issues.FirstOrDefault(issue => issue.severity == ScenarioIssueSeverity.Error);
            if (error != null) throw new InvalidOperationException(error.code + ": " + error.message);
            var steps = new JArray(scenario.steps.OrderBy(step => step.id, StringComparer.Ordinal).Select(step => new JObject
            {
                ["id"] = step.id,
                ["type"] = step.type.ToString().ToLowerInvariant(),
                ["title"] = step.title ?? string.Empty,
                ["instruction"] = step.instruction ?? string.Empty,
                ["timeoutSeconds"] = step.timeoutSeconds,
                ["allowedCapabilities"] = new JArray((step.allowedCapabilityIDs ?? Array.Empty<string>()).OrderBy(value => value, StringComparer.Ordinal)),
                ["entryConditions"] = Conditions(step.entryConditions),
                ["completionConditions"] = Conditions(step.completionConditions),
                ["evidence"] = new JArray((step.evidence ?? new List<EvidenceRule>()).OrderBy(value => value.id, StringComparer.Ordinal).Select(value => new JObject
                {
                    ["id"] = value.id,
                    ["label"] = value.label ?? string.Empty,
                    ["source"] = value.source ?? "game",
                    ["required"] = value.required,
                })),
                ["transitions"] = new JArray((step.transitions ?? new List<ScenarioTransition>()).OrderBy(value => value.outcome, StringComparer.Ordinal).ThenBy(value => value.targetStepID, StringComparer.Ordinal).Select(value => new JObject
                {
                    ["outcome"] = value.outcome ?? "success",
                    ["targetStepID"] = value.targetStepID,
                    ["condition"] = value.condition == null ? null : Condition(value.condition),
                })),
            }));
            return new JObject
            {
                ["schemaVersion"] = scenario.schemaVersion,
                ["scenarioID"] = scenario.scenarioID,
                ["revision"] = scenario.revision,
                ["title"] = scenario.title ?? string.Empty,
                ["description"] = scenario.description ?? string.Empty,
                ["entryStepID"] = scenario.entryStepID,
                ["steps"] = steps,
            }.ToString(Formatting.None);
        }

        static JArray Conditions(IEnumerable<ScenarioCondition> values) => new JArray((values ?? Array.Empty<ScenarioCondition>()).Where(value => value != null).OrderBy(value => value.key, StringComparer.Ordinal).ThenBy(value => value.operation, StringComparer.Ordinal).Select(Condition));
        static JObject Condition(ScenarioCondition value) => new JObject { ["key"] = value.key, ["operation"] = value.operation ?? "equals", ["value"] = value.value ?? string.Empty };
    }

    public sealed class ScenarioStepOutcome
    {
        public string stepID;
        public string outcome;
        public int attempt = 1;
        public long startedAt;
        public long completedAt;
        public Dictionary<string, string> evidence = new Dictionary<string, string>();
    }

    public sealed class ScenarioRun
    {
        public string runID;
        public string deploymentID;
        public string traineeID;
        public string sessionID;
        public string scenarioID;
        public int scenarioRevision;
        public string currentStepID;
        public string status;
        public long startedAt;
        public long completedAt;
        public List<ScenarioStepOutcome> steps = new List<ScenarioStepOutcome>();
        public List<InstructorIntervention> instructorInterventions = new List<InstructorIntervention>();
    }

    [Serializable] public sealed class ScenarioStringEvent : UnityEvent<string> { }

    public sealed class ScenarioLifecycleRecord
    {
        public string type;
        public string runID;
        public string scenarioID;
        public int scenarioRevision;
        public long timestamp;
        public string sessionID;
        public string stepID;
        public string outcome;
        public long durationMs;
        public Dictionary<string, string> evidence;
        public string demonstrationRevision;
    }

    public sealed class EmbodiedScenarioRunner : MonoBehaviour
    {
        public EmbodiedScenario scenario;
        public AvatarCapabilityRegistry capabilityRegistry;
        public EmbodiedAgentClient client;
        public string deploymentID = "local";
        public string traineeID = "trainee";
        public string sessionID = "session";
        public string instructorID = "local-instructor";
        [Tooltip("Explicitly marks this deployment as a simulation. Required for AI Trainee critical auto-approval.")]
        public bool simulationDeployment;
        [Tooltip("Game-owned critical permission categories that AI tests may auto-approve in simulation only.")]
        public string[] simulationCriticalAutoApproveCategories = Array.Empty<string>();
        public bool startOnEnable;
        public ScenarioStringEvent onStepChanged;
        public ScenarioStringEvent onRunCompleted;
        public ScenarioStringEvent onRunFailed;
        readonly Dictionary<string, string> facts = new Dictionary<string, string>(StringComparer.Ordinal);
        float deadline;
        float pausedTimeoutSeconds;
        long stepStartedAt;
        int attempt = 1;
        string instructorHint;
        int unsafeAttempts;
        int hintsUsed;
        string actorType = "human";
        string actorRunID;
        string actorModel;
        string actorProfile;
        int actorDecisions;
        public string demonstrationRevision;
        public ScenarioRun Run { get; private set; }
        public TrainingOutcome LastOutcome { get; private set; }
        public event Action<TrainingOutcome> Completed;
        public event Action<ScenarioLifecycleRecord> Lifecycle;
        public event Action<InstructorIntervention> InstructorIntervened;
        public event Action SnapshotChanged;
        public int CurrentAttempt => attempt;
        public string InstructorHint => instructorHint;
        public int TimeoutRemainingMs => Run == null || Run.status == "completed" || Run.status == "cancelled" || Run.status == "failed"
            ? 0
            : Mathf.RoundToInt(Mathf.Max(0f, Run.status == "paused" ? pausedTimeoutSeconds : deadline - Time.unscaledTime) * 1000f);
        public Dictionary<string, string> EvidenceSnapshot => new Dictionary<string, string>(facts, StringComparer.Ordinal);
        public string[] InstructorEvidenceIDs => CurrentStep()?.evidence?.Where(value => value != null && value.source == "instructor").Select(value => value.id).ToArray() ?? Array.Empty<string>();
        public string CurrentInstruction => CurrentStep()?.instruction;
        public string[] CurrentAllowedCapabilityIDs => CurrentStep()?.allowedCapabilityIDs ?? Array.Empty<string>();

        void OnEnable()
        {
            if (capabilityRegistry != null) capabilityRegistry.ActionCompleted += OnActionCompleted;
            if (startOnEnable && scenario != null) StartScenario();
        }
        void OnDisable() { if (capabilityRegistry != null) capabilityRegistry.ActionCompleted -= OnActionCompleted; }
        void Update()
        {
            if (Run == null || Run.status != "running" || Time.unscaledTime < deadline) return;
            Advance("failure", "timeout");
        }

        public void StartScenario()
        {
            var manifests = capabilityRegistry == null ? Array.Empty<AvatarCapabilityManifest>() : capabilityRegistry.Manifests();
            var issues = EmbodiedScenarioValidator.Validate(scenario, manifests);
            var error = issues.FirstOrDefault(issue => issue.severity == ScenarioIssueSeverity.Error);
            if (error != null) throw new InvalidOperationException(error.code + ": " + error.message);
            Run = new ScenarioRun
            {
                runID = Guid.NewGuid().ToString("N"), deploymentID = deploymentID, traineeID = traineeID,
                sessionID = sessionID, scenarioID = scenario.scenarioID, scenarioRevision = scenario.revision,
                status = "running", startedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };
            facts.Clear();
            attempt = 1;
            instructorHint = null;
            unsafeAttempts = 0;
            hintsUsed = 0;
            actorType = "human";
            actorRunID = null;
            actorModel = null;
            actorProfile = null;
            actorDecisions = 0;
            Emit("scenario.started");
            Enter(scenario.entryStepID);
        }

        public void SetAITraineeActor(string runID, string model, string profile, int decisions)
        {
            if (Run == null || string.IsNullOrWhiteSpace(runID)) return;
            actorType = "ai";
            actorRunID = runID;
            actorModel = model;
            actorProfile = profile;
            actorDecisions = Mathf.Max(0, decisions);
        }

        public void SetFact(string key, string value)
        {
            if (string.IsNullOrWhiteSpace(key)) return;
            facts[key] = value ?? string.Empty;
        }

        public void SubmitEvidence(string key, string value) => SetFact(key, value);
        public void CompleteCurrentStep() => Advance("success", null);
        public void FailCurrentStep(string reason) => Advance("failure", reason);
        public void Cancel(string reason = "cancelled") => Finish("cancelled", reason);
        public bool CanAcceptTraineeAction(string capabilityID, AvatarRisk risk, out string feedback)
        {
            feedback = "Training is not active.";
            if (Run == null || Run.status != "running") return false;
            var step = CurrentStep();
            if (step == null || step.type != ScenarioStepType.RequestAction || !(step.allowedCapabilityIDs ?? Array.Empty<string>()).Contains(capabilityID))
            {
                if (risk == AvatarRisk.Critical) unsafeAttempts++;
                if (step != null && step.type == ScenarioStepType.RequestAction)
                {
                    Run.steps.Add(new ScenarioStepOutcome
                    {
                        stepID = step.id, outcome = "wrong_order", attempt = attempt, startedAt = stepStartedAt,
                        completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    });
                    attempt++;
                    NotifySnapshot();
                }
                feedback = "Wrong order. Current step: " + (step?.instruction ?? step?.title ?? Run.currentStepID);
                return false;
            }
            feedback = null;
            return true;
        }

        public bool SubmitTraineeAction(string capabilityID, string entityID, AvatarActionResult result, AvatarRisk risk, out string feedback)
        {
            if (!CanAcceptTraineeAction(capabilityID, risk, out feedback)) return false;
            var step = CurrentStep();
            if (result == null || !result.ok)
            {
                if (risk == AvatarRisk.Critical) unsafeAttempts++;
                Run.steps.Add(new ScenarioStepOutcome
                {
                    stepID = step.id, outcome = result?.code ?? "failed", attempt = attempt, startedAt = stepStartedAt,
                    completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                });
                attempt++;
                NotifySnapshot();
                feedback = result?.message ?? "The action did not satisfy the required preconditions.";
                return false;
            }
            SetFact(capabilityID + ".completed", "true");
            SetFact(capabilityID + ".entity", entityID ?? string.Empty);
            foreach (var rule in step.evidence ?? new List<EvidenceRule>())
                if (rule != null && !string.IsNullOrWhiteSpace(rule.id)) SetFact(rule.id, result.code ?? "verified");
            feedback = "Step completed.";
            Advance("success", null);
            return true;
        }
        public void DismissInstructorHint()
        {
            if (string.IsNullOrWhiteSpace(instructorHint)) return;
            instructorHint = null;
            NotifySnapshot();
        }

        public InstructorCommandResult ApplyInstructorCommand(InstructorCommandFrame command)
        {
            var result = Result(command, false, "invalid_command", "Instructor command is invalid.");
            if (command == null || Run == null || command.runID != Run.runID) return result;
            if (command.scenarioRevision != Run.scenarioRevision || (!string.IsNullOrWhiteSpace(command.expectedStepID) && command.expectedStepID != Run.currentStepID))
                return Result(command, false, "scenario_conflict", "Scenario revision or current step changed.");
            if (string.IsNullOrWhiteSpace(command.instructorID)) return Result(command, false, "instructor_required", "Instructor ID is required.");
            if (command.command == "pause") return Pause(command);
            if (command.command == "resume") return Resume(command);
            if (command.command == "retry_current_step") return Retry(command);
            if (command.command == "terminate") return Terminate(command);
            if (command.command == "hint") return Hint(command);
            if (command.command == "evidence") return Evidence(command);
            return result;
        }

        public void RecordInstructorApproval(string requestID, string operatorID, string actionID, bool approved)
        {
            if (Run == null || (Run.status != "running" && Run.status != "paused") || string.IsNullOrWhiteSpace(operatorID)) return;
            var intervention = new InstructorIntervention
            {
                requestID = requestID, instructorID = operatorID, command = "approval", stepID = Run.currentStepID,
                attempt = attempt, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), evidenceID = actionID,
                reason = approved ? "approved" : "denied",
            };
            Run.instructorInterventions.Add(intervention);
            InstructorIntervened?.Invoke(intervention);
        }

        void OnActionCompleted(string capabilityID, AvatarActionResult result)
        {
            if (Run == null || Run.status != "running") return;
            var step = scenario.steps.FirstOrDefault(value => value.id == Run.currentStepID);
            if (step == null || step.type != ScenarioStepType.RequestAction || !(step.allowedCapabilityIDs ?? Array.Empty<string>()).Contains(capabilityID)) return;
            SetFact(capabilityID + ".completed", result != null && result.ok ? "true" : "false");
            if (result != null && result.ok)
                foreach (var rule in step.evidence ?? new List<EvidenceRule>())
                    if (rule != null && !string.IsNullOrWhiteSpace(rule.id)) SetFact(rule.id, result.code ?? "verified");
            Advance(result != null && result.ok ? "success" : "failure", result?.message);
        }

        void Enter(string stepID)
        {
            var step = scenario.steps.First(value => value.id == stepID);
            if (!ConditionsPass(step.entryConditions)) { Finish("failed", "entry_conditions_failed:" + stepID); return; }
            Run.currentStepID = stepID;
            Run.status = "running";
            attempt = 1;
            instructorHint = null;
            stepStartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            deadline = Time.unscaledTime + Mathf.Clamp(step.timeoutSeconds, 1, 600);
            onStepChanged?.Invoke(stepID);
            if (step.type == ScenarioStepType.Branch) Advance("branch", null);
            if (step.type == ScenarioStepType.Complete) Finish("completed", null);
            NotifySnapshot();
        }

        void Advance(string outcome, string reason)
        {
            if (Run == null || Run.status != "running") return;
            var step = scenario.steps.First(value => value.id == Run.currentStepID);
            if (outcome == "success" && !ConditionsPass(step.completionConditions)) outcome = "failure";
            var evidence = (step.evidence ?? new List<EvidenceRule>()).Where(rule => rule != null && facts.ContainsKey(rule.id)).ToDictionary(rule => rule.id, rule => facts[rule.id]);
            if (outcome == "success" && (step.evidence ?? new List<EvidenceRule>()).Any(rule => rule != null && rule.required && !evidence.ContainsKey(rule.id))) outcome = "failure";
            var stepOutcome = new ScenarioStepOutcome
            {
                stepID = step.id, outcome = outcome, startedAt = stepStartedAt,
                completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), evidence = evidence, attempt = attempt,
            };
            Run.steps.Add(stepOutcome);
            Emit("scenario.step", step.id, outcome, evidence);
            var transition = (step.transitions ?? new List<ScenarioTransition>()).FirstOrDefault(value => value != null && value.condition != null && ConditionPasses(value.condition))
                ?? (step.transitions ?? new List<ScenarioTransition>()).FirstOrDefault(value => value != null && value.outcome == outcome)
                ?? (step.transitions ?? new List<ScenarioTransition>()).FirstOrDefault(value => value != null && value.outcome == "always");
            if (transition == null) { Finish("failed", reason ?? "transition_not_found:" + step.id); return; }
            Enter(transition.targetStepID);
        }

        InstructorCommandResult Pause(InstructorCommandFrame command)
        {
            if (Run.status == "paused") return Result(command, true, "already_paused", "Scenario is already paused.");
            if (Run.status != "running") return Result(command, false, "invalid_state", "Only a running scenario can be paused.");
            pausedTimeoutSeconds = Mathf.Max(0f, deadline - Time.unscaledTime);
            Run.status = "paused";
            RecordIntervention(command);
            NotifySnapshot();
            return Result(command, true, "paused", "Scenario paused at a safe boundary.");
        }

        InstructorCommandResult Resume(InstructorCommandFrame command)
        {
            if (Run.status != "paused") return Result(command, false, "invalid_state", "Only a paused scenario can be resumed.");
            deadline = Time.unscaledTime + Mathf.Max(0.001f, pausedTimeoutSeconds);
            Run.status = "running";
            RecordIntervention(command);
            NotifySnapshot();
            return Result(command, true, "resumed", "Scenario resumed.");
        }

        InstructorCommandResult Retry(InstructorCommandFrame command)
        {
            if (Run.status != "paused") return Result(command, false, "invalid_state", "Pause the scenario before retrying the current step.");
            var step = CurrentStep();
            if (step == null || step.type == ScenarioStepType.Complete) return Result(command, false, "step_not_retryable", "The current step cannot be retried.");
            var evidence = (step.evidence ?? new List<EvidenceRule>()).Where(rule => rule != null && facts.ContainsKey(rule.id)).ToDictionary(rule => rule.id, rule => facts[rule.id]);
            Run.steps.Add(new ScenarioStepOutcome
            {
                stepID = step.id, outcome = "instructor_retry", attempt = attempt, startedAt = stepStartedAt,
                completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), evidence = evidence,
            });
            foreach (var rule in step.evidence ?? new List<EvidenceRule>()) if (rule != null) facts.Remove(rule.id);
            attempt++;
            instructorHint = null;
            stepStartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            pausedTimeoutSeconds = Mathf.Clamp(step.timeoutSeconds, 1, 600);
            RecordIntervention(command);
            NotifySnapshot();
            return Result(command, true, "step_retried", "A new step attempt was created.");
        }

        InstructorCommandResult Terminate(InstructorCommandFrame command)
        {
            if (Run.status != "running" && Run.status != "paused") return Result(command, false, "invalid_state", "The scenario is already terminal.");
            RecordIntervention(command);
            Finish("cancelled", "instructor_terminated");
            return Result(command, true, "terminated", "Scenario terminated safely.");
        }

        InstructorCommandResult Hint(InstructorCommandFrame command)
        {
            var text = command.text?.Trim();
            if (Run.status != "running" && Run.status != "paused") return Result(command, false, "invalid_state", "Hints require an active scenario.");
            if (string.IsNullOrWhiteSpace(text) || text.Length > 500) return Result(command, false, "invalid_hint", "Hint must contain 1–500 characters.");
            instructorHint = text;
            hintsUsed++;
            RecordIntervention(command);
            NotifySnapshot();
            return Result(command, true, "hint_delivered", "Hint delivered to the trainee HUD.");
        }

        InstructorCommandResult Evidence(InstructorCommandFrame command)
        {
            if (Run.status != "running" && Run.status != "paused") return Result(command, false, "invalid_state", "Evidence requires an active scenario.");
            var rule = CurrentStep()?.evidence?.FirstOrDefault(value => value != null && value.id == command.evidenceID);
            if (rule == null || rule.source != "instructor") return Result(command, false, "evidence_not_instructor_owned", "Only instructor-owned evidence can be confirmed manually.");
            if (string.IsNullOrWhiteSpace(command.reason)) return Result(command, false, "evidence_reason_required", "A reason is required for instructor evidence.");
            SetFact(rule.id, command.value?.Trim() ?? "verified");
            RecordIntervention(command);
            NotifySnapshot();
            return Result(command, true, "evidence_recorded", "Instructor evidence recorded without bypassing the step transition.");
        }

        ScenarioStep CurrentStep() => Run == null || scenario == null ? null : scenario.steps.FirstOrDefault(value => value.id == Run.currentStepID);

        void RecordIntervention(InstructorCommandFrame command)
        {
            var intervention = new InstructorIntervention
            {
                requestID = command.requestID, instructorID = command.instructorID, command = command.command,
                stepID = Run.currentStepID, attempt = attempt, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                evidenceID = command.evidenceID, reason = command.reason,
                valueHash = string.IsNullOrWhiteSpace(command.value) ? null : Hash(command.value),
            };
            Run.instructorInterventions.Add(intervention);
            InstructorIntervened?.Invoke(intervention);
        }

        InstructorCommandResult Result(InstructorCommandFrame command, bool ok, string code, string message) => new InstructorCommandResult
        {
            requestID = command?.requestID, runID = Run?.runID ?? command?.runID, ok = ok, code = code, message = message,
            stepID = Run?.currentStepID, attempt = attempt, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };

        void NotifySnapshot() => SnapshotChanged?.Invoke();

        static string Hash(string value)
        {
            using var algorithm = SHA256.Create();
            return string.Concat(algorithm.ComputeHash(Encoding.UTF8.GetBytes(value)).Select(item => item.ToString("x2")));
        }

        bool ConditionsPass(IEnumerable<ScenarioCondition> conditions) => (conditions ?? Array.Empty<ScenarioCondition>()).All(ConditionPasses);
        bool ConditionPasses(ScenarioCondition condition)
        {
            if (condition == null || string.IsNullOrWhiteSpace(condition.key)) return true;
            var exists = facts.TryGetValue(condition.key, out var actual);
            if (condition.operation == "exists") return exists;
            if (condition.operation == "not_exists") return !exists;
            if (condition.operation == "not_equals") return !exists || actual != (condition.value ?? string.Empty);
            return exists && actual == (condition.value ?? string.Empty);
        }

        void Finish(string status, string reason)
        {
            if (Run == null || (Run.status != "running" && Run.status != "paused")) return;
            Run.status = status;
            Run.completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var outcome = TrainingOutcome.From(Run, reason);
            var actionSteps = scenario.steps.Count(value => value != null && value.type == ScenarioStepType.RequestAction);
            var actionStepIDs = scenario.steps.Where(value => value != null && value.type == ScenarioStepType.RequestAction).Select(value => value.id).ToHashSet();
            var firstAttempt = Run.steps.Where(value => value.outcome == "success" && value.attempt == 1 && actionStepIDs.Contains(value.stepID)).Select(value => value.stepID).Distinct().Count();
            outcome.assessment = new TrainingAssessment
            {
                passed = status == "completed", durationMs = outcome.durationMs,
                firstAttemptAccuracy = actionSteps == 0 ? 1f : Mathf.Clamp01((float)firstAttempt / actionSteps),
                unsafeAttempts = unsafeAttempts, hintsUsed = hintsUsed,
                completedSteps = Run.steps.Count(value => value.outcome == "success"), totalSteps = actionSteps,
                demonstrationRevision = demonstrationRevision,
            };
            if (actorType == "ai") outcome.actor = new TrainingActorMetrics
            {
                type = actorType, runID = actorRunID, model = actorModel, profile = actorProfile, decisions = actorDecisions,
            };
            LastOutcome = outcome;
            Emit(status == "completed" ? "scenario.completed" : status == "cancelled" ? "scenario.cancelled" : "scenario.failed", Run.currentStepID, status);
            Completed?.Invoke(outcome);
            if (status == "completed") onRunCompleted?.Invoke(AvatarJson.Serialize(outcome));
            else onRunFailed?.Invoke(reason ?? status);
            NotifySnapshot();
        }

        void Emit(string type, string stepID = null, string outcome = null, Dictionary<string, string> evidence = null)
        {
            var record = new ScenarioLifecycleRecord
            {
                type = type, runID = Run.runID, scenarioID = Run.scenarioID, scenarioRevision = Run.scenarioRevision,
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), sessionID = Run.sessionID, stepID = stepID,
                outcome = outcome, durationMs = Run.completedAt > 0 ? Math.Max(0, Run.completedAt - Run.startedAt) : 0,
                evidence = evidence,
                demonstrationRevision = demonstrationRevision,
            };
            Lifecycle?.Invoke(record);
            if (client != null && client.IsConnected) _ = client.SendScenarioLifecycleAsync(type, Run, stepID, outcome, evidence);
        }
    }
}
