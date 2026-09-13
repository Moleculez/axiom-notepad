import type { Metadata, Viewport } from "next";
import { brandVersion } from "@axiom/shared/brand";
import "../../../packages/shared/assets/latin-modern/fonts.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-serif-4/400-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/inter/400-italic.css";
import "@fontsource/source-serif-4/700.css";
import "@fontsource/source-serif-4/600-italic.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/400-italic.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/500.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";
import "@fontsource/source-sans-3/400-italic.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/atkinson-hyperlegible/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/400-italic.css";
import "./globals.css";
import "./appearance.css";
import "./pdf-text-layer.css";
import "./research.css";
import "./workspace-design.css";
import "./editor-design.css";
import "./workbench.css";
import "./refinement.css";
import "./native-editor.css";
import "./editor-vnext.css";
import "./productivity.css";
import "./editor-paper.css";
import "./settings.css";
import "./canvas.css";
import "./workspace-refinement.css";
import "./management-console.css";
import "./application-tabs.css";
import "./file-workflows.css";
import "./menu-icons.css";
import "./research-tools.css";
import "./file-workbench.css";
import "./reading-marks.css";
import "./visual-viewer.css";
import "./minimap.css";
import "../themes/paper-research.css";
import "../themes/technical-slate.css";
import "../../../packages/shared/assets/document-decorations.css";
import "../../../packages/shared/assets/document-tasks.css";
import MathRendering from "../components/MathRendering";
import DatasetBoundary from "../components/DatasetBoundary";
import { defaults, appearanceVariables } from "@axiom/shared/appearance";
import { themePackIds } from "@axiom/shared/theme-packs";
const initialAppearance = {
  mode: "system",
  themePack: "default",
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
