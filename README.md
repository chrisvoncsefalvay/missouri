# Missouri

**Review any web page — right in your browser.** Drop pins, highlight text, attach notes to elements, or sketch freehand. Your annotations stay local, persist across reloads, and optionally sync with AI coding agents so you can review together.

Missouri is a Chrome/Chromium extension for visual page review. If you've ever wished you could scribble on a web page the way you'd mark up a printed draft, this is it.

## What you can do

- **Pin comments** anywhere on a page
- **Attach notes to elements** — they follow the element across reloads
- **Highlight text** for copy-level review
- **Draw freehand** for quick sketches and markup
- **Let AI agents see your annotations** — agents interact via Playwright, no server needed

Everything is stored locally in your browser by default. Missouri has no hosted backend.

## Installing the Missouri skill

If you want your coding agent to understand Missouri annotations, install the repo skill directly:

```bash
npx skills add chrisvoncsefalvay/missouri
```

The repository is kept in sync with agent-specific skill directories for Claude Code, Cursor, Gemini, VS Code/Copilot-style agents, and other compatible harnesses. The canonical source file remains the top-level `SKILL.md`.

If you prefer a release artifact instead of installing from GitHub directly, download the `missouri-skills-universal-<version>.zip` asset from Releases, unzip it, and copy the folder for your agent harness into your project root or user-level skills directory.

## Getting started

### Install the extension

Fastest path:

1. Open the latest GitHub Release.
2. Download `missouri-extension-v<version>.zip`.
3. Unzip it somewhere stable on disk.
4. Load that unzipped folder via `chrome://extensions`.

```bash
cd extension
npm install
npm run build
```

Then load it into Chrome or Chromium:

1. Go to `chrome://extensions` (or `chromium://extensions`)
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/dist` folder

### Start reviewing

Click the Missouri icon in your toolbar to toggle annotation mode, or press **Ctrl+Shift+M** (Cmd+Shift+M on Mac).

A floating toolbar appears with four annotation modes:

| Mode | What it does |
|------|-------------|
| **Free** | Drop a pin anywhere on the page |
| **Element** | Attach a note to a specific element |
| **Highlight** | Select and highlight text |
| **Draw** | Freehand sketch over the page |

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd+Shift+M | Toggle annotation mode |
| Ctrl/Cmd+Shift+H | Show/hide the annotation overlay |
| Ctrl/Cmd+Shift+W | Enter highlight mode |

Annotations are saved per page and restored automatically when you return.

## Connecting AI agents

Missouri exposes a page-level API that coding agents access via Playwright's `page.evaluate()`. No server, no registration, no configuration.

1. Install the Missouri skill so your agent knows how to use the API:

   ```bash
   npx skills add chrisvoncsefalvay/missouri
   ```

2. The agent browses pages with Playwright and interacts with annotations directly:

   ```js
   // Read annotations
   await page.evaluate(() => window.__moDispatch('list_annotations'))

   // Create an annotation
   await page.evaluate(() => window.__moDispatch('create_annotation', {
     type: 'element',
     selector: '#login-button',
     note: 'This button needs an aria-label',
     authorName: 'Claude (via Playwright)'
   }))
   ```

See [SKILL.md](SKILL.md) for the full command reference.

## Privacy

All annotations live in your browser's local storage. See [docs/privacy-policy.md](docs/privacy-policy.md) for details.

## Distribution

GitHub Releases now attach two installable assets:

- `missouri-extension-v<version>.zip`: unpacked extension bundle for manual loading in Chrome/Chromium
- `missouri-skills-universal-<version>.zip`: provider-layout skill bundle for manual skill installation

For direct end-user installation on Windows and macOS, the extension will also be published to the Chrome Web Store. GitHub ZIPs are best treated as developer/manual-install artifacts.

## Development

For live rebuilds during development:

```bash
cd extension
npm run dev
```

Run tests:

```bash
cd extension
npm test              # unit tests
npm run build && npm run test:e2e   # end-to-end tests
npm run test:e2e:live               # attached Chromium via CDP
```

## Release automation

- GitHub release publishing runs `.github/workflows/release-extension.yml` to validate version alignment, build `extension/dist`, and attach a ready-to-unzip extension package to the release.
- Skill publishing runs `.github/workflows/publish-skill-pack.yml` to mirror the root `SKILL.md` into provider-specific skill directories and attach a universal skill bundle artifact to the release.


## Author

I'm [Chris von Csefalvay](chrisvoncsefalvay.com), an AI researcher specialising in post-training, and the author of _[Post-Training: A Practical Guide for
AI Engineers and Developers](https://posttraining.guide)_ (No Starch Press, 2026). I also write [Post-Slop](https://postslop.substack.com), a periodic diatribe about AI, and what it's doing for society. You can also find me on [LinkedIn](https://linkedin.com/in/chrisvoncsefalvay) and [X](https://x.com/epichrisis).


## License

MIT.