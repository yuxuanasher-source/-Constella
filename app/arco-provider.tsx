"use client";

import "@arco-design/web-react/es/_util/react-19-adapter";

import { ConfigProvider } from "@arco-design/web-react";
import zhCN from "@arco-design/web-react/es/locale/zh-CN";
import type { ReactNode } from "react";

type ArcoProviderProps = {
  children: ReactNode;
};

export function ArcoProvider({ children }: ArcoProviderProps) {
  return (
    <ConfigProvider
      autoInsertSpaceInButton
      locale={zhCN}
      size="default"
      tablePagination={{
        sizeCanChange: true,
        showTotal: true,
      }}
    >
      {children}
    </ConfigProvider>
  );
}
