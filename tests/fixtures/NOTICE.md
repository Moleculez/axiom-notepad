# Specification fixtures

`commonmark.json` contains the 652 examples from [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/), by John MacFarlane, downloaded from its official `spec.json` distribution. The specification is licensed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).

`gfm.json` contains 24 extension examples extracted from the [GitHub Flavored Markdown specification](https://github.github.com/gfm/) in [github/cmark-gfm, test/spec.txt](https://github.com/github/cmark-gfm/blob/master/test/spec.txt). It builds on John MacFarlane's specification with GitHub contributors. The source declares CC-BY-SA 4.0; see its [copyright and license notice](https://github.com/github/cmark-gfm/blob/master/COPYING). Extraction retains the Markdown and expected HTML, selects extension sections, converts the specification's tab markers to tabs, and stores the examples in JSON.

These fixture files remain under CC-BY-SA 4.0. The handwritten Axiom parser is separate original application code; it does not embed a third-party Markdown implementation. Use `npm run fixtures` to refresh the fixtures from the above sources and rerun conformance tests after changes.
