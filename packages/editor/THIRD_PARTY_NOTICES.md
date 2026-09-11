# Editor dependencies

Axiom's editor adapters are first-party code. The application links the following
upstream MIT-licensed packages; their exact versions and transitive dependencies
are recorded in the root lockfile. This is integration, not a vendored fork of
Milkdown/CodeMirror and not a copy of Typora.

- Milkdown Kit 7.22.1 and its Milkdown packages: Copyright (c) 2020-present Mirone.
  https://github.com/Milkdown/milkdown
- CodeMirror 6 packages: Copyright (C) 2018-2021 by Marijn Haverbeke
  <marijn@haverbeke.berlin> and others. https://github.com/codemirror
- ProseMirror packages: Copyright (C) 2015-2017 by Marijn Haverbeke
  <marijn@haverbeke.berlin> and others. https://github.com/ProseMirror
- Lezer highlight: Copyright (C) 2018 by Marijn Haverbeke
  <marijn@haverbeke.berlin> and others. https://github.com/lezer-parser

## MIT license

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Optional document font

LaTeX Article uses four web-format derivatives of Latin Modern Roman 2.005 by
Bogusław Jackowski and Janusz Marian Nowacki / GUST. These font assets are under
the GUST Font License / LPPL 1.3c or later, not the MIT license above.
See [the font manifest, source and conversion notes](../shared/assets/latin-modern/README.md)
and [the complete license](../shared/assets/latin-modern/LICENSE.txt).
Axiom maintains the web conversion; the upstream font authors do not support it.
