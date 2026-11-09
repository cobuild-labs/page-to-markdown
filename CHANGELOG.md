# Changelog

All notable changes to Page to Markdown. Dates are release dates.

## 1.12.0 · 2026-11-09

Everything since 1.9.0 (versions 1.10 and 1.11 were never released separately).

### Added
- **Updates, made easy.** Once a day the extension checks whether a new version is out. When there is one, a small note at the top of the popup takes you to a page with what's new and step-by-step instructions for your browser and computer: download, unzip, swap in the new files, then click Finish update. Your settings stay. There's also a "Check for updates" button in Settings.
- **Export a whole Claude project.** On a Claude project page, the AI box becomes "Export this project": one `.zip` with the project's files (folders kept), its instructions, a list of its chats and, if you like, every chat with the files it made.
- **Captions from a whole playlist or course.** Pick the videos from a YouTube playlist or a course's lesson list and save all their captions in one go, as one `.md` or a `.zip` with a file per video. Choose the language; videos without it are listed, never mixed in.
- **Include unfinished files** (Claude, off by default): files Claude wrote but never sent, for example when a chat stopped at a usage limit.

### Fixed
- On sites that switch lessons without reloading the page, the captions picker no longer lists caption files from videos you watched earlier.

### Changed
- The licence and privacy policy are now short and plain. The only thing the extension looks up is the latest version number.

## 1.9.0 · 2026-11-04

Everything since 1.5.0 (versions 1.6 to 1.8 were never released separately).

### Added
- **Full-detail AI chat export on six sites.** Claude, ChatGPT, Gemini, Grok, Perplexity and DeepSeek are now read from the conversation data the site itself loads in your tab, not from what happens to be on screen. You get every turn (no scrolling needed), the thinking, every tool call with its exact input, what came back, and the sources. If a site changes and that data can't be read, the export falls back to reading the page and says so.
  - **ChatGPT:** reasoning summaries, the code it ran and the output, web searches, inline citations turned into normal links, Canvas documents, and Deep Research reports (read from the panel ChatGPT draws them in).
  - **Gemini:** the full thinking (more than the screen shows), sources with titles, the reply you picked when there were drafts, Canvas documents, and chats inside a Gem.
  - **Grok:** every web search with its results, the thinking steps, and inline citations.
  - **Perplexity:** each question, the searches it ran, and the answer with its [1][2] citations linked to the sources.
  - **DeepSeek:** thinking, web searches and citations, following the branch on screen when you edited a message.
- **Save the files it made.** One tick and the export becomes a `.zip`: the chat's `.md` at the top and every file the AI made in a `files/` folder, linked from the chat so you can click straight through.
  - Claude: files it sent, files from its workspace in older chats, and artifacts (rebuilt to their final version). Published artifacts are linked.
  - ChatGPT: files from its code runs, generated images and charts, Canvas documents and Deep Research reports.
  - Gemini: generated images and Canvas documents (memos, code, HTML slides), including earlier versions of a Canvas edited over several turns.
  - Grok: generated images.
  - Any other AI app: pictures and downloadable files in the replies (avatars and icons are skipped).
  - **Include files I uploaded too:** your own uploads go in an `uploads/` folder.
  - **Include code files** (off by default): `.js`, `.py`, `.css`, `.json` and similar are listed by name only unless you tick this.
  - A file the site no longer serves is marked "no longer available" instead of stopping the export. When a file is sent more than once, the last version keeps its name and earlier ones become `name (v1)`, `name (v2)`.
- **Any AI app.** A general chat reader works on AI tools beyond the dedicated six (about 65 are recognised, from Copilot and Meta AI to Le Chat, Poe and NotebookLM). It finds who said what from the page's labels or, failing that, its layout, and handles chats that only draw the messages on screen.
- On any other page, a small "Export it as an AI chat" link in the popup, and the right-click "Export this AI chat" item on every page.
- **Captions:** support for JW Player, and for caption files the page has already loaded, so more video players work.
- Settings for the new options, and the Alt+Shift+E shortcut uses them.

### Fixed
- Saved files could get a generic or random name when another installed extension also manages downloads. Files are now always named after the page, chat or video.
- Caption downloads from hosts that refuse cookies now retry without them.
- Chat titles keep their own dashes; untitled chats are named after the first question.
- Claude's own files were labelled "Attached"; they are now listed as "Files it made".

### Changed
- The AI box opens by itself only on known AI chat sites, so it no longer appears on ordinary pages that merely look like a chat.

## 1.5.0 · 2026-10-18

### Added
- **Captions to Markdown.** One click saves a video's closed captions as clean paragraphs with no timestamps.
  - HTML5 `<video>` text tracks in every frame, including cross-site player iframes (Vimeo, Video.js, Plyr and most other HTML5 players).
  - YouTube watch pages and embeds, with a fallback to the "Show transcript" panel.
  - Reads WebVTT, SRT, TTML/DFXP and YouTube's own formats; removes the repeated lines of auto-generated captions.
  - Picks English (human-made first) when there are several tracks, with a picker or dropdown to choose another.
  - New paragraphs after a pause, a change of speaker, or every few sentences.
- New extension icon.
- `homepage_url` in the manifest, pointing to this repository.

### Changed
- Popup footer stays on one line.
- License changed from MIT to the GNU General Public License v3.0.

## 1.4.2

### Added
- "Buy me a coffee" picker with four choices, shared by the popup, Settings, the welcome page and the multi-page screen.

## 1.4.1

### Fixed
- Multi-page export on sites that load their list a moment after the page itself. Pages now wait until their text stops changing (up to 15 seconds) and for the "Next" button to appear before being read.
- Cleaned-up mode no longer drops content on pages with large hidden scripts, and removes site headers and footers more reliably.

### Changed
- "Cleaned-up version" is marked **Beta**.
- Removed an empty strip at the bottom of the popup.

## 1.4.0

### Added
- **Cleaned-up version** checkbox (on by default): leaves out ads, menus, sidebars, cookie banners, share and newsletter boxes.
- Multi-page now clicks "Next page" and "Load more" buttons for lists whose address never changes, and detects which kind of paging a site uses.
- **Copy to clipboard instead of saving** option.
- "Done" strip after each export.

### Fixed
- "Pick on page" now registers the click, highlights every matching item, and can pick an item's title and date or parts to leave out. Picks are remembered per site.

### Changed
- Tidier output: no stray spaces or blank lines, card grids become one bullet each, and text repeated on every page is kept once.
- The popup is back to its original, simpler layout.

## 1.3.0

### Added
- Welcome page on first install.
- Settings page: export defaults, file name pattern, YAML front matter, "where to save" dialog, forum splitting.
- Convert only the selected text, from the popup or the right-click menu.
- Keyboard shortcuts and a right-click "Export this AI chat".
- Dark mode everywhere.

## 1.2.0

### Added
- **AI chat export** for Claude, ChatGPT, Gemini and Grok: chat only, or chat plus thinking, tool calls, results and sources. Optional `.mhtml` backup.

## 1.1.0

### Added
- Forum detection for XenForo, Discourse, phpBB and vBulletin: one section per post with number, author and date; quotes kept as quotes.

### Fixed
- Multi-page threads returned the pinned first post on every page.

## 1.0.0

- First version: convert a page to Markdown, and combine numbered pages of a thread into one file.
