# Contributing

Thanks for helping make Page to Markdown better. Bug reports, fixes for specific sites and new ideas are all welcome.

## Reporting a problem

Use the [issue templates](https://github.com/cobuild-labs/page-to-markdown/issues/new/choose). The most useful reports include:

- a **public** URL where it goes wrong,
- what you expected and what you got,
- your browser and extension version (shown in the popup footer).

**Please never paste a private AI chat, a page behind your login, or personal data into an issue.** Describe what was missing instead.

## Running it locally

There is no build step and there are no dependencies.

1. Clone the repo.
2. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and choose the `extension` folder.
3. After editing a file, click the reload icon on the extension's card. Reload the page you're testing on too.

## How the code is laid out

| File | What it does |
|---|---|
| `manifest.json` | Permissions, shortcuts, icons (Manifest V3). |
| `config.js` | Branding: support links, repository URL, when to show the "Enjoying it?" card. |
| `common.js` | Settings, file names, front matter. Shared by every page and the service worker. |
| `extract.js` | The HTML-to-Markdown converter, forum presets, clean-up, pagination detection and the element picker. Every function here is injected into pages with `chrome.scripting.executeScript`, so each must be **self-contained** (no references to anything outside its own body). |
| `aiexport.js` | AI chat export for Claude, ChatGPT, Gemini and Grok. |
| `captions.js` | Caption discovery (injected) and parsers for WebVTT, SRT, TTML and YouTube formats. |
| `popup.*` | The toolbar popup. |
| `runner.*` | The multi-page converter, which runs in a normal tab to avoid service-worker time limits. |
| `options.*`, `welcome.*`, `support*` | Settings, first-run guide and the coffee picker. |
| `background.js` | Context menus, keyboard shortcuts, first-run page. |

## Before you open a pull request

```bash
node scripts/check.mjs
```

This checks every script's syntax, validates the manifest, and scans the repository for anything that should never be committed: API keys, tokens, email addresses, links to private chats and personal file paths. The same check runs on every push.

Please keep pull requests focused, and describe how you tested the change (which sites, light and dark mode).

## Style

- Plain JavaScript that runs in Chrome without a build step.
- Interface copy is short, plain and in sentence case. Buttons say what they do ("Save .md file", not "Submit").
- Respect `prefers-color-scheme` and `prefers-reduced-motion`.

By contributing you agree that your contributions are licensed under the [MIT license](LICENSE).
