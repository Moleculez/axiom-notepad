# Shared menu icon assets

Action menus use one typed catalog and React/native-DOM adapters. `ContextAction.icon`
is required; use action identity, never label matching. `editor-commands.ts` covers
every editor command and is shared by slash completion, command search and block
controls. Structural table glyphs are first-party 24px geometry. `action-data.json`
contains a curated subset of Lucide 0.577.0 SVG node definitions; its ISC notice is
in `LUCIDE-LICENSE.txt`. No runtime package or full icon library is loaded.

`language-data.json` records all 136 installed language entries. There are 58
Devicon SVG assets shared by 63 entries; the other 73 entries have explicit
semantic fallback icons. The immutable upstream revision and original SVG paths
are included in that file. `DEVICON-LICENSE.txt` preserves the MIT notice.
Logos identify languages/tools and do not imply endorsement. Brand ownership
remains with the respective owners.

The resolver shares the editor's language aliases but never writes an info
string. SVGs are bundled data, displayed as isolated image data URLs, not injected
HTML or remotely fetched assets. They therefore travel with hashed editor chunks
and the existing offline precache. Brand logos retain their colors on a neutral
backing; forced colors and load failures use their semantic glyph instead.

When updating the catalog, copy only required SVG node data from the installed
Lucide icon module's `__iconNode` export (follow re-exported aliases), retaining
its notice. Pin Devicon updates to a commit and record the source path of each
reviewed SVG. Prefer compact original logos; Groovy uses the smaller plain mark.
Never accept scripts, event attributes, embedded images, external references or
user-defined SVG. Run the icon catalog units, cross-browser menu/language tests,
and desktop visual acceptance after changes.
