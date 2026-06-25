"use client";

import { Button } from "@heroui/react";

export default function HeroUiSmokePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-lg font-semibold">HeroUI smoke test</h1>
      <p className="text-sm text-ink-500">
        如果下面的按钮带有 HeroUI 样式，说明集成成功。
      </p>
      <Button variant="primary">HeroUI Button</Button>
    </main>
  );
}
