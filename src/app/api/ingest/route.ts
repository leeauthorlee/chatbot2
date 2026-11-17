import { NextResponse } from "next/server";
import { chunkText, DOCUMENT_SOURCE, embedTexts, readDatasetText, toVectorLiteral } from "@/lib/rag";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  try {
    const text = await readDatasetText();
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return NextResponse.json({ error: "dataset/kb.pdf에서 텍스트를 찾지 못했어요." }, { status: 422 });
    }

    const { error: deleteError } = await supabase.from("documents").delete().eq("source", DOCUMENT_SOURCE);
    if (deleteError) throw new Error(deleteError.message);

    const batchSize = 16;
    for (let index = 0; index < chunks.length; index += batchSize) {
      const batch = chunks.slice(index, index + batchSize);
      const vectors = await embedTexts(batch, "embedding-passage");
      const rows = batch.map((content, offset) => ({
        source: DOCUMENT_SOURCE,
        content,
        embedding: toVectorLiteral(vectors[offset]),
      }));
      const { error } = await supabase.from("documents").insert(rows);
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, chunks: chunks.length, source: DOCUMENT_SOURCE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "문서 저장에 실패했어요.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
