# Changelog

All notable changes to Page to Markdown. Dates are release dates.

## 1.5.0 · 2026-10-18

### Added
- **Captions to Markdown.** One click saves a video's closed captions as clean paragraphs with no timestamps.
  - HTML5 `<video>` text tracks in every frame, including cross-site player iframes (Vimeo, Video.js, Plyr and most course platforms).
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
