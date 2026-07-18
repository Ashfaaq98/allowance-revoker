import type {Metadata, Viewport} from "next";
import {JetBrains_Mono, Space_Grotesk} from "next/font/google";
import "./globals.css";
import {Providers} from "./providers";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Allowance Revoker — Monad",
  description:
    "Find every token approval your Monad wallet has ever granted, see which ones are dangerous, and revoke them. Each cleanup is proven on-chain.",
};

export const viewport: Viewport = {
  themeColor: "#08070c",
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
