import type { AiDraftForConfirmation } from "./draft-repository";
import {
  upsertKnowledgeAssetDocument,
  type KnowledgeAssetDocType,
  type KnowledgeAssetIndexClient,
  type KnowledgeAssetMetadata,
} from "./knowledge-asset-index";

export type CapturedKnowledgeDocument = { id: string };

export type KnowledgeCaptureDocument = {
  organizationId: string;
  docType: "retrospective" | "playbook" | "settlement_rule" | "manual";
  title: string;
  body: string;
  sourceRef: string;
  tags: string[];
  createdBy: string;
  metadata: KnowledgeAssetMetadata;
};

export type KnowledgeCaptureClient = KnowledgeAssetIndexClient;

export function buildConfirmedDraftKnowledgeDocument(input: {
  draft: AiDraftForConfirmation;
  organizationId: string;
  confirmedBy: string;
}): KnowledgeCaptureDocument {
  const docType = docTypeForDraft(input.draft.draftType);
  const title = titleForDraft(input.draft);
  const sourceRef = `ai_draft:${input.draft.id}`;
  return {
    organizationId: input.organizationId,
    docType,
    title,
    body: bodyForDraft({
      draft: input.draft,
      title,
      sourceRef,
      confirmedBy: input.confirmedBy,
    }),
    sourceRef,
    tags: tagsForDraft(input.draft, docType),
    createdBy: input.confirmedBy,
    metadata: {
      source: "ai_draft",
    },
  };
}

export async function captureConfirmedDraftKnowledgeDocument(
  client: KnowledgeCaptureClient,
  input: {
    draft: AiDraftForConfirmation;
    organizationId: string;
    confirmedBy: string;
  },
): Promise<CapturedKnowledgeDocument> {
  const doc = buildConfirmedDraftKnowledgeDocument(input);
  return upsertKnowledgeAssetDocument(client, {
    organizationId: doc.organizationId,
    docType: doc.docType,
    title: doc.title,
    body: doc.body,
    sourceRef: doc.sourceRef,
    tags: doc.tags,
    createdBy: doc.createdBy,
    metadata: doc.metadata,
  });
}

function docTypeForDraft(
  draftType: string,
): Extract<
  KnowledgeAssetDocType,
  "retrospective" | "playbook" | "settlement_rule" | "manual"
> {
  if (draftType === "retrospective") return "retrospective";
  if (draftType === "suggested_action_todo") return "playbook";
  if (draftType === "settlement_batch") return "settlement_rule";
  return "manual";
}

function titleForDraft(draft: AiDraftForConfirmation): string {
  const payload = draft.payload ?? {};
  if (draft.draftType === "retrospective") {
    const period = stringValue(payload.periodLabel) || draft.id;
    return `AI review deposit: ${period}`;
  }
  if (draft.draftType === "suggested_action_todo") {
    const title = stringValue(payload.title) || draft.id;
    return `AI action learning: ${title}`;
  }
  if (draft.draftType === "settlement_batch") {
    const batchType =
      recordValue(payload.scope) && stringValue(payload.scope.batchType);
    return `AI settlement learning: ${batchType || draft.id}`;
  }
  return `AI draft learning: ${draft.id}`;
}

function bodyForDraft({
  draft,
  title,
  sourceRef,
  confirmedBy,
}: {
  draft: AiDraftForConfirmation;
  title: string;
  sourceRef: string;
  confirmedBy: string;
}): string {
  const lines = [
    `# ${title}`,
    "",
    `Source: ${sourceRef}`,
    `Confirmed by: ${confirmedBy}`,
    `Draft type: ${draft.draftType}`,
    `Target: ${draft.targetStateMachine ?? "unknown"} -> ${draft.targetState ?? "unknown"}`,
    "",
  ];

  if (draft.draftType === "retrospective") {
    lines.push(...retrospectiveBody(draft.payload));
  } else if (draft.draftType === "suggested_action_todo") {
    lines.push(...suggestedActionBody(draft.payload));
  } else {
    lines.push("## Structured payload", "", safeJson(draft.payload));
  }

  lines.push(
    "",
    "Note: numeric facts in this knowledge document remain tied to the source_ref above; operational analysis should still prefer live structured business data.",
  );
  return lines.join("\n").trim() + "\n";
}

function retrospectiveBody(payload: Record<string, unknown>): string[] {
  const lines = ["## Metrics"];
  const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
  if (!metrics.length) {
    lines.push("- No sourced metrics were attached.");
  }
  for (const metric of metrics) {
    if (!recordValue(metric)) continue;
    const label = stringValue(metric.label) || "Metric";
    const value = stringValue(metric.value);
    const unit = stringValue(metric.unit);
    const source = stringValue(metric.sourceRef) || "unknown";
    lines.push(
      `- ${label}: ${value}${unit ? ` ${unit}` : ""} (source: ${source})`,
    );
  }

  lines.push("", "## Review prompts");
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  if (!sections.length) {
    lines.push("- No review prompts were attached.");
  }
  for (const section of sections) {
    if (!recordValue(section)) continue;
    lines.push(
      `- ${stringValue(section.title) || stringValue(section.key) || "Section"}: ${stringValue(section.prompt)}`,
    );
  }

  lines.push("", "## References");
  const references = Array.isArray(payload.references)
    ? payload.references
    : [];
  if (!references.length) {
    lines.push("- No knowledge references were attached.");
  }
  for (const reference of references) {
    if (!recordValue(reference)) continue;
    lines.push(
      `- ${stringValue(reference.title) || "Reference"} (source: ${stringValue(reference.sourceRef)}, doc: ${stringValue(reference.docId)})`,
    );
  }
  return lines;
}

function suggestedActionBody(payload: Record<string, unknown>): string[] {
  const lines = [
    "## Action",
    `- Title: ${stringValue(payload.title) || "Untitled action"}`,
    `- Priority: ${stringValue(payload.priority) || "medium"}`,
  ];
  const projectName = stringValue(payload.projectName);
  if (projectName) lines.push(`- Project: ${projectName}`);
  const rationale = stringValue(payload.rationale);
  if (rationale) lines.push(`- Rationale: ${rationale}`);

  lines.push("", "## Evidence");
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  if (!evidence.length) {
    lines.push("- No evidence was attached.");
  }
  for (const item of evidence) {
    if (!recordValue(item)) continue;
    lines.push(
      `- ${stringValue(item.sourceTool) || "source"}: ${stringValue(item.sourceId)}`,
    );
  }
  return lines;
}

function tagsForDraft(
  draft: AiDraftForConfirmation,
  docType: KnowledgeCaptureDocument["docType"],
): string[] {
  const tags = new Set(["ai_draft", docType, "confirmed"]);
  if (draft.draftType) tags.add(draft.draftType);
  const projectName = stringValue(draft.payload.projectName);
  if (projectName) tags.add(projectName.slice(0, 40));
  return [...tags];
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}
