import { NextRequest, NextResponse } from "next/server";
import { embedTexts, RELEVANCE_THRESHOLD, toVectorLiteral, type Source } from "@/lib/rag";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Match = {
  source: string;
  content: string;
  similarity: number;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY가 설정되지 않았어요." }, { status: 503 });
  }

  let question = "";
  let conversationId: string | null = null;
  try {
    const body = await request.json();
    question = typeof body.question === "string" ? body.question.trim() : "";
    conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
    if (!question || question.length > 4000) {
      return NextResponse.json({ error: "질문을 1자 이상 4000자 이하로 입력해 주세요." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  if (conversationId) {
    const { data: owned } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!owned) conversationId = null;
  }

  if (!conversationId) {
    const title = question.length > 28 ? `${question.slice(0, 28)}…` : question;
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title })
      .select("id")
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: "대화방을 만들지 못했어요. Supabase SQL을 먼저 실행했는지 확인해 주세요." },
        { status: 500 },
      );
    }
    conversationId = data.id;
  }

  const { error: userMessageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: "user",
    content: question,
  });
  if (userMessageError) {
    return NextResponse.json({ error: "질문을 저장하지 못했어요." }, { status: 500 });
  }

  let matches: Match[] = [];
  try {
    const [queryVector] = await embedTexts([question], "embedding-query");
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: toVectorLiteral(queryVector),
      match_count: 4,
    });
    if (error) throw new Error(error.message);
    matches = ((data ?? []) as Match[]).filter((item) => item.similarity >= RELEVANCE_THRESHOLD);
  } catch (error) {
    const message = error instanceof Error ? error.message : "문서 검색에 실패했어요.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const useRag = matches.length > 0;
  const context = matches
    .map((item, index) => `[${index + 1}] 출처: ${item.source}\n${item.content}`)
    .join("\n\n");

  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(12);

  const prior = (history ?? [])
    .slice(0, -1)
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({ role: item.role as "user" | "assistant", content: item.content }));

  const system = useRag
    ? `너는 '모두의 AI' 도우미야. 아래 참고 문서에 있는 내용으로만 답하고, 문서에 없으면 모른다고 말해. 답변은 한국어로 친절하게 작성해.\n\n${context}`
    : "너는 '모두의 AI' 도우미야. 참고 문서와 관련 없는 질문이면 일반적인 지식으로 짧고 친절하게 한국어로 답해.";

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [{ role: "system", content: system }, ...prior, { role: "user", content: question }],
      }),
    });
    const completion = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return NextResponse.json(
        { error: completion?.error?.message ?? "AI 응답을 가져오지 못했어요." },
        { status: upstream.status },
      );
    }

    const answer = completion?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      return NextResponse.json({ error: "빈 답변을 받았어요." }, { status: 502 });
    }

    const sources: Source[] = useRag
      ? [...new Map(matches.map((item) => [item.source, { source: item.source, similarity: Number(item.similarity.toFixed(3)) }])).values()]
      : [];

    const { data: saved, error: saveError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "assistant",
        content: answer,
        sources: sources.length ? sources : null,
      })
      .select("id, created_at")
      .single();

    if (saveError || !saved) {
      return NextResponse.json({ error: "답변을 저장하지 못했어요." }, { status: 500 });
    }

    return NextResponse.json({
      conversationId,
      message: {
        id: saved.id,
        role: "assistant",
        content: answer,
        sources,
        created_at: saved.created_at,
      },
    });
  } catch {
    return NextResponse.json({ error: "AI 서버에 연결하지 못했어요." }, { status: 502 });
  }
}
