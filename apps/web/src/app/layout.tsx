import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin-shell";
import { getDictionary } from "@/lib/dictionaries";
import "./globals.css";

const dictionary = getDictionary();

export const metadata: Metadata = {
  title: `${dictionary.productName} - ${dictionary.workspaceName}`,
  description: "多店铺、多语言 Shopify AI Blog 管理后台"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
