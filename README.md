# vigilant-doodle

Chrome context-menu helper that sends highlighted text to a locally running Ollama model, then surfaces the result in a toast notification.

## Quick Start
1. Run Ollama locally  
   Install Ollama and ensure `ollama serve` is running (defaults to `http://127.0.0.1:11434`). Pull the model you plan to use (for example `ollama pull qwen3:14b`) and set `OLLAMA_ORIGINS` so your extension’s origin is allowed (e.g. `export OLLAMA_ORIGINS=*` while testing, then restart Ollama).
2. Configure the extension  
   - Edit `extension/config.js` to match your Ollama base URL or preferred model. Defaults are `http://127.0.0.1:11434` and `qwen3:14b`.  
   - (Optional) Adjust the prompt templates in `extension/prompts/` (for example `summarize.txt` and `format.txt`) to customize the instructions sent to Ollama.
3. (Optional) Narrow permissions  
   If you expose Ollama somewhere else, update `extension/manifest.json` `host_permissions` to match your endpoint.
4. Load the unpacked extension  
   - Open `chrome://extensions` in Chrome.  
   - Toggle **Developer mode** on.  
   - Choose **Load unpacked** and pick the `extension/` directory.  
   - Highlight any page text, right-click, and choose either **Summarize with AI** or **Format chat with AI** to test.

## How It Works
- Adds two selection-only context menu entries (`Summarize with AI` and `Format chat with AI`).
- Builds a prompt by combining the matching template with the highlighted snippet, then posts it to Ollama’s `/api/chat` endpoint.
- Surfaces the AI response in a toast with a one-click copy action (and falls back to a Chrome notification if the toast cannot be injected).

### Allowing Chrome origins
- Chrome extensions send requests with an origin such as `chrome-extension://abc123…`. Ollama blocks these unless `OLLAMA_ORIGINS` allows them (comma-separated list or `*`).
- For systemd installs, add the environment variable to `/etc/systemd/system/ollama.service.d/override.conf`, run `sudo systemctl daemon-reload`, then `sudo systemctl restart ollama`.
- On macOS (launchd), use `launchctl setenv OLLAMA_ORIGINS "*" && launchctl kickstart -k gui/$UID/com.ollama.ollama` while developing.

## Files Worth Knowing
- `extension/background.js`: Manifest V3 service worker with context menus, prompt selection, Ollama API call, and notification plumbing.
- `extension/config.js`: Base URL and model configuration for Ollama (defaults to `qwen3:14b`).
- `extension/prompt-prefix.js`: Loads and caches prompt templates from `extension/prompts/`.
- `extension/prompts/`: Text templates for each action (`summarize.txt`, `format.txt`, etc.).
- `extension/manifest.json`: Extension metadata and host permissions.
- `extension/icons/`: Simple placeholder PNGs.
