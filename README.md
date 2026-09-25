# Ask Transcript Extension

### Background

YouTube already has an AI ask feature, but it's not always available for all videos, and it's not always accurate (seemingly misses later parts of videos at times). This extension is a substitute for that feature, intending to provide more model control, and also more features around transcripts (auto generate topic outlines with embedded timestamps, line by line captioning system, alternative caption translation). 

This extension supports OpenRouter & LMStudio, also has custom API support. 

## Installation & Usage

1. **Clone the repository** and install dependencies:
   ```bash
   git clone https://github.com/anngo-1/yt-vid-search
   cd yt-vid-search
   npm install
   ```
2. **Build the extension** to the `dist/` folder:
   ```bash
   npm run build
   ```
3. **Load the extension into your browser:**
   - Open Chrome and navigate to `chrome://extensions/`
   - Toggle **"Developer mode"** on in the top right corner
   - Click **"Load unpacked"** and select the `dist/` directory generated in Step 2

To configure LLM providers for chat, topics, and captions, click on the extension icon, select the providers you want for each feature, and then navigate to the providers tab to set up API keys or a custom endpoint (this uses OpenAI API chat completions format)

Navigate to a YouTube video, click on the extension, and click **Open Transcript Panel**. A draggable panel will appear on the screen, granting you access to the chat, topics, and search features without leaving the video. Panel disappears when you navigate away from the video, you can re-open it for a new video by simply repeating the steps above.

## Live debug

In the extension popup, open **General → Live debug overlay**. It takes effect in
open YouTube tabs immediately. Enable it before opening a new video's transcript
(or turn on auto-open) to see fetch → payload, parse, DOM render, and fetch → rows-ready
timings during real use. Render timings include chunk scheduling, not browser paint;
fetch timing includes button discovery/retries, not just the network request.

The overlay also shows approximate **tab-wide JS heap**, heap change and sampled
peak since reset, tab long tasks (>50 ms), extension DOM elements, transcript rows,
and cached/pending translation counts. Heap and long tasks include YouTube: they
are **not extension-only memory/CPU**, and heap excludes native DOM, video/GPU memory,
popup, and background worker. Chrome may round/cache heap readings; unsupported
metrics display `unavailable`. This is live diagnostics, not a precise memory budget
or leak verdict. No forced GC is performed.

Drag **anywhere on the overlay** (including the metrics text) to move it, like captions,
or its **bottom-right corner** to resize in both directions. Buttons and scrollbars
still work normally. The metrics scroll when space is tight; controls stay visible.
Position and size are kept while navigating between videos in the same tab.

**Reset baseline** starts a fresh comparison; changing videos resets automatically.
**Copy snapshot** copies numeric diagnostics and the current video ID as JSON, never
API keys or transcript/chat contents. Nothing is sent anywhere. Updates run once a
second while visible; debug adds some overhead. Disable it with **×** or the popup
checkbox to remove the overlay, timer, and performance observer. It is off by default.

## Developer Skills

Add reusable prompts as markdown files in `src/skills`. Each file is bundled as a chat skill and invoked from the Ask box with `/<skill-name>`.

Example:

```md
---
name: summarize
description: Summarize the transcript with timestamped takeaways.
---

Write the prompt instructions for this skill here.
```

Typing `/` shows available skills. `summarize.md` becomes `/summarize`; `challenge.md` becomes `/challenge`.
