export * as CriticPass from "./critic-pass"

export type Severity = "error" | "warning"

export type Finding = {
  readonly severity: Severity
  readonly title: string
  readonly file: string
  readonly line?: number
  readonly consequence: string
  readonly evidence: string
}

export type Review = {
  readonly requestMessageID: string
  readonly status: "pending" | "clean" | "findings" | "failed"
  readonly model: {
    readonly providerID: string
    readonly modelID: string
  }
  readonly files: readonly string[]
  readonly findings: readonly Finding[]
  readonly startedAt: number
  readonly completedAt?: number
  readonly error?: string
}
