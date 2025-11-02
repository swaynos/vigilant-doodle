# vigilant-doodle

Minimal Chrome extension that lets you right-click selected text, forward it to a ChatGPT proxy endpoint, and shows a toast with a follow-up link.

## Features
- Context menu entry for highlighted text (`Send to ChatGPT (via Proxy)`).
- Captures the selection plus page metadata (title, URL, language, meta description, Open Graph tags, referrer, user agent).
- Sends a JSON payload to a configurable HTTPS proxy endpoint.
- Displays success or error notifications with a single action button that opens a configurable link.

## Setup
1. Update `extension/config.js`
   - `PROXY_ENDPOINT`: HTTPS endpoint that accepts the POST payload.
   - `SUCCESS_LINK_URL` / `FAILURE_LINK_URL`: Destination to open when the notification is clicked or the action button is pressed.
   - Adjust `REQUEST_TIMEOUT_MS` if your proxy needs longer than 15 seconds.
2. (Optional) Restrict permissions
   - Replace `<all_urls>` in `extension/manifest.json` `host_permissions` with the minimal origin of your proxy, e.g. `"https://proxy.example.com/*"`.
3. Load the extension
   - Open `chrome://extensions`.
   - Enable Developer Mode.
   - Click **Load unpacked** and select the `extension` directory in this repository.

## Payload format
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

## Notifications
- Success and failure toasts use the same icon and include an **Open link** action button.
- Clicking the toast or the button opens `SUCCESS_LINK_URL` for successful sends and `FAILURE_LINK_URL` otherwise.
- Errors include cases such as an unset proxy URL, empty selection, network failures, or non-2xx responses from the proxy.

## Development Notes
- Icons are simple color blocks generated in `extension/icons/`.
- Service worker logic lives in `extension/background.js` and uses Manifest V3 APIs only.
