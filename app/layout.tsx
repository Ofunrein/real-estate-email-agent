import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Inbox",
  description: "Read-only monitor for Lumenosis real estate agent conversations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
