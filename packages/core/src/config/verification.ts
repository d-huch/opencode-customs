export * as ConfigVerification from "./verification"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"

export class Check extends Schema.Class<Check>("Config.Verification.Check")({
  name: Schema.String.annotate({ description: "Short stable name for the verification check" }),
  command: Schema.String.annotate({ description: "Repository-native command to execute" }),
  when: Schema.String.pipe(Schema.optional).annotate({
    description: "Plain-language condition describing when this check is relevant",
  }),
  timeout: PositiveInt.pipe(Schema.optional).annotate({ description: "Optional timeout in milliseconds" }),
}) {}

export class Info extends Schema.Class<Info>("Config.Verification")({
  auto: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Require verification after an agent changes project files (default: true)",
  }),
  evidence: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Require grounded evidence before completing repository research (default: true)",
  }),
  repair_attempts: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Maximum bounded repair attempts after initial verification (default: 2)",
  }),
  evidence_attempts: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Maximum bounded follow-up attempts after an incomplete evidence pass (default: 2)",
  }),
  checks: Schema.Array(Check).pipe(Schema.optional).annotate({
    description: "Optional stack-independent registry of project-specific focused checks",
  }),
}) {}
