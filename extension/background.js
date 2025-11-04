import { OLLAMA_BASE_URL, OLLAMA_MODEL } from "./config.js";
import { getPromptTemplate } from "./prompt-prefix.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
const TOAST_DISPLAY_DURATION_MS = 30000;
const TOAST_FADE_DURATION_MS = 200;
const LOG_DIRECTORY = "send-to-ollama-logs";

const manifest = chrome.runtime.getManifest();

const ACTIONS = Object.freeze({
  summarize: {
    id: "send-to-ollama:summarize",
    title: "Summarize with AI",
    promptKey: "summarize",
    timeoutMs: 60000,
    systemPrompt:
      "You are helping a browser extension user who highlighted part of a conversation. Provide a concise summary that captures the key topic, decisions, follow-ups, and blockers.",
    successTitle: "Summary ready",
    helperText: "Summary ready. Use Copy summary to add it to your clipboard.",
    copyLabel: "Copy summary",
  },
  format: {
    id: "send-to-ollama:format",
    title: "Format chat with AI",
    promptKey: "format",
    timeoutMs: 180000,
    systemPrompt:
      "You are helping a browser extension user tidy up a conversation snippet. Preserve the original meaning and speaker ordering while returning a clean, portable Markdown-friendly version.",
    successTitle: "Formatted chat ready",
    helperText:
      "Formatted chat ready. Use Copy formatted chat to add it to your clipboard.",
    copyLabel: "Copy formatted chat",
  },
});

const ACTIONS_BY_MENU_ID = new Map(
  Object.values(ACTIONS).map((action) => [action.id, action])
);

chrome.runtime.onInstalled.addListener(async () => {
  await createOrUpdateContextMenu();
});

chrome.runtime.onStartup.addListener(async () => {
  await createOrUpdateContextMenu();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const action = ACTIONS_BY_MENU_ID.get(info.menuItemId);
  if (!action) {
    return;
  }

  debugger; // Force a breakpoint if the debugger is active.

  const configError = validateOllamaConfiguration();
  if (configError) {
    await showNotification({
      title: "Ollama not configured",
      message: configError,
      isError: true,
      tabId: tab?.id,
    });
    return;
  }

  const selection = (info.selectionText || "").trim();
  if (!selection) {
    await showNotification({
      title: "Nothing to send",
      message: `Select some text before using "${action.title}".`,
      isError: true,
      tabId: tab?.id,
    });
    return;
  }

  try {
    const { reply } = await sendSelectionToOllama(selection, action);
    const notificationMessage = formatAssistantReplyForNotification(reply);

    await showNotification({
      title: action.successTitle,
      message: notificationMessage,
      isError: false,
      tabId: tab?.id,
      copyText: reply,
      helperText: action.helperText,
      copyLabel: action.copyLabel,
    });
  } catch (error) {
    await showNotification({
      title: "Failed to reach Ollama",
      message: error?.message || "Unknown error while contacting Ollama.",
      isError: true,
      tabId: tab?.id,
    });
  }
});

async function createOrUpdateContextMenu() {
  try {
    await chrome.contextMenus.removeAll();
  } catch (error) {
    // Ignore failures when menu entries do not exist yet.
  }

  for (const action of Object.values(ACTIONS)) {
    chrome.contextMenus.create({
      id: action.id,
      title: action.title,
      contexts: ["selection"],
    });
  }
}

async function sendSelectionToOllama(selection, action) {
  const promptTemplate = await getPromptTemplate(action.promptKey);
  const prompt = buildAssistantPrompt(selection, promptTemplate);
  const timestampIso = new Date().toISOString();
  const logBaseName = createLogBaseName(action, timestampIso);

  try {
    const response = await ollamaRequest("/api/chat", {
      method: "POST",
      timeoutMs: action?.timeoutMs,
      body: {
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
          {
            role: "system",
            content: action.systemPrompt,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      },
    });

    const reply = extractTextFromOllamaResponse(response);

    writeRequestLog({
      logBaseName,
      action,
      selection,
      prompt,
      status: "success",
      reply,
      timestampIso,
    }).catch((logError) => {
      console.error("Failed to record successful request log.", logError);
    });

    return { reply };
  } catch (error) {
    writeRequestLog({
      logBaseName,
      action,
      selection,
      prompt,
      status: "error",
      error,
      timestampIso,
    }).catch((logError) => {
      console.error("Failed to record error request log.", logError);
    });
    throw error;
  }
}

function extractTextFromOllamaResponse(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    return payload.trim();
  }

  if (typeof payload.response === "string") {
    return payload.response.trim();
  }

  const message = payload.message;
  if (!message) {
    return "";
  }

  if (typeof message === "string") {
    return message.trim();
  }

  const content = message.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content.join("\n\n").trim();
  }

  return "";
}

async function ollamaRequest(
  path,
  { method = "GET", body, headers = {}, timeoutMs } = {}
) {
  if (!OLLAMA_BASE_URL) {
    throw new Error("Ollama base URL is missing. Update extension/config.js.");
  }

  const url = buildOllamaUrl(path);
  const controller = new AbortController();
  const effectiveTimeout =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const responseText = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const payload = responseText && isJson ? JSON.parse(responseText) : responseText;

    if (!response.ok) {
      const message =
        payload?.error ||
        payload?.message ||
        (typeof payload === "string" && payload.trim()) ||
        `Ollama returned status ${response.status}`;
      throw new Error(Array.isArray(message) ? message.join(" ") : message);
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Request timed out after ${Math.round(effectiveTimeout / 1000)} seconds while contacting Ollama.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildOllamaUrl(path) {
  const base = (OLLAMA_BASE_URL || "").replace(/\/+$/, "");
  const trimmedPath = String(path || "").replace(/^\/+/, "");
  return `${base}/${trimmedPath}`;
}

function buildAssistantPrompt(selection, promptTemplate = "") {
  const lines = [];

  if (promptTemplate) {
    lines.push(promptTemplate, "");
  }

  lines.push("Conversation snippet:", selection);

  lines.push("", `Source extension: ${manifest.name} v${manifest.version}`);

  return lines.join("\n");
}

function formatAssistantReplyForNotification(reply) {
  if (!reply) {
    return "Sent request to the Ollama model successfully.";
  }

  const normalized = reply
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return "Ollama returned an empty response.";
  }

  return normalized.length > 600 ? `${normalized.slice(0, 597)}...` : normalized;
}

function createLogBaseName(action, isoTimestamp) {
  const timestampSegment = sanitizeFilenameSegment(
    (isoTimestamp || new Date().toISOString()).replace(/[:.]/g, "-")
  );
  const actionSegment = sanitizeFilenameSegment(
    action?.promptKey || action?.id || "request"
  );
  const uniqueSegment = sanitizeFilenameSegment(
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10)
  );

  return `${timestampSegment}-${actionSegment}-${uniqueSegment}`.toLowerCase();
}

async function writeRequestLog({
  logBaseName,
  action,
  selection,
  prompt,
  status,
  reply,
  error,
  timestampIso,
}) {
  try {
    const lines = [
      `Timestamp: ${timestampIso}`,
      `Action ID: ${action?.id || "n/a"}`,
      `Prompt key: ${action?.promptKey || "n/a"}`,
      "",
      "=== Input ===",
      "Selected text:",
      selection || "(empty)",
      "",
      "Prompt sent to Ollama:",
      prompt || "(empty)",
      "",
      "=== Output ===",
    ];

    if (status === "error") {
      lines.push(
        "Status: error",
        "",
        "Error message:",
        error?.message || "Unknown error.",
        ""
      );

      if (error?.stack) {
        lines.push("Stack trace:", error.stack, "");
      }
    } else {
      lines.push("Status: success", "", "Assistant reply:", reply || "(empty)");
    }

    await writeLogFile(`${logBaseName}.txt`, lines.join("\n"));
  } catch (logError) {
    throw logError;
  }
}

async function writeLogFile(filename, contents) {
  try {
    if (!chrome?.downloads?.download) {
      console.warn("Downloads API unavailable; skipping log file creation.");
      return;
    }

    await downloadFile({
      url: createDataUrlFromText(contents),
      filename: `${LOG_DIRECTORY}/${filename}`,
      conflictAction: "uniquify",
      saveAs: false,
    });
  } catch (error) {
    console.error("Failed to write log file.", error);
  }
}

function downloadFile(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        reject(
          new Error(
            chrome.runtime.lastError?.message || "Failed to schedule download."
          )
        );
        return;
      }
      resolve(downloadId);
    });
  });
}

function sanitizeFilenameSegment(value) {
  if (!value) {
    return "unknown";
  }

  const sanitized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "unknown";
}

function createDataUrlFromText(text) {
  const safeText = text ?? "";
  const encoder = new TextEncoder();
  const bytes = encoder.encode(safeText);
  const base64 = uint8ArrayToBase64(bytes);
  return `data:text/plain;charset=utf-8;base64,${base64}`;
}

function uint8ArrayToBase64(uint8Array) {
  if (!uint8Array?.length) {
    return "";
  }

  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < uint8Array.length; index += chunkSize) {
    const chunk = uint8Array.subarray(index, index + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binary);
}

function validateOllamaConfiguration() {
  if (!OLLAMA_BASE_URL) {
    return "Update extension/config.js with your Ollama base URL.";
  }

  if (!OLLAMA_MODEL) {
    return "Update extension/config.js with the Ollama model to use.";
  }

  return null;
}

async function showNotification({
  title,
  message,
  isError,
  tabId,
  copyText,
  helperText,
  copyLabel,
}) {
  if (tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injectToastIntoPage,
        args: [
          {
            title: title || "",
            message: message || "",
            isError: Boolean(isError),
            copyText: copyText || "",
            helperText: helperText || "",
            copyLabel: copyLabel || "",
            displayDurationMs: TOAST_DISPLAY_DURATION_MS,
            fadeDurationMs: TOAST_FADE_DURATION_MS,
          },
        ],
      });
      return;
    } catch (error) {
      console.warn("Falling back to chrome.notifications API.", error);
    }
  }

  const notificationId = createNotificationId();
  const options = {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title,
    message,
    priority: 0,
  };

  if (isError) {
    options.title = title || "Send to Ollama";
  }

  await chrome.notifications.create(notificationId, options);
}

function injectToastIntoPage({
  title,
  message,
  isError,
  copyText,
  helperText,
  copyLabel,
  displayDurationMs,
  fadeDurationMs,
}) {
  try {
    const containerId = "send-to-ollama-toast-container";
    const styleId = "send-to-ollama-toast-styles";
    const visibleDuration =
      Number.isFinite(displayDurationMs) && displayDurationMs > 0
        ? displayDurationMs
        : 30000;
    const transitionDuration =
      Number.isFinite(fadeDurationMs) && fadeDurationMs >= 0 ? fadeDurationMs : 200;

    ensureStyles();
    const container = ensureContainer();
    const toast = document.createElement("div");
    toast.className = "send-to-ollama-toast";
    toast.setAttribute("role", "alert");
    toast.setAttribute("aria-live", isError ? "assertive" : "polite");

    if (isError) {
      toast.classList.add("send-to-ollama-toast--error");
    }

    if (title) {
      const titleEl = document.createElement("div");
      titleEl.className = "send-to-ollama-toast__title";
      titleEl.textContent = title;
      toast.appendChild(titleEl);
    }

    if (!isError && copyText) {
      const helperEl = document.createElement("p");
      helperEl.className = "send-to-ollama-toast__helper";
      helperEl.textContent =
        helperText ||
        "Result ready. Use Copy result to add it to your clipboard.";
      toast.appendChild(helperEl);
    }

    if (message) {
      const messageEl = document.createElement("p");
      messageEl.className = "send-to-ollama-toast__message";
      messageEl.textContent = message;
      toast.appendChild(messageEl);
    }

    const dismiss = () => {
      if (!toast.isConnected) {
        return;
      }
      toast.classList.add("send-to-ollama-toast--leaving");
      window.setTimeout(() => {
        toast.remove();
      }, transitionDuration);
    };

    const actions = document.createElement("div");
    actions.className = "send-to-ollama-toast__actions";

    if (!isError && copyText) {
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "send-to-ollama-toast__button";
      const defaultCopyLabel = copyLabel || "Copy result";
      copyButton.textContent = defaultCopyLabel;
      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(copyText);
          copyButton.textContent = "Copied!";
          copyButton.disabled = true;
          window.setTimeout(() => {
            copyButton.textContent = defaultCopyLabel;
            copyButton.disabled = false;
          }, 2000);
        } catch (error) {
          console.error("Failed to copy result to clipboard.", error);
          copyButton.textContent = "Copy failed";
          window.setTimeout(() => {
            copyButton.textContent = defaultCopyLabel;
          }, 2000);
        }
      });
      actions.appendChild(copyButton);
    }

    const dismissButton = document.createElement("button");
    dismissButton.type = "button";
    dismissButton.className =
      "send-to-ollama-toast__button send-to-ollama-toast__button--tertiary";
    dismissButton.textContent = "Dismiss";
    dismissButton.addEventListener("click", () => {
      dismiss();
    });
    actions.appendChild(dismissButton);

    toast.appendChild(actions);
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("send-to-ollama-toast--visible");
    });

    let autoRemoveTimer = window.setTimeout(() => {
      dismiss();
    }, visibleDuration);

    const cancelAutoRemove = () => {
      if (!autoRemoveTimer) {
        return;
      }
      window.clearTimeout(autoRemoveTimer);
      autoRemoveTimer = null;
    };

    toast.addEventListener("mouseenter", cancelAutoRemove);
    toast.addEventListener("focusin", cancelAutoRemove);

    toast.addEventListener("mouseleave", () => {
      toast.classList.add("send-to-ollama-toast--leaving");
      window.setTimeout(() => {
        dismiss();
      }, transitionDuration);
    });

    toast.addEventListener("focusout", () => {
      toast.classList.add("send-to-ollama-toast--leaving");
      window.setTimeout(() => {
        dismiss();
      }, transitionDuration);
    });

    function ensureContainer() {
      let element = document.getElementById(containerId);
      if (element) {
        return element;
      }
      element = document.createElement("div");
      element.id = containerId;
      element.setAttribute("aria-live", "polite");
      element.setAttribute("aria-atomic", "false");
      element.style.position = "fixed";
      element.style.top = "16px";
      element.style.right = "16px";
      element.style.display = "flex";
      element.style.flexDirection = "column";
      element.style.gap = "12px";
      element.style.zIndex = "2147483647";
      element.style.pointerEvents = "none";
      (document.body || document.documentElement).appendChild(element);
      return element;
    }

    function ensureStyles() {
      if (document.getElementById(styleId)) {
        return;
      }
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        #${containerId} {
          position: fixed;
          top: 16px;
          right: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          z-index: 2147483647;
          pointer-events: none;
        }
        .send-to-ollama-toast {
          position: relative;
          min-width: 240px;
          max-width: min(360px, 90vw);
          background: #111827;
          color: #f9fafb;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 20px 40px rgba(15, 23, 42, 0.3);
          padding: 16px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 14px;
          line-height: 1.4;
          opacity: 0;
          transform: translateY(-10px);
          transition: opacity 0.18s ease-out, transform 0.18s ease-out;
          pointer-events: auto;
        }
        .send-to-ollama-toast--visible {
          opacity: 1;
          transform: translateY(0);
        }
        .send-to-ollama-toast--leaving {
          opacity: 0;
          transform: translateY(-6px);
        }
        .send-to-ollama-toast--error {
          background: #4b1d1d;
          border-color: rgba(252, 165, 165, 0.6);
        }
        .send-to-ollama-toast__title {
          margin: 0 0 6px 0;
          font-weight: 600;
        }
        .send-to-ollama-toast__message {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .send-to-ollama-toast__helper {
          margin: 0 0 10px 0;
          color: rgba(255, 255, 255, 0.7);
        }
        .send-to-ollama-toast__actions {
          margin-top: 12px;
          display: flex;
          gap: 8px;
        }
        .send-to-ollama-toast__button {
          appearance: none;
          border: none;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          background: rgba(59, 130, 246, 0.9);
          color: #f9fafb;
          transition: background 0.15s ease-out, transform 0.15s ease-out;
        }
        .send-to-ollama-toast__button:hover:not(:disabled) {
          background: rgba(37, 99, 235, 0.95);
        }
        .send-to-ollama-toast__button:disabled {
          cursor: default;
          background: rgba(59, 130, 246, 0.5);
        }
        .send-to-ollama-toast__button--tertiary {
          background: rgba(255, 255, 255, 0.15);
          color: #f9fafb;
        }
        .send-to-ollama-toast__button--tertiary:hover {
          background: rgba(255, 255, 255, 0.25);
        }
      `;
      document.head.appendChild(style);
    }
  } catch (error) {
    console.error("Failed to inject toast notification", error);
  }
}
function createNotificationId() {
  if (globalThis.crypto?.randomUUID) {
    return `send-to-ollama-${globalThis.crypto.randomUUID()}`;
  }
  return `send-to-ollama-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
