import type { Metadata } from "next";
import "./globals.css";

import { AppNav } from "@/components/app-nav";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "SentinelDesk",
  description: "A private review desk for outgoing files.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <AppNav />
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </div>
        <Toaster />
      </body>
    </html>
  );
}
