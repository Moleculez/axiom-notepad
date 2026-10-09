import type { Metadata, Viewport } from "next";
import { brandVersion } from "@axiom/shared/brand";
import "./styles";
import MathRendering from "../components/MathRendering";
import DatasetBoundary from "../components/DatasetBoundary";
import LocaleProvider from "../components/LocaleProvider";
import { appearanceBootScript } from "@axiom/shared/appearance-boot";
// The public cached HTML never contains account data.
const appearanceScript = appearanceBootScript();
export const metadata: Metadata = {
  title: "Axiom — A shared space for research",
  description:
    "A collaborative notebook for mathematics, physics, and machine learning. Write, connect, and think together.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: { url: `/icon.svg?v=${brandVersion}`, type: "image/svg+xml" },
    apple: {
      url: `/icons/180.png?v=${brandVersion}`,
      sizes: "180x180",
      type: "image/png",
    },
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f5f2",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
      </head>
      <body>
        <LocaleProvider>
          <DatasetBoundary>
            {children}
            <MathRendering />
          </DatasetBoundary>
        </LocaleProvider>
      </body>
    </html>
  );
}
