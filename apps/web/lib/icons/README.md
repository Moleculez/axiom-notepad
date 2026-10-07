# Shared menu icon assets

Action menus use one typed catalog and React/native-DOM adapters. `ContextAction.icon`
is required; use action identity, never label matching. `editor-commands.ts` covers
every editor command and is shared by slash completion, command search and block
controls. Structural table glyphs are first-party 24px geometry. `action-data.json`
contains a curated subset of Lucide 0.577.0 SVG node definitions; its ISC notice is
in `LUCIDE-LICENSE.txt`. No runtime package or full icon library is loaded.

`language-mappings.json` records a neutral semantic icon for all 136 installed
language entries. The resolver shares the editor's language aliases but never
writes an info string. Identifying labels retain their correct language names;
optional vendor marks are not displayed or loaded into the runtime renderer.

Native SVG action icons use current semantic text colors in all modes, including
forced colors. There are no external image requests or logo-loading failures.
The historical `language-data.json` source inventory and `DEVICON-LICENSE.txt`
remain as upstream provenance; their original notices are not removed or rewritten.

When updating the catalog, copy only required SVG node data from the installed
Lucide icon module's `__iconNode` export (follow re-exported aliases), retaining
its notice. Add language mappings using the existing typed action catalog rather
than adding vendor marks or new image assets.
Never accept scripts, event attributes, embedded images, external references or
user-defined SVG. Run the icon catalog units, cross-browser menu/language tests,
and desktop visual acceptance after changes.
