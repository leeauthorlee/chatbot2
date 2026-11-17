"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LandingPage() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
    if (new URLSearchParams(window.location.search).get("error") === "auth") {
      setError("Google 로그인에 실패했어요. Supabase에서 Google 제공자가 켜져 있는지 확인해 주세요.");
    }
  }, []);

  async function signIn() {
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/chat`,
      },
    });
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
    }
  }

  return (
    <main className="landing">
      <header className="landing-nav">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">모</span>
          모두의 AI
        </span>
      </header>
      <section className="landing-hero">
        <p className="eyebrow">KNOWLEDGE FOR EVERYONE</p>
        <h1>질문하면, 자료에서 답을 찾아요.</h1>
        <p className="landing-copy">
          모두의 AI는 준비한 문서를 바탕으로 답하는 RAG 챗봇이에요.
          Google 계정으로 로그인하면 대화를 이어서 볼 수 있고, 질문과 답변은 내 계정에만 저장돼요.
        </p>
        {signedIn ? (
          <button className="google-button" type="button" onClick={() => router.push("/chat")}>
            챗봇으로 이동
          </button>
        ) : (
          <button className="google-button" type="button" onClick={() => void signIn()} disabled={busy}>
            <span className="google-mark" aria-hidden="true">G</span>
            {busy ? "연결 중..." : "Google로 시작하기"}
          </button>
        )}
        {error && <p className="error-message landing-error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
