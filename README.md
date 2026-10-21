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
| Fix a mistake | In the save panel, **Re-pick** or **×** discards it. After saving, **Undo** removes it. On the board: hover a card → trash icon; open a reference → trash icon in the header (or press <kbd>Delete</kbd>); or **Select** several → **Delete**. Every delete shows **Undo**. |
| Save a whole page | Toolbar icon → write a note → **Save whole page** |
| Organize | Boards, focus tags (Layout, Typography, Color, Component, Animation…), free tags and search, all on the board page (**Open board**) |
| Edit a reference | Click a card to edit its note and tags, move it to another board, view the palette, fonts, styles and HTML |
| Generate | **Select** → click cards in the order you want → **Generate**. You can copy the prompt, download it as `.md`, or **Download ZIP** |

### Keyboard shortcut not working?

Chrome only applies an extension's default shortcut when it is first installed, and skips it if another extension already uses that key. (On Windows, avoid Alt+Shift combinations, because Alt+Shift switches the keyboard language.) To set or change it, open `chrome://extensions/shortcuts`, or click **Set shortcut** in the Refboard popup. The right-click menu always works.

### What Refboard measures on every site

Each saved reference stores two layers: **this section** (what you picked) and **the whole site's design system**. The reference's **Design system** tab shows the site system, and its **DESIGN.md** tab has it ready to copy:

- **Colors with roles:** Primary, Accent, Background, Surface, Text Primary / Secondary / Light, Border. Near-duplicates are merged, and each color gets a token name.
- **Typography:** every font family with what it's used for (display / body / UI) and its share of the text; a named size scale (`text-xs` … `text-5xl`); weight and line-height scales; real h1–h4, p, link and button styles.
- **Spacing:** values in use, plus the base unit (4px or 8px grid) when the site follows one.
- **Radius, elevation and motion:** radius values, shadow levels, durations, easing, keyframe animations.
- **Layout:** container widths, grid columns and breakpoints (read from the site's media queries).
- **Components:** button variants, inputs, cards, badges and links, with exact styles and live previews.
- **CSS variables** defined by the site.
- **Usage guidance for AI agents:** contrast-checked color pairings and rules such as "keep spacing on a 4px grid" or "buttons are pill-shaped, uppercase".

### Using the output with Claude Code

**Generate** builds a ZIP:

```
refboard/
  PROMPT.md               ← each reference, your note, measured styles, site summary, instructions
  DESIGN.md               ← merged design system for your project
  tokens.css              ← ready-to-use CSS variables (colors, fonts, type scale, spacing, radius, shadows)
  sites/<site>.DESIGN.md  ← the full design system of every site you saved from
  refs/*.png              ← screenshots referenced by the files above
.claude/skills/<project>-design-references/SKILL.md   ← Claude Code skill
```

Unzip it into your project root and tell Claude Code: **"Read refboard/PROMPT.md and follow it."** The skill makes Claude use these references automatically whenever it works on UI in that project later.

### Focus tags decide which reference wins

When references disagree, the focus tags pick the winner. Typography tokens come only from references you tagged **Typography**, colors from those tagged **Color**, radius and shadows from **Component**, spacing from **Layout**, and motion from **Animation**. If no reference has the tag, Refboard merges all of them. So you can take colors from site A and type from site B.

### Bringing your own DESIGN.md (optional)

Refboard generates a DESIGN.md for every site itself. If you also have one from another tool (for example DESIGN.md Inspector), open the reference → Details → **Attach .md file**, and it will be included in prompts too.

## Project layout

```
manifest.json            Manifest V3
src/background.js        service worker: screenshots, cropping, thumbnails, saving
src/content/analyze.js   injected: reads computed styles and builds the summary
src/content/picker.js    injected: hover/click picker and the in-page save panel
src/popup/               toolbar popup
src/board/               the board page (grid, detail view, generator)
src/lib/db.js            IndexedDB storage
src/lib/generate.js      builds PROMPT.md, merged DESIGN.md and the ZIP file list (pure functions)
src/lib/design-md.js     per-site DESIGN.md, tokens.css and SKILL.md (pure functions)
src/lib/zip.js           tiny ZIP writer
test/                    unit tests: npm test (Node 20+)
scripts/make-icons.py    regenerates icons/ (needs Pillow)
```

## Roadmap

- [x] Phase 1: save pages with a note, tags and boards, plus the board UI
- [x] Phase 2: section picker with cropped screenshots and style capture
- [x] Phase 3a: template-based prompt, DESIGN.md and ZIP export, attaching DESIGN.md files
- [x] Full per-site design system extraction, per-site DESIGN.md, tokens.css and a Claude Code skill
- [ ] Phase 3b: optional AI pass (Claude API, your own key) to turn rough notes into a polished brief
- [ ] Phase 4: Supabase sync across devices
- [ ] Phase 4: MCP server so Claude Code can read boards directly ("use my SaaS landing board")
- [ ] Full-page (scrolling) screenshots for sections taller than the screen
