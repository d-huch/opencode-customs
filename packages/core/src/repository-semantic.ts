export * as RepositorySemantic from "./repository-semantic"

import { Effect } from "effect"
import { RepositoryMap } from "@opencode-ai/schema/repository-map"

export type Input = {
  readonly directory: string
  readonly worktree: string
  readonly projectID: string
  readonly files: ReadonlyArray<string>
}

export type Result = {
  readonly files: ReadonlyArray<string>
  readonly servers: ReadonlyArray<string>
  readonly symbols: ReadonlyArray<RepositoryMap.SymbolNode>
  readonly edges: ReadonlyArray<RepositoryMap.FileEdge>
}

export type SearchInput = {
  readonly directory: string
  readonly worktree: string
  readonly projectID: string
  readonly query: string
  readonly files: ReadonlyArray<string>
}

export type SearchResult = {
  readonly query: string
  readonly servers: ReadonlyArray<string>
  readonly symbols: ReadonlyArray<RepositoryMap.SymbolNode>
  readonly edges: ReadonlyArray<RepositoryMap.FileEdge>
}

export type Provider = {
  readonly enrich: (input: Input) => Effect.Effect<Result, unknown>
  readonly search: (input: SearchInput) => Effect.Effect<SearchResult, unknown>
}

const providers: Provider[] = []

export function register(provider: Provider) {
  providers.push(provider)
  return () => {
    const index = providers.lastIndexOf(provider)
    if (index !== -1) providers.splice(index, 1)
  }
}

export function available() {
  return providers.length > 0
}

export function enrich(input: Input): Effect.Effect<Result | undefined, unknown> {
  const provider = providers.at(-1)
  return provider
    ? provider.enrich(input).pipe(Effect.map((result) => result as Result | undefined))
    : Effect.succeed(undefined)
}

export function search(input: SearchInput): Effect.Effect<SearchResult | undefined, unknown> {
  const provider = providers.at(-1)
  return provider
    ? provider.search(input).pipe(Effect.map((result) => result as SearchResult | undefined))
    : Effect.succeed(undefined)
}
