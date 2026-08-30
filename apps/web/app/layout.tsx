import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "EventPilot — Build it. Simulate it. Prove it on-chain.",
  description:
    "A no-wallet strategy policy studio and public evidence console for DreamDEX Event Contracts on Somnia Shannon testnet.",
  openGraph: {
    title: "EventPilot",
    description: "Build it. Simulate it. Prove it on-chain.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "EventPilot",
    description: "Build it. Simulate it. Prove it on-chain.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${manrope.variable} ${plexMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
