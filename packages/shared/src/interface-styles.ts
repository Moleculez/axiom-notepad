/** Component treatments, independent of palettes and document typography. */
export const interfaceStyleIds = [
  "axiom",
  "material",
  "fluent",
  "editorial",
  "macos",
] as const;
export type InterfaceStyleId = (typeof interfaceStyleIds)[number];
export const interfaceStyles: readonly {
  id: InterfaceStyleId;
  name: string;
  description: string;
  reference?: string;
}[] = [
  {
    id: "axiom",
    name: "Axiom",
    description: "Balanced, quiet research controls",
  },
  {
    id: "material",
    name: "Material Tonal",
    description: "Rounded shapes, tonal surfaces and expressive controls",
    reference: "https://m3.material.io/",
  },
  {
    id: "fluent",
    name: "Fluent Studio",
    description: "Precise borders, layered panels and clear selection",
    reference: "https://fluent2.microsoft.design/components/web/react/",
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Flat paper surfaces and understated rules",
  },
  {
    id: "macos",
    name: "macOS Studio",
    description: "Soft grouped surfaces and understated desktop chrome",
    reference:
      "https://developer.apple.com/design/human-interface-guidelines/toggles",
  },
];
