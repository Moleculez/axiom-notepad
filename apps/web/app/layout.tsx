import type { Metadata, Viewport } from "next";
import { brandVersion } from "@axiom/shared/brand";
import "./styles";
import MathRendering from "../components/MathRendering";
import DatasetBoundary from "../components/DatasetBoundary";
import { defaults, appearanceVariables } from "@axiom/shared/appearance";
import { themePackIds } from "@axiom/shared/theme-packs";
const initialAppearance = {
  mode: "system",
  themePack: "default",
  interfaceStyle: "axiom",
  light: appearanceVariables(defaults, false),
  dark: appearanceVariables(defaults, true),
  motion: "system",
  density: "comfortable",
  focus: "false",
  documentDecorations: "none",
};
// The public cached HTML never contains account data.
const appearanceScript = `(function(){try{
  var d=${JSON.stringify(initialAppearance)},r=document.documentElement,
    s=JSON.parse(localStorage.getItem('axiom:session')||'null'),
    c=JSON.parse(localStorage.getItem('axiom:appearance')||'null');
  if(c&&s&&c.userId===s.user.id&&!localStorage.getItem('axiom:pending-signout'))d=c;
  var dark=d.mode==='dark'||(d.mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
  r.dataset.theme=dark?'dark':'light';r.style.colorScheme=dark?'dark':'light';
  r.dataset.themePack=${JSON.stringify(themePackIds)}.includes(d.themePack)?d.themePack:'default';
  r.dataset.interfaceStyle=['axiom','material','fluent','editorial'].includes(d.interfaceStyle)?d.interfaceStyle:'axiom';
  r.dataset.motion=d.motion;r.dataset.density=d.density;r.dataset.focus=d.focus;
  r.dataset.documentDecorations=d.documentDecorations==='latex'?'latex':'none';
  Object.entries(dark?d.dark:d.light).forEach(function(v){
    if(/^--[a-z-]+$/.test(v[0])&&typeof v[1]==='string'&&!/url\\s*\\(|[<>]/i.test(v[1]))r.style.setProperty(v[0],v[1]);
  });
}catch(e){}})();`;
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
        <DatasetBoundary>
          {children}
          <MathRendering />
        </DatasetBoundary>
      </body>
    </html>
  );
}
