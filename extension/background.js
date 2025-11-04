import { OLLAMA_BASE_URL, OLLAMA_MODEL } from "./config.js";
import { getPromptPrefix } from "./prompt-prefix.js";

const SUCCESS_LINK_URL = "https://ollama.com/library";
const FAILURE_LINK_URL =
  "https://github.com/ollama/ollama/blob/main/docs/troubleshooting.md";
const CONTEXT_MENU_TITLE = "Send to Ollama";
const REQUEST_TIMEOUT_MS = 20000;

const MENU_ID = "send-to-ollama";
const notificationLinks = new Map();
const manifest = chrome.runtime.getManifest();
const menuTitle = CONTEXT_MENU_TITLE?.trim() || "Send to Ollama";

chrome.runtime.onInstalled.addListener(async () => {
  await createOrUpdateContextMenu();
});

chrome.runtime.onStartup.addListener(async () => {
  await createOrUpdateContextMenu();
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const targetUrl = notificationLinks.get(notificationId);
  if (targetUrl) {
    openUrlInNewTab(targetUrl);
  }
  chrome.notifications.clear(notificationId);
  notificationLinks.delete(notificationId);
});

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  const targetUrl = notificationLinks.get(notificationId);
  if (targetUrl) {
    openUrlInNewTab(targetUrl);
  }
  chrome.notifications.clear(notificationId);
  notificationLinks.delete(notificationId);
});

chrome.notifications.onClosed.addListener((notificationId) => {
  notificationLinks.delete(notificationId);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "send-to-ollama:open-link" && message.url) {
    openUrlInNewTab(message.url);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }

  debugger; // Force a breakpoint if the debugger is active.

  const configError = validateOllamaConfiguration();
  if (configError) {
    await showNotification({
      title: "Ollama not configured",
      message: configError,
      isError: true,
      targetUrl: FAILURE_LINK_URL,
      tabId: tab?.id,
    });
    return;
  }

  const selection = (info.selectionText || "").trim();
  if (!selection) {
    await showNotification({
      title: "Nothing to send",
      message: `Select some text before using "${menuTitle}".`,
      isError: true,
      targetUrl: FAILURE_LINK_URL,
      tabId: tab?.id,
    });
    return;
  }

  try {
    const { reply } = await sendSelectionToOllama(selection);
    const notificationMessage = formatAssistantReplyForNotification(reply);

    await showNotification({
      title: "Ollama responded",
      message: notificationMessage,
      isError: false,
      targetUrl: SUCCESS_LINK_URL,
      tabId: tab?.id,
    });
  } catch (error) {
    await showNotification({
      title: "Failed to reach Ollama",
      message: error?.message || "Unknown error while contacting Ollama.",
      isError: true,
      targetUrl: FAILURE_LINK_URL,
      tabId: tab?.id,
    });
  }
});

async function createOrUpdateContextMenu() {
  try {
    await chrome.contextMenus.remove(MENU_ID);
  } catch (error) {
    // Ignore missing menu errors.
  }

  chrome.contextMenus.create({
    id: MENU_ID,
    title: menuTitle,
    contexts: ["selection"],
  });
}

async function sendSelectionToOllama(selection) {
  const promptPrefix = await getPromptPrefix();
  const prompt = buildAssistantPrompt(selection, promptPrefix);

  const response = await ollamaRequest("/api/chat", {
    method: "POST",
    body: {
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are helping a browser extension user who highlighted part of a Slack conversation. Summarize the snippet into a concise, meaningful update that captures key decisions, action items, and blockers.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    },
  });

  const reply = extractTextFromOllamaResponse(response);

  return { reply };
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

async function ollamaRequest(path, { method = "GET", body, headers = {} } = {}) {
  if (!OLLAMA_BASE_URL) {
    throw new Error("Ollama base URL is missing. Update extension/config.js.");
  }

  const url = buildOllamaUrl(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
      throw new Error("Request timed out while contacting Ollama.");
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

function buildAssistantPrompt(selection, promptPrefix = "") {
  const lines = [];

  if (promptPrefix) {
    lines.push(promptPrefix, "");
  }

  lines.push("Slack conversation snippet:", selection);

  lines.push("", `Source extension: ${manifest.name} v${manifest.version}`);

  return lines.join("\n");
}

function formatAssistantReplyForNotification(reply) {
  if (!reply) {
    return "Sent request to the Ollama model successfully.";
  }

  const normalized = reply.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Ollama returned an empty response.";
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
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

async function showNotification({ title, message, isError, targetUrl, tabId }) {
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
            targetUrl: targetUrl || null,
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

  if (targetUrl) {
    options.buttons = [{ title: "Open link" }];
    notificationLinks.set(notificationId, targetUrl);
  }

  await chrome.notifications.create(notificationId, options);
}

function injectToastIntoPage({ title, message, isError, targetUrl }) {
  try {
    const containerId = "send-to-ollama-toast-container";
    const styleId = "send-to-ollama-toast-styles";
    const displayDurationMs = 8000;
    const fadeDurationMs = 200;

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
      }, fadeDurationMs);
    };

    const actions = document.createElement("div");
    actions.className = "send-to-ollama-toast__actions";

    if (targetUrl) {
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "send-to-ollama-toast__button";
      openButton.textContent = "Open link";
      openButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({
          type: "send-to-ollama:open-link",
          url: targetUrl,
        });
        dismiss();
      });
      actions.appendChild(openButton);
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
    }, displayDurationMs);

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
      }, fadeDurationMs);
    });

    toast.addEventListener("focusout", () => {
      toast.classList.add("send-to-ollama-toast--leaving");
      window.setTimeout(() => {
        dismiss();
      }, fadeDurationMs);
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
        .send-to-ollama-toast__actions {
          margin-top: 14px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .send-to-ollama-toast__button {
          cursor: pointer;
          border-radius: 6px;
          border: none;
          padding: 6px 12px;
          font-size: 13px;
          font-weight: 500;
          background: #2563eb;
          color: #ffffff;
        }
        .send-to-ollama-toast__button:focus {
          outline: 2px solid rgba(37, 99, 235, 0.35);
          outline-offset: 2px;
        }
        .send-to-ollama-toast__button--tertiary {
          background: transparent;
          color: inherit;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .send-to-ollama-toast__button--tertiary:focus {
          outline: 2px solid rgba(148, 163, 184, 0.4);
          outline-offset: 2px;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  } catch (error) {
    console.error("Failed to inject toast notification.", error);
  }
}

function openUrlInNewTab(url) {
  chrome.tabs.create({ url });
}

function createNotificationId() {
  if (globalThis.crypto?.randomUUID) {
    return `send-to-ollama-${globalThis.crypto.randomUUID()}`;
  }
  return `send-to-ollama-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
