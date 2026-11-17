"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Source = { source: string; similarity: number };
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[] | null;
  created_at: string;
};
type Conversation = { id: string; title: string; created_at: string };

function formatTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChatPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ name: string; avatar: string } | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexed, setIndexed] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadConversations() {
    const supabase = createClient();
    const { data } = await supabase
      .from("conversations")
      .select("id, title, created_at")
      .order("created_at", { ascending: false });
    setConversations(data ?? []);
  }

  async function openConversation(id: string) {
    setActiveId(id);
    setError("");
    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .select("id, role, content, sources, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setMessages((data ?? []) as ChatMessage[]);
  }

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!user) {
        router.replace("/");
        return;
      }
      const meta = user.user_metadata ?? {};
      setProfile({
        name: meta.full_name || meta.name || user.email || "사용자",
        avatar: meta.avatar_url || meta.picture || "",
      });
      const { count } = await supabase.from("documents").select("id", { count: "exact", head: true });
      setIndexed(count ?? 0);
      await loadConversations();
    });
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  async function indexDocuments() {
    setIndexing(true);
    setError("");
    try {
      const response = await fetch("/api/ingest", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "문서 준비에 실패했어요.");
      setIndexed(data.chunks);
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : "문서 준비에 실패했어요.");
    } finally {
      setIndexing(false);
    }
  }

  async function sendMessage(text: string) {
    const question = text.trim();
    if (!question || isLoading) return;
    setInput("");
    setError("");
    setIsLoading(true);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: question,
      sources: null,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, conversationId: activeId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "답변을 받지 못했어요.");
      setActiveId(data.conversationId);
      setMessages((current) => [...current, data.message]);
      await loadConversations();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "문제가 발생했어요.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  return (
    <main className="chat-shell">
      <aside className="sidebar">
        <button
          className="new-chat-button sidebar-new"
          type="button"
          onClick={() => {
            setActiveId(null);
            setMessages([]);
            setError("");
          }}
        >
          새 대화
        </button>
        <div className="room-list" aria-label="채팅방">
          {conversations.map((room) => (
            <button
              className={`room-item${room.id === activeId ? " is-active" : ""}`}
              key={room.id}
              type="button"
              onClick={() => void openConversation(room.id)}
            >
              <strong>{room.title}</strong>
              <span>{formatTime(room.created_at)}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-main">
        <header className="topbar">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">모</span>
            모두의 AI
          </span>
          <div className="profile">
            {profile?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar} alt="" />
            ) : (
              <span className="profile-fallback">{profile?.name.slice(0, 1) ?? "나"}</span>
            )}
            <span>{profile?.name ?? "로그인 중"}</span>
            <button className="text-button" type="button" onClick={() => void signOut()}>로그아웃</button>
          </div>
        </header>

        <div className="conversation" aria-live="polite">
          {indexed === 0 && (
            <div className="index-banner">
              <p>지식 문서가 아직 준비되지 않았어요. dataset의 문서를 임베딩해 저장하면 관련 질문에 출처와 함께 답해요.</p>
              <button type="button" onClick={() => void indexDocuments()} disabled={indexing}>
                {indexing ? "문서 준비 중..." : "문서 임베딩하기"}
              </button>
            </div>
          )}
          {messages.length === 0 && (
            <div className="welcome compact-welcome">
              <p className="eyebrow">모두의 AI</p>
              <h1>자료에 대해 물어보세요.</h1>
            </div>
          )}
          {messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              {message.role === "assistant" && <span className="assistant-avatar" aria-hidden="true">모</span>}
              <div className="message-content">
                <p>{message.content}</p>
                <time>{formatTime(message.created_at)}</time>
                {message.sources && message.sources.length > 0 && (
                  <ul className="sources">
                    {message.sources.map((source, index) => (
                      <li key={`${source.source}-${index}`}>참고: {source.source}</li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
          {isLoading && <span className="typing-indicator"><i /><i /><i /></span>}
          {error && <p className="error-message" role="alert">{error}</p>}
          <div ref={bottomRef} />
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            aria-label="메시지 입력"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="문서와 관련된 질문을 입력해 보세요..."
            rows={1}
            value={input}
          />
          <button className="send-button" disabled={!input.trim() || isLoading} type="submit" aria-label="메시지 보내기">
            ↑
          </button>
        </form>
      </section>
    </main>
  );
}
