---
name: missouri
description: Use when the user has page annotations from the Missouri Chrome extension, or asks you to look at, highlight, mark up, or comment on elements in a web page. Provides guidance on using Playwright page.evaluate() to read annotations, create markers, focus elements, and interact with Missouri's page API.
---

# Missouri — Page Annotations for Coding Agents

Missouri is a Chrome extension that lets users place visible annotations (markers, highlights, drawings) on any web page. When you browse with Playwright, you can read, create, and interact with these annotations via `page.evaluate()` — no server, no configuration.

## Install

Preferred install:

```bash
npx skills add chrisvoncsefalvay/missouri
```

Manual install:

1. Download the `missouri-skills-universal-<version>.zip` asset from GitHub Releases.
2. Unzip it.
3. Copy the folder matching your harness layout (for example `.agents/skills/missouri` or `.claude/skills/missouri`) into your project root or user-level skills directory.

## When to use this skill

- The user says "look at my annotations", "see what I marked", "check the page"
- The user asks you to highlight, point at, or mark something on a web page
- The user says "show me where X is" or "focus on that element"
- You need to understand what the user is referring to on a live web page
- You want to reply to or comment on something the user annotated

## Discovery

Missouri injects a shadow root with id `mo-marker-root` into every page. To check if Missouri is active:

```js
await page.evaluate(() => !!document.getElementById('mo-marker-root'))
```

The dispatch API is available at `window.__moDispatch(command, params)`. It returns a Promise.

## Commands

All commands are invoked via `page.evaluate()`:

```js
const result = await page.evaluate(() => window.__moDispatch('command_name', { ...params }))
```

### Reading annotations

| Command | Params | Returns |
|---------|--------|---------|
| `list_annotations` | none | `{ ok, data: Annotation[] }` |
| `get_annotation` | `{ id }` | `{ ok, data: Annotation }` |
| `get_page_info` | none | `{ ok, data: { url, title, annotationCount } }` |

### Creating & modifying annotations

| Command | Params | Returns |
|---------|--------|---------|
| `create_annotation` | `{ type, selector?, note?, pageX?, pageY?, colorIndex?, authorName? }` | `{ ok, data: Annotation }` |
| `update_annotation` | `{ id, note?, authorName? }` | `{ ok, data: Annotation }` |
| `delete_annotation` | `{ id }` | `{ ok }` |

### Visual interaction

| Command | Params | Returns |
|---------|--------|---------|
| `focus_annotation` | `{ id }` | `{ ok }` — scrolls to and pulses the marker |
| `highlight_element` | `{ selector }` | `{ ok, data: { selector, tagName } }` — temporary blue highlight |

## Understanding annotation data

Each annotation contains:
- **type**: `free` (placed anywhere), `element` (attached to a DOM element), `highlight` (text selection), `draw` (freehand)
- **authorName**: display name for whoever created the annotation — set this to identify agent-created annotations (e.g. `"Claude (via Playwright)"`)
- **note**: the user's text comment — this is their message to you
- **anchor**: for element markers, includes `selector` (CSS path), `tagName`, and `text` (element content, truncated to 120 chars)
- **anchor.selectedText**: for highlights, the exact text the user selected
- **position**: `{ pageX, pageY }` — where the marker is on the page
- **letter**: optional A-Z label the user assigned (for referencing: "look at marker B")
- **colorIndex**: 0=dark, 1=blue, 2=gold, 3=purple — users may use colors to categorize
- **resolved**: whether the target element/text was found in the current DOM

## Examples

### Read all annotations

```js
const { data } = await page.evaluate(() => window.__moDispatch('list_annotations'))
// data is an array of Annotation objects
```

### Create an element annotation

```js
await page.evaluate(() => window.__moDispatch('create_annotation', {
  type: 'element',
  selector: '#login-button',
  note: 'This button needs an aria-label',
  authorName: 'Claude (via Playwright)',
  colorIndex: 3
}))
```

### Create a free-position annotation

```js
await page.evaluate(() => window.__moDispatch('create_annotation', {
  type: 'free',
  pageX: 200,
  pageY: 400,
  note: 'Layout breaks below this fold',
  authorName: 'Claude (via Playwright)'
}))
```

### Focus an annotation

```js
await page.evaluate((id) => window.__moDispatch('focus_annotation', { id }), annotationId)
```

### Highlight an element temporarily

```js
await page.evaluate(() => window.__moDispatch('highlight_element', { selector: '.hero-banner' }))
```

### Update an annotation's note

```js
await page.evaluate((id) => window.__moDispatch('update_annotation', {
  id,
  note: 'Updated: this is now fixed'
}), annotationId)
```

### Delete an annotation

```js
await page.evaluate((id) => window.__moDispatch('delete_annotation', { id }), annotationId)
```

## Workflow patterns

### "What am I looking at?" — Reading the user's annotations

```
1. page.evaluate(() => window.__moDispatch('get_page_info'))
2. page.evaluate(() => window.__moDispatch('list_annotations'))
3. Read each annotation's note + anchor to understand context
```

### "Show me where X is" — Highlighting for the user

```
1. highlight_element with the CSS selector (temporary)
   OR
1. create_annotation with a note explaining what you found (persistent)
2. focus_annotation to scroll it into view
```

### "Reply to annotation B" — Responding to user feedback

```
1. list_annotations → find the annotation with letter "B"
2. update_annotation → edit the note with your response
   OR
2. create_annotation → place a new marker nearby with your reply
```

## Tips

- Always call `list_annotations` first to see what the user has marked before taking action
- Use `type: "element"` with a `selector` when you know the CSS selector — the marker tracks the element even if the page reflows
- Use `type: "free"` with `pageX` / `pageY` for pixel-precise placement
- Use `colorIndex: 3` (purple) by default for agent-created annotations to distinguish them from user markers
- Set `authorName` to identify your annotations (e.g. `"Claude (via Playwright)"`)
- Annotations with `resolved: false` mean the DOM has changed since the annotation was placed
- The `anchor.text` field gives visible text content, often more useful than the CSS selector for understanding intent
- When multiple annotations exist, pay attention to `letter` labels — users assign these for easy reference
- All changes persist to `chrome.storage.local` and survive page reloads
