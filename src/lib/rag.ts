import { extractText, getDocumentProxy } from "unpdf";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const DOCUMENT_SOURCE = "kb.pdf";
const CHUNK_SIZE = 700;
const CHUNK_OVERLAP = 120;
export const RELEVANCE_THRESHOLD = 0.32;

export type Source = {
  source: string;
  similarity: number;
};

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
};

export function chunkText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE, normalized.length);
    const piece = normalized.slice(start, end).trim();
    if (piece.length > 40) chunks.push(piece);
    if (end === normalized.length) break;
    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

export async function readDatasetText() {
  const file = await readFile(path.join(process.cwd(), "dataset", DOCUMENT_SOURCE));
  const pdf = await getDocumentProxy(new Uint8Array(file));
  const extracted = await extractText(pdf, { mergePages: true });
  const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
  return text.trim();
}

export async function embedTexts(input: string[], model: "embedding-query" | "embedding-passage") {
  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey) throw new Error("UPSTAGE_API_KEY가 설정되지 않았어요.");

  const response = await fetch("https://api.upstage.ai/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input }),
  });

  const body = (await response.json().catch(() => null)) as EmbeddingResponse | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "문서 임베딩에 실패했어요.");
  }

  const vectors = body?.data?.map((item) => item.embedding).filter((item): item is number[] => Array.isArray(item));
  if (!vectors || vectors.length !== input.length) {
    throw new Error("임베딩 결과 개수가 맞지 않아요.");
  }
  return vectors;
}

export function toVectorLiteral(values: number[]) {
  return `[${values.join(",")}]`;
}
