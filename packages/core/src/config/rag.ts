export * as ConfigRag from "./rag"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Info extends Schema.Class<Info>("Config.Rag")({
  embeddings: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Enable local embedding retrieval when a compatible provider is available (default: true)",
  }),
  memory: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Enable embedding-assisted recall for durable project memory (default: true)",
  }),
  memory_admission: Schema.Literals(["automatic", "explicit", "off"]).pipe(Schema.optional).annotate({
    description:
      "Control durable project-memory admission: automatic stores high-confidence user-provided facts, explicit requires a remember request, and off disables new conversation memories (default: automatic)",
  }),
  model: Schema.String.pipe(Schema.optional).annotate({
    description: "Preferred LM Studio embedding model ID; the first loaded embedding model is used when omitted",
  }),
  max_files: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum repository files retained by the incremental embedding index (default: 256)",
  }),
  max_chunks: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum repository chunks retained by the incremental embedding index (default: 1024)",
  }),
  top_k: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum embedding matches considered by the repository router (default: 6)",
  }),
}) {}
