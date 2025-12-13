# (WIP) Cite Forge

A citation management workbench for Wikipedia. Inspect, search, edit, and copy references from a floating panel.

## Features

- **Floating panel** – Collapsible panel (bottom-left) with portlet toggle; remembers visibility and size across sessions
- **Reference browser** – Alphabetical index, search filter, and refresh button to navigate all citations
- **Inline editing** – Click the edit icon to rename references (including previously unnamed ones); conflicts are highlighted and block saving until resolved; changes are queued for batch saving
- **Highlight & scroll** – Selecting a reference highlights and scrolls to its uses in the article (with blink animation)
- **Copy options** – Copy ref names (raw, `{{r|name}}`, or `<ref name="..." />`) or raw citation content
- **Save to diff** – Applies wikitext transforms and opens the standard MediaWiki diff in a new tab (no direct API saves)
- **Hover popup** – Quick copy button on reference superscripts (optional, toggle in settings)
- **Harv checks** – Highlights CS1/CS2 style, Harv link/target issues, page-range anomalies, COinS metadata gaps, and sorting/duplicate problems (adapted from [reviewsourcecheck](https://en.wikipedia.org/wiki/User:Lingzhi2/reviewsourcecheck)/[HarvErrors](https://en.wikipedia.org/wiki/User:Ucucha/HarvErrors))
- **Theme support** – Adapts to light/dark/system preference; namespace-aware (disabled on non-wikitext pages)
- **Wikitext transforms** (configurable): rename, dedupe, normalize ref markup, prefer `{{r}}` or `<ref>`, move refs inline↔LDR (all-inline, all-LDR, or threshold), sort reflist entries, keep copies vs dedupe, and rename nameless refs
- **Template support** – Parses `<ref>`, self-closing `<ref />`, `{{r}}` (including chained names), and reflist `refs=` blocks
- **Mass renamer** – Pick multiple naming parts (author/title/work/domain/year/full date/etc.), collision suffix style, and punctuation/diacritic handling. Applies generated renames back into the inspector’s pending changes for diff preview.

## Installation

### Build from source

```bash
npm install
npm run build
```

Upload `dist/bundled.js` to your wiki userspace (e.g., `User:YourName/CiteForge.js`), then load it via your `common.js`:

```js
mw.loader.load('//en.wikipedia.org/w/index.php?title=User:YourName/CiteForge.js&action=raw&ctype=text/javascript');
```

## Development

```bash
npm run build:debug   # Build with sourcemaps
npm run lint          # ESLint check
npm test              # Run Vitest tests
```

## Credits

- Icons and assets from:
  - [Codex](https://doc.wikimedia.org/codex/latest/) (MIT and CC BY 4.0) by Wikimedia Foundation
  - [Codicons](https://github.com/microsoft/vscode-codicons) (MIT and CC BY 4.0) by Microsoft
- Inspired by the following works:
  - [QuickEditExt-Citations](https://github.com/QZGao/QuickEditExt-Citations) (MIT) by SuperGrey
  - [refOrganizer](https://github.com/QZGao/refOrganizer) and its upstream [refCon](https://github.com/Cumbril/refcon) (GNU GPL 3.0) by Kaniivel, SuperGrey, et al.
  - [ProveIt](https://en.wikipedia.org/wiki/Wikipedia:ProveIt) (CC BY-SA 3.0 and GPL 2.0) by [ProveIt contributors](https://www.mediawiki.org/wiki/ProveIt#Credits)
  - [RefRenamer](https://en.wikipedia.org/wiki/User:Nardog/RefRenamer) (CC BY-SA 4.0) by Nardog
  - [Citation Style Marker](https://en.wikipedia.org/wiki/User:BrandonXLF/CitationStyleMarker) (CC BY-SA 4.0) by BrandonXLF
  - [HarvErrors](https://en.wikipedia.org/wiki/User:Ucucha/HarvErrors) (CC BY-SA 4.0) by Ucucha
  - [reviewsourcecheck](https://en.wikipedia.org/wiki/User:Lingzhi2/reviewsourcecheck) (CC BY-SA 4.0) by Lingzhi2 & Ucucha
