# Privacy policy

_Last updated: 4 November 2026_

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
- **AI chat export**: the chat open in your tab. On Claude, ChatGPT, Gemini, Grok, Perplexity and DeepSeek it asks that site for the conversation's data through your existing session, from inside your own tab, the same request the site's page makes. On other AI tools it reads the page. It never stores or sends your session, tokens or any credentials.
- **Files from an AI chat** (only if you tick "Save the files it made"): the files that chat produced, and your own uploads if you tick that too, downloaded from the AI site into one `.zip` on your computer.
- **Captions**: caption tracks of videos on the page, and caption files that the page's own player references.

## Network requests

The extension makes no requests of its own to any server we run (there are none). The only network requests it triggers are ones you asked for, to the sites you are already using:

- loading the pages of a thread you asked it to convert;
- loading a caption file the video player already points to;
- fetching the chat you are exporting from that AI site (claude.ai, chatgpt.com, gemini.google.com, grok.com, perplexity.ai or chat.deepseek.com);
- with "Save the files it made" ticked, downloading that chat's files from where the AI site keeps them. When a file server refuses downloads made from the page itself (Google's image server for Gemini pictures, for example), the extension's own background script downloads it instead. It sends your cookies only to the AI sites' own file servers; any other address is fetched without cookies.

Everything that comes back goes straight into the file saved on your computer.

## Support links

The "Buy me a coffee" buttons open a Stripe payment page in a new tab. The extension does not see or handle any payment details. Stripe's own privacy policy applies on that page.

## Changes

Any change to this policy will be listed in the [changelog](CHANGELOG.md) and in this file's history.

## Contact

Questions or concerns: please [open an issue](https://github.com/cobuild-labs/page-to-markdown/issues).
