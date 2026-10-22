# Refboard

A Pinterest-style board for **website design references**, as a Chrome extension, that saves everything into **real project folders** you can hand straight to Claude Code.

While browsing, press a shortcut to save a screenshot, pick a section, or **screen-record an animation**. Refboard measures the site's design system (colors, type, spacing, components with hover/focus states, motion) and, when you click **Build**, writes a professional `DESIGN.md` and `SKILL.md` into the project folder.

## Install (developer mode)

1. Clone or download this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `refboard` folder.
4. Pin the Refboard icon to the toolbar.

No build step and no dependencies. It's plain JavaScript. Chrome 116 or newer.

## Set up once

1. Open the board (toolbar icon → **Open board**) and click **Choose folder**. Pick (or create) a folder, e.g. `Documents/Refboard`.
2. Click **+ New project**. It becomes a subfolder and the **active project**: every shortcut saves into it. Switch the active project any time from the popup.

After a browser restart Chrome may ask you to **Reconnect folder** (one click on the board). Captures you make before that are kept in Chrome and written to the folder as soon as you reconnect.

## Capture while browsing

| Shortcut | What it does |
|---|---|
| <kbd>Ctrl+Shift+S</kbd> (<kbd>⌘+Shift+S</kbd>) | **Screenshot:** saves the visible screen instantly into the active project, plus the site's measured design system. A small toast lets you **Add note** or **Undo**. |
| <kbd>Ctrl+Shift+E</kbd> (<kbd>⌘+Shift+E</kbd>) | **Record an area:** draw a box (or click an element) and recording starts. Press the shortcut again, or **Stop**, to finish (max 60s). Saves the video, the key frames, a contact sheet and the measured motion. |
| <kbd>Ctrl+Shift+Y</kbd> (<kbd>⌘+Shift+Y</kbd>) | **Pick a section:** click an element or drag a box, then add a note, focus tags and project. <kbd>↑</kbd>/<kbd>↓</kbd> resize the selection, <kbd>Enter</kbd> picks, <kbd>Esc</kbd> cancels. |
| Toolbar popup | Switch the active project, run any of the above, or save the whole page with a note. |
| Right-click menu | The same three actions, even without shortcuts. |

**Shortcuts not working?** Chrome assigns default shortcuts when the extension is installed and skips any that another extension already uses. Check or change them at `chrome://extensions/shortcuts` (or **Change shortcuts** in the popup).

## The project folder

```
Refboard/                       ← the folder you chose
  Tape Shop/                    ← one subfolder per project
    SKILL.md                    ← Claude Code skill: what's here and how to use it
    DESIGN.md                   ← the design system (written by Build)
    PROMPT.md                   ← kickoff brief with your notes
    references.md               ← every capture, its note and files
    tokens.css · tokens.json · tailwind.theme.js
    screenshots/                ← written the moment you capture
    recordings/                 ← .mp4 or .webm
    frames/<recording>/         ← key frames + contact-sheet.jpg (numbered, with timestamps)
    sites/<site>.DESIGN.md      ← full measured system of each source site
    refboard.json               ← lets the board be restored from the folder
```

Screenshots, recordings and frames are written as you capture. The Markdown files and tokens are written when you click **Build files** on the project's board.

**Using it with Claude Code:** point Claude at the folder ("Read Tape Shop/SKILL.md and follow it"), or copy the project folder into your repo's `.claude/skills/` so Claude loads it automatically whenever it works on UI.

### Why recordings come with frames and motion data

Claude can't watch video files. So for every recording Refboard also saves:
- **Key frames** (where something visibly changed) and a **contact sheet** that shows them all in one image, numbered with timestamps.
- **Measured motion:** the browser's own animation data (CSS animations and transitions with their keyframes, duration and easing), plus how elements in the area moved and faded over time (this catches JavaScript-driven effects too), and what you did (scroll, hover, click).

Refboard turns that into effects such as *"3 cards move up 40px and fade in when they scroll into view, 600ms cubic-bezier(0.2, 0.8, 0.2, 1), staggered ~120ms"*, each with a CSS starting point, in `DESIGN.md` §7.

## On the board

| Action | How |
|---|---|
| Organize | Projects, focus tags (Layout, Typography, Color, Component, Animation…), free tags and search |
| Edit a reference | Click a card: edit the note and tags, move it to another project (its files move too), see the section styles, the site's design system and its DESIGN.md. Recordings have **Motion** and **Frames** tabs. |
| Fix a mistake | **Undo** in the toast after saving; on the board, hover a card → trash, or open it → trash in the header (or <kbd>Delete</kbd>), or **Select** several → **Delete**. Deleting also removes the files; **Undo** brings them back. |
| Build | Open a project → **Build files**. |
| Export ZIP | Select references (or none for all) → **Export ZIP**, for sharing without the folder. |
| Restore | Chrome data cleared? **Restore from folder** rebuilds the board from each project's `refboard.json` and media. |

### What Refboard measures on every site

Each saved reference stores two layers: **this section** (what you picked) and **the whole site's design system**. The reference's **Design system** tab shows the site system, and its **DESIGN.md** tab has it ready to copy:

- **Colors with roles:** Primary, Accent, Background, Surface, Text Primary / Secondary / Light, Border. Near-duplicates are merged, and each color gets a token name.
- **Typography:** every font family with what it's used for (display / body / UI) and its share of the text; a named size scale (`text-xs` … `text-5xl`); weight and line-height scales; real h1–h4, p, link and button styles.
- **Spacing:** values in use, plus the base unit (4px or 8px grid) when the site follows one.
- **Radius, elevation and motion:** radius values, shadow levels, durations, easing, keyframe animations.
- **Layout:** container widths, grid columns and breakpoints (read from the site's media queries).
- **Components:** button variants, inputs, cards, badges and links, with exact styles, live previews, and their **:hover / :focus / :active** states and transitions read from the site's CSS.
- **Motion:** `@keyframes` the site uses and animations that are running (loops, marquees).
- **CSS variables** defined by the site.
- **Usage guidance for AI agents:** contrast-checked color pairings and rules such as "keep spacing on a 4px grid" or "buttons are pill-shaped, uppercase".

### Focus tags decide which reference wins

When references disagree, the focus tags pick the winner. Typography tokens come only from references you tagged **Typography**, colors from those tagged **Color**, radius and shadows from **Component**, spacing from **Layout**, and motion from **Animation**. If no reference has the tag, Refboard merges all of them. So you can take colors from site A and type from site B.

### Bringing your own DESIGN.md (optional)

Refboard generates a DESIGN.md for every site itself. If you also have one from another tool (for example DESIGN.md Inspector), open the reference → Details → **Attach .md file**, and it will be included in prompts too.

## Project layout

```
manifest.json            Manifest V3
src/background.js        service worker: shortcuts, active project, screenshots, recording flow, toasts
src/offscreen/           hidden page: records the tab and writes files to the folder
src/content/analyze.js   injected: measures the page's design system
src/content/picker.js    injected: hover/click/drag picker (save mode and record mode)
src/content/motion.js    injected while recording: animation data, element motion, scroll/hover/click
src/popup/               toolbar popup
src/board/               the board page
src/lib/db.js            IndexedDB storage (projects, references, settings)
src/lib/fsstore.js       writes into the chosen folder (File System Access API)
src/lib/paths.js         file names inside a project folder
src/lib/recorder.js      crops the tab video, picks key frames, builds the contact sheet
src/lib/motion.js        turns motion data into effects + CSS (pure functions)
src/lib/project-docs.js  DESIGN.md, SKILL.md, PROMPT.md, references.md, tokens (pure functions)
src/lib/design-md.js     per-site DESIGN.md (pure functions)
src/lib/generate.js      prompt + ZIP export (pure functions)
test/                    unit tests: npm test (Node 20+)
```

## Limits

- Screenshots capture what's visible on screen; scroll a tall section into view first.
- Recording captures the current tab only (not other windows), up to 60 seconds, without sound.
- Chrome blocks extensions on `chrome://` pages and the Chrome Web Store.
- Font previews use the site's fonts only if they're installed on your computer; the names are always recorded.

## Roadmap

- [x] Save pages and sections with notes, tags and projects; section picker; full design-system extraction
- [x] Project folders on disk, keyboard shortcuts, area screen recording with motion analysis
- [x] Professional DESIGN.md, SKILL.md, tokens (CSS, JSON, Tailwind) built per project
- [ ] Optional AI pass (Claude API, your own key) to turn rough notes into a polished brief
- [ ] MCP server so Claude Code can read projects directly
- [ ] Full-page (scrolling) screenshots
