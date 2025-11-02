# vigilant-doodle

Chrome context-menu helper that forwards highlighted text and page metadata to a ChatGPT proxy, then confirms the result with a toast.

## Quick Start
1. Configure endpoints  
   Edit `extension/config.js` with your proxy URL, the follow-up links, and your preferred context menu label. Adjust the timeout if needed.
2. (Optional) Narrow permissions  
   Replace `<all_urls>` in `extension/manifest.json` `host_permissions` with your proxy origin, e.g. `"https://proxy.example.com/*"`.
3. Load the unpacked extension  
   - Open `chrome://extensions` in Chrome.  
   - Toggle **Developer mode** on.  
   - Choose **Load unpacked** and pick the `extension/` directory.  
   - Highlight any page text, right-click, and select `Send to ChatGPT (via Proxy)` to test.

## How It Works
- Adds a selection-only context menu entry.
- Collects tab metadata (title, URL, lang, meta/OG descriptions, referrer, UA).
- Posts a JSON payload to your proxy and times out after `REQUEST_TIMEOUT_MS`.
- Pops a basic Chrome notification on success or error; clicking it (or the button) opens the configured follow-up link.

## Payload
```jsonc
{
  "createdAt": "2024-05-01T12:34:56.789Z",
  "selection": "The highlighted text",
  "metadata": {
    "pageUrl": "https://example.com/article",
    "pageTitle": "Example Article",
    "language": "en",
    "description": "Meta description if present",
    "ogTitle": "OG title if present",
    "ogDescription": "OG description if present",
    "referrer": "https://referrer.example.com/",
    "userAgent": "Mozilla/5.0 ..."
  },
  "source": {
    "extension": "Send to ChatGPT (via Proxy)",
    "version": "0.1.0"
  }
}
```

## Files Worth Knowing
- `extension/background.js`: Manifest V3 service worker with context menu, metadata capture, fetch, and notifications.
- `extension/config.js`: Proxy, notification links, context menu label, timeout.
- `extension/icons/`: Simple placeholder PNGs.
