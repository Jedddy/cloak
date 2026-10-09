import type { Metadata } from "next";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";

import { AppNav } from "@/components/app-nav";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Cloak",
  description: "A private review desk for outgoing files.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex h-dvh flex-col overflow-hidden">
        <AppNav />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
