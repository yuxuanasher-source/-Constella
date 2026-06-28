import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "经营舱",
  description: "游戏直播 MCN 项目经营系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
