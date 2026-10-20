# Refboard

A Pinterest-style board for **website design references**, as a Chrome extension.

While browsing, save a whole page or pick one section (a nav, a pricing card, a hero). Add a note about *what* you want to use from it. Later, select a few references and Refboard writes a **prompt for Claude Code** and a **DESIGN.md**, with your notes, measured styles and screenshots, so Claude knows exactly what you mean.

## Install (developer mode)

1. Clone or download this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `refboard` folder.
4. Pin the Refboard icon to the toolbar.

No build step and no dependencies. It's plain JavaScript.

## Use it

| Action | How |
|---|---|
| Save one section of a page | Toolbar icon → **Pick a section**, right-click the page → **Pick a section to save in Refboard**, or press <kbd>Ctrl+Shift+Y</kbd> (<kbd>⌘+Shift+Y</kbd> on Mac). Then **click** an element, or **drag** to draw a box around exactly what you want. <kbd>↑</kbd>/<kbd>↓</kbd> make a hovered selection bigger or smaller, <kbd>Enter</kbd> picks it, <kbd>Esc</kbd> cancels. |
| Fix a mistake | In the save panel, **Re-pick** or **×** discards it. After saving, **Undo** removes it. On the board, hover a card → trash icon (with Undo), or **Select** several → **Delete**. |
| Save a whole page | Toolbar icon → write a note → **Save whole page** |
| Organize | Boards, focus tags (Layout, Typography, Color, Component, Animation…), free tags and search, all on the board page (**Open board**) |
| Edit a reference | Click a card to edit its note and tags, move it to another board, view the palette, fonts, styles and HTML |
| Generate | **Select** → click cards in the order you want → **Generate**. You can copy the prompt, download it as `.md`, or **Download ZIP** |

### Keyboard shortcut not working?

Chrome only applies an extension's default shortcut when it is first installed, and skips it if another extension already uses that key. (On Windows, avoid Alt+Shift combinations, because Alt+Shift switches the keyboard language.) To set or change it, open `chrome://extensions/shortcuts`, or click **Set shortcut** in the Refboard popup. The right-click menu always works.

### Using the output with Claude Code

The ZIP contains:

```
refboard/
  PROMPT.md      ← references, your notes, measured styles, merged tokens, instructions
  DESIGN.md      ← a design-system file built from the same references
  refs/*.png     ← screenshots referenced by both files
```

Unzip it into your project and tell Claude Code: **"Read refboard/PROMPT.md and follow it."**

### Focus tags decide which reference wins

When references disagree, the focus tags pick the winner. Typography tokens come only from references you tagged **Typography**, colors from those tagged **Color**, radius and shadows from **Component**, spacing from **Layout**, and motion from **Animation**. If no reference has the tag, Refboard merges all of them. So you can take colors from site A and type from site B.

### Works with DESIGN.md Inspector

[DESIGN.md Inspector](https://chromeboard.com/extension/designmd-inspector-epjfmkfakeffbidacbkpalcioflhaldm) extracts a site's full token set. Refboard records which part you want and why. To use both:

1. Run DESIGN.md Inspector on a site and download its `DESIGN.md`.
2. In Refboard, open that site's reference and click **Attach .md file**.
3. When you generate, keep **Include attached DESIGN.md files** checked. That site's full design system is then included under its reference.

## What gets captured

- A screenshot, cropped to the section you picked. Only the visible part of the screen is captured, so scroll a tall section into view first.
- Styles read from the live page with `getComputedStyle`: palette, font families and weights, type scale, radius, shadows, spacing, transitions, layout properties of the section, and the site's `:root` CSS variables.
- A trimmed HTML snippet of the section, with scripts, inline SVG paths and noisy attributes removed.
- The URL, page title and favicon.

Everything is stored **locally** in your browser (IndexedDB). Nothing is sent anywhere. Use **Export backup** / **Import backup** on the board page to move references between browsers.

## Project layout

```
manifest.json            Manifest V3
src/background.js        service worker: screenshots, cropping, thumbnails, saving
src/content/analyze.js   injected: reads computed styles and builds the summary
src/content/picker.js    injected: hover/click picker and the in-page save panel
src/popup/               toolbar popup
src/board/               the board page (grid, detail view, generator)
src/lib/db.js            IndexedDB storage
src/lib/generate.js      builds PROMPT.md and DESIGN.md (pure functions)
src/lib/zip.js           tiny ZIP writer
test/                    unit tests: npm test (Node 20+)
scripts/make-icons.py    regenerates icons/ (needs Pillow)
```

## Roadmap

- [x] Phase 1: save pages with a note, tags and boards, plus the board UI
- [x] Phase 2: section picker with cropped screenshots and style capture
- [x] Phase 3a: template-based prompt, DESIGN.md and ZIP export, attaching DESIGN.md files
- [ ] Phase 3b: optional AI pass (Claude API, your own key) to turn rough notes into a polished brief
- [ ] Phase 4: Supabase sync across devices
- [ ] Phase 4: MCP server so Claude Code can read boards directly ("use my SaaS landing board")
- [ ] Full-page (scrolling) screenshots for sections taller than the screen
