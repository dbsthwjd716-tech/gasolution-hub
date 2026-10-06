import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "지에이솔루션 통합 시스템",
  description: "거래처·광고 운영·정산을 한곳에서",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
