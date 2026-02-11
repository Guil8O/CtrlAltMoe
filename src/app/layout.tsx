import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ctrl+Alt+Moe",
  description: "VRM + Text-based AI Chat companion",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-accent="mint" suppressHydrationWarning>
      <body className="antialiased" style={{ overflow: 'hidden' }}>
        {children}
      </body>
    </html>
  );
}
