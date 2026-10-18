# Privacy policy

_Last updated: 18 October 2026_

Page to Markdown is a browser extension that turns web pages, AI chats and video captions into Markdown files. It is built so that your data never leaves your computer.

## The short version

- No account, no sign-in.
- No analytics, telemetry or tracking of any kind.
- No servers. The extension does not send anything anywhere.
- Your pages, chats and captions are read inside your own browser tab and saved straight to your computer (or your clipboard, if you choose that).

## What is stored, and where

| Data | Where | Why |
|---|---|---|
| Your settings (export defaults, file name pattern, toggles) | `chrome.storage.sync` in your browser | So your choices are remembered. If you use Chrome sync, Google syncs them between your own browsers. |
| Selectors you picked on a site with "Pick on page" | `chrome.storage.local` in your browser | So you don't have to pick them again on that site. |
| A count of successful exports, and whether you dismissed the "Enjoying it?" card | `chrome.storage.local` in your browser | To decide when to show that card, once. |

None of this is sent to CoBuild or anyone else. "Reset all settings" in the Settings page clears it, and removing the extension deletes it.

## What the extension reads

Only what you ask it to, when you ask:

- **Convert a page**: the page in your current tab.
- **Multi-page threads**: the pages of that thread, opened in background tabs of your own browser and closed again when done. They load with your normal cookies, exactly as if you had opened them yourself.
- **AI chat export**: the chat open in your tab. On Claude it reads the conversation data that claude.ai has already loaded for that tab, through your existing session. It never stores or sends your session or any credentials.
- **Captions**: caption tracks of videos on the page, and caption files that the page's own player references.

## Network requests

The extension makes no requests of its own to any server we run (there are none). The only network requests it triggers are the ones a page would make anyway: loading the pages of a thread you asked it to convert, loading a caption file the video player already points to, and, on Claude, fetching the chat you are exporting from claude.ai.

## Support links

The "Buy me a coffee" buttons open a Stripe payment page in a new tab. The extension does not see or handle any payment details. Stripe's own privacy policy applies on that page.

## Changes

Any change to this policy will be listed in the [changelog](CHANGELOG.md) and in this file's history.

## Contact

Questions or concerns: please [open an issue](https://github.com/cobuild-labs/page-to-markdown/issues).
