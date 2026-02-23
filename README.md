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

