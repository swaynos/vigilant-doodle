# vigilant-doodle

Chrome context-menu helper that sends highlighted text and page metadata straight to an OpenAI Assistant using the Assistants API, then surfaces the result in a Chrome notification.

## Quick Start
1. Set the Assistants API base URL  
   Edit `extension/config.js` to point at your OpenAI-compatible base URL (defaults to `https://api.openai.com/v1`). Update the testing credentials in `extension/background.js` before trying the extension.
2. (Optional) Narrow permissions  
   If you use a custom base URL, update `extension/manifest.json` `host_permissions` to match (default is `https://api.openai.com/*`).
3. Load the unpacked extension  
   - Open `chrome://extensions` in Chrome.  
   - Toggle **Developer mode** on.  
   - Choose **Load unpacked** and pick the `extension/` directory.  
   - Highlight any page text, right-click, and select `Send to ChatGPT (Assistants API)` to test.

## How It Works
- Adds a selection-only context menu entry.
- Collects tab metadata (title, URL, language, meta/OG descriptions, referrer, UA).
- Creates an Assistant thread, appends a user message containing the selection plus metadata, starts a run, and polls until it completes.
- Displays the assistant’s reply (trimmed for length) in a notification; clicking it (or the button) opens the configured follow-up link.

## Files Worth Knowing
- `extension/background.js`: Manifest V3 service worker with context menu, metadata capture, Assistants API orchestration, and notifications. Contains testing-only constants for the API key, assistant id, and notification behavior.
- `extension/config.js`: Minimal config exporting just the Assistants API base URL.
- `extension/manifest.json`: Extension metadata and host permissions.
- `extension/icons/`: Simple placeholder PNGs.
