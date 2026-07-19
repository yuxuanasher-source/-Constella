import {
  searchKnowledgeDocuments,
  type KnowledgeClient,
} from "@/features/ai/knowledge-repository";
import type { KnowledgePassage } from "@/features/ai/knowledge-base";
import type {
  WebSearchProvider,
  WebSearchResult,
} from "@/features/ai/web-search-provider";

import {
  buildStreamerProjectReviewProfile,
  type StreamerProjectExternalReference,
  type StreamerProjectReviewInput,
} from "./streamer-project-review";

export async function loadStreamerProjectMarketReferences({
  client,
  organizationId,
  profileInput,
  retrievedAt = new Date().toISOString(),
  limit = 3,
  webSearchProvider = null,
}: {
  client: KnowledgeClient;
  organizationId: string;
  profileInput: StreamerProjectReviewInput;
  retrievedAt?: string;
  limit?: number;
  webSearchProvider?: WebSearchProvider | null;
}): Promise<StreamerProjectExternalReference[]> {
  const profile = buildStreamerProjectReviewProfile(profileInput);
  const request = profile.reviewDraft.marketReferenceRequest;
  if (request.status !== "needed") return [];

  const knowledgeQueries = request.queries.filter(
    (query) => query.channel === "knowledge_base",
  );
  const passages: KnowledgePassage[] = [];
  for (const query of knowledgeQueries) {
    passages.push(
      ...(await searchKnowledgeDocuments(client, {
        organizationId,
        query: query.query,
        projectId: profileInput.project.id,
        streamerId: profileInput.streamer.id,
        product: profileInput.project.productType ?? undefined,
        limit,
      })),
    );
  }

  const knowledgeReferences = uniquePassages(passages)
    .slice(0, limit)
    .map((passage) =>
      knowledgePassageToExternalReference({
        passage,
        retrievedAt,
        productType: profileInput.project.productType ?? null,
      }),
    );
  const remaining = limit - knowledgeReferences.length;
  if (remaining <= 0 || !webSearchProvider) return knowledgeReferences;

  const webQueries = request.queries.filter((query) => query.channel === "web_search");
  const webResults: WebSearchResult[] = [];
  for (const query of webQueries) {
    webResults.push(
      ...(await webSearchProvider.search({
        query: query.query,
        maxResults: remaining,
      })),
    );
    if (webResults.length >= remaining) break;
  }

  return [
    ...knowledgeReferences,
    ...uniqueWebResults(webResults)
      .slice(0, remaining)
      .map((result) =>
        webResultToExternalReference({
          result,
          retrievedAt,
          productType: profileInput.project.productType ?? null,
        }),
      ),
  ];
}

function uniquePassages(passages: KnowledgePassage[]): KnowledgePassage[] {
  const seen = new Set<string>();
  const result: KnowledgePassage[] = [];
  for (const passage of passages) {
    const key = `${passage.docId ?? passage.id}:${passage.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(passage);
  }
  return result;
}

function knowledgePassageToExternalReference({
  passage,
  retrievedAt,
  productType,
}: {
  passage: KnowledgePassage;
  retrievedAt: string;
  productType: string | null;
}): StreamerProjectExternalReference {
  const docId = passage.docId ?? passage.id;
  return {
    id: `knowledge:${docId}:${passage.id}`,
    title: passage.title,
    sourceName: "知识库",
    sourceUrl: null,
    retrievedAt,
    summary: passage.snippet,
    productType,
  };
}

function uniqueWebResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  const unique: WebSearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    unique.push(result);
  }
  return unique;
}

function webResultToExternalReference({
  result,
  retrievedAt,
  productType,
}: {
  result: WebSearchResult;
  retrievedAt: string;
  productType: string | null;
}): StreamerProjectExternalReference {
  return {
    id: `web:${result.url}`,
    title: result.title,
    sourceName: "公网搜索",
    sourceUrl: result.url,
    retrievedAt,
    summary: result.content,
    productType,
  };
}
