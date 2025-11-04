# vigilant-doodle

Chrome context-menu helper that sends highlighted text and page metadata to a locally running Ollama model, then surfaces the result in a Chrome notification.

## Quick Start
1. Run Ollama locally  
   Install Ollama and ensure `ollama serve` is running (defaults to `http://127.0.0.1:11434`). Pull the model you plan to use (for example `ollama pull qwen3:14b`) and set `OLLAMA_ORIGINS` so your extension’s origin is allowed (e.g. `export OLLAMA_ORIGINS=*` while testing, then restart Ollama).
2. Configure the extension  
   - Edit `extension/config.js` to match your Ollama base URL or preferred model. Defaults are `http://127.0.0.1:11434` and `qwen3:14b`.  
   - (Optional) Tweak `extension/prompt-prefix.txt` to change the instruction block that is prepended to every request sent to Ollama. The default prompt is tailored to summarizing Slack conversation snippets.
3. (Optional) Narrow permissions  
   If you expose Ollama somewhere else, update `extension/manifest.json` `host_permissions` to match your endpoint.
4. Load the unpacked extension  
   - Open `chrome://extensions` in Chrome.  
   - Toggle **Developer mode** on.  
   - Choose **Load unpacked** and pick the `extension/` directory.  
   - Highlight any page text, right-click, and select `Send to Ollama` to test.

## How It Works
- Adds a selection-only context menu entry.
- Builds a prompt that combines the configurable prefix and the highlighted Slack snippet, then posts it to Ollama’s `/api/chat` endpoint.
- Displays the model’s reply (trimmed for length) in a notification; clicking it (or the button) opens the configured follow-up link.

### Allowing Chrome origins
- Chrome extensions send requests with an origin such as `chrome-extension://abc123…`. Ollama blocks these unless `OLLAMA_ORIGINS` allows them (comma-separated list or `*`).
- For systemd installs, add the environment variable to `/etc/systemd/system/ollama.service.d/override.conf`, run `sudo systemctl daemon-reload`, then `sudo systemctl restart ollama`.
- On macOS (launchd), use `launchctl setenv OLLAMA_ORIGINS "*" && launchctl kickstart -k gui/$UID/com.ollama.ollama` while developing.

## Files Worth Knowing
- `extension/background.js`: Manifest V3 service worker with context menu, metadata capture, Ollama API call, and notification plumbing.
- `extension/config.js`: Base URL and model configuration for Ollama (defaults to `qwen3:14b`).
- `extension/prompt-prefix.txt`: Human-readable instructions that are prefixed to the selected Slack snippet before contacting Ollama.
- `extension/manifest.json`: Extension metadata and host permissions.
- `extension/icons/`: Simple placeholder PNGs.
