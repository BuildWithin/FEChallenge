import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { Providers } from "./providers";
import "./globals.css";

// Geist — a modern grotesk with quiet character. One family, multiple weights:
// more disciplined than pairing two similar sans, and a deliberate step up from
// the system default the app was falling back to.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ATS Analytics Copilot",
  description: "Multi-tenant ATS analytics copilot take-home.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={geist.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
