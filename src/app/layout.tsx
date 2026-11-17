import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "모두의 AI",
  description: "준비한 문서를 바탕으로 답하는 RAG 챗봇입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
