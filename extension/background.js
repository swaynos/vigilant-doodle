import { OPENAI_BASE_URL } from "./config.js";

// Testing-only credentials and behavior. Replace with secure storage before shipping.
const OPENAI_API_KEY = "sk-your-api-key";
const OPENAI_ASSISTANT_ID = "asst_yourAssistantId";
const SUCCESS_LINK_URL = "https://platform.openai.com/";
const FAILURE_LINK_URL = "https://help.openai.com/";
const CONTEXT_MENU_TITLE = "Send to ChatGPT (Assistants API)";
const REQUEST_TIMEOUT_MS = 20000;
const RUN_POLL_INTERVAL_MS = 1000;
const RUN_POLL_TIMEOUT_MS = 60000;

const MENU_ID = "send-to-chatgpt-assistants";
const notificationLinks = new Map();
const manifest = chrome.runtime.getManifest();
const menuTitle = CONTEXT_MENU_TITLE?.trim() || "Send to ChatGPT (Assistants API)";

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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }

  debugger; // Force a breakpoint if the debugger is active

  const configError = validateAssistantsConfiguration();
  if (configError) {
    await showNotification({
      title: "Assistants API not configured",
      message: configError,
      isError: true,
      targetUrl: FAILURE_LINK_URL,
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
    });
    return;
  }

  const metadata = await collectPageMetadata(tab);

  try {
    const { reply } = await sendSelectionToAssistant(selection, metadata);
    const notificationMessage = formatAssistantReplyForNotification(reply);

    await showNotification({
      title: "Assistant responded",
      message: notificationMessage,
      isError: false,
      targetUrl: SUCCESS_LINK_URL,
    });
  } catch (error) {
    await showNotification({
      title: "Failed to reach Assistant",
      message: error?.message || "Unknown error while contacting OpenAI.",
      isError: true,
      targetUrl: FAILURE_LINK_URL,
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

async function sendSelectionToAssistant(selection, metadata) {
  const prompt = buildAssistantPrompt(selection, metadata);
  const threadId = await createThread();
  await addUserMessage(threadId, prompt);
  const runId = await createRun(threadId);
  const reply = await waitForRunResult(threadId, runId);

  return { reply, threadId, runId };
}

async function createThread() {
  const response = await openaiRequest("/threads", {
    method: "POST",
    body: {},
  });

  if (!response?.id) {
    throw new Error("OpenAI did not return a conversation id.");
  }

  return response.id;
}

async function addUserMessage(threadId, prompt) {
  await openaiRequest(`/threads/${threadId}/messages`, {
    method: "POST",
    body: {
      role: "user",
      content: [
        {
          type: "text",
          text: prompt,
        },
      ],
    },
  });
}

async function createRun(threadId) {
  const response = await openaiRequest(`/threads/${threadId}/runs`, {
    method: "POST",
    body: {
      assistant_id: OPENAI_ASSISTANT_ID,
    },
  });

  if (!response?.id) {
    throw new Error("OpenAI did not return a run id.");
  }

  return response.id;
}

async function waitForRunResult(threadId, runId) {
  const deadline = Date.now() + RUN_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const run = await openaiRequest(`/threads/${threadId}/runs/${runId}`, {
      method: "GET",
    });

    const status = run?.status;
    if (status === "completed") {
      return await fetchAssistantReply(threadId, runId);
    }

    if (status === "failed") {
      const errorMessage = run?.last_error?.message || "Assistant run failed.";
      throw new Error(errorMessage);
    }

    if (status === "cancelled" || status === "expired") {
      throw new Error(`Assistant run ${status}.`);
    }

    if (status === "requires_action") {
      throw new Error("Assistant requested tool outputs, which this extension does not support.");
    }

    await delay(RUN_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for the assistant to finish.");
}

async function fetchAssistantReply(threadId, runId) {
  const response = await openaiRequest(`/threads/${threadId}/messages?limit=20`, {
    method: "GET",
  });

  const messages = Array.isArray(response?.data) ? response.data : [];
  const matchingMessage =
    messages.find((message) => message?.run_id === runId && message?.role === "assistant") ||
    messages.find((message) => message?.role === "assistant");

  return extractTextFromMessage(matchingMessage);
}

function extractTextFromMessage(message) {
  if (!message?.content) {
    return "";
  }

  const parts = message.content
    .filter((part) => part?.type === "text")
    .map((part) => part?.text?.value || "")
    .filter(Boolean);

  return parts.join("\n\n").trim();
}

async function openaiRequest(path, { method = "GET", body, headers = {} } = {}) {
  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key is missing. Update extension/config.js.");
  }

  const url = buildOpenAIUrl(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
        Accept: "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const responseText = await response.text();
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = responseText && isJson ? JSON.parse(responseText) : responseText;

    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.message ||
        (typeof payload === "string" && payload.trim()) ||
        `OpenAI returned status ${response.status}`;
      throw new Error(message);
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Request timed out while contacting OpenAI.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildOpenAIUrl(path) {
  const base = (OPENAI_BASE_URL || "").replace(/\/+$/, "");
  const trimmedPath = String(path || "").replace(/^\/+/, "");
  return `${base}/${trimmedPath}`;
}

function buildAssistantPrompt(selection, metadata) {
  const lines = [
    "The user highlighted the following text:",
    selection,
  ];

  const contextLines = [];

  if (metadata.url) contextLines.push(`- Page URL: ${metadata.url}`);
  if (metadata.title) contextLines.push(`- Page Title: ${metadata.title}`);
  if (metadata.language) contextLines.push(`- Language: ${metadata.language}`);
  if (metadata.description) contextLines.push(`- Meta Description: ${metadata.description}`);
  if (metadata.ogTitle) contextLines.push(`- Open Graph Title: ${metadata.ogTitle}`);
  if (metadata.ogDescription) contextLines.push(`- Open Graph Description: ${metadata.ogDescription}`);
  if (metadata.referrer) contextLines.push(`- Referrer: ${metadata.referrer}`);
  if (metadata.userAgent) contextLines.push(`- User Agent: ${metadata.userAgent}`);

  if (contextLines.length) {
    lines.push("", "Additional page context:", ...contextLines);
  } else {
    lines.push("", "No additional page metadata was available.");
  }

  lines.push(
    "",
    `Source extension: ${manifest.name} v${manifest.version}`
  );

  return lines.join("\n");
}

function formatAssistantReplyForNotification(reply) {
  if (!reply) {
    return "Sent request to the OpenAI Assistant successfully.";
  }

  const normalized = reply.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Assistant returned an empty response.";
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function validateAssistantsConfiguration() {
  if (!OPENAI_BASE_URL) {
    return "Update extension/config.js with your OpenAI base URL.";
  }

  if (!OPENAI_API_KEY || OPENAI_API_KEY === "sk-your-api-key") {
    return "Update extension/config.js with your OpenAI API key.";
  }

  if (!OPENAI_ASSISTANT_ID || OPENAI_ASSISTANT_ID === "asst_yourAssistantId") {
    return "Update extension/config.js with your OpenAI assistant id.";
  }

  return null;
}

async function collectPageMetadata(tab) {
  if (!tab?.id) {
    return fallbackMetadata(tab);
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const getMeta = (name) =>
          document.querySelector(`meta[name="${name}"]`)?.content ||
          document.querySelector(`meta[property="${name}"]`)?.content ||
          null;

        return {
          url: window.location.href,
          title: document.title,
          language: document.documentElement.lang || navigator.language || null,
          description: getMeta("description"),
          ogTitle: getMeta("og:title"),
          ogDescription: getMeta("og:description"),
          referrer: document.referrer || null,
          userAgent: navigator.userAgent,
        };
      },
    });
    return {
      url: result?.result?.url ?? tab.url ?? null,
      title: result?.result?.title ?? tab.title ?? null,
      language: result?.result?.language ?? null,
      description: result?.result?.description ?? null,
      ogTitle: result?.result?.ogTitle ?? null,
      ogDescription: result?.result?.ogDescription ?? null,
      referrer: result?.result?.referrer ?? null,
      userAgent: result?.result?.userAgent ?? null,
    };
  } catch (error) {
    return fallbackMetadata(tab);
  }
}

function fallbackMetadata(tab) {
  return {
    url: tab?.url ?? null,
    title: tab?.title ?? null,
    language: null,
    description: null,
    ogTitle: null,
    ogDescription: null,
    referrer: null,
    userAgent: null,
  };
}

async function showNotification({ title, message, isError, targetUrl }) {
  const notificationId = createNotificationId();
  const options = {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title,
    message,
    priority: 0,
  };

  if (isError) {
    options.title = title || "Send to ChatGPT (Assistants API)";
  }

  if (targetUrl) {
    options.buttons = [{ title: "Open link" }];
    notificationLinks.set(notificationId, targetUrl);
  }

  await chrome.notifications.create(notificationId, options);
}

function openUrlInNewTab(url) {
  chrome.tabs.create({ url });
}

function createNotificationId() {
  if (globalThis.crypto?.randomUUID) {
    return `send-to-chatgpt-${globalThis.crypto.randomUUID()}`;
  }
  return `send-to-chatgpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
