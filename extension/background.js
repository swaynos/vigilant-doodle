import {
  PROXY_ENDPOINT,
  SUCCESS_LINK_URL,
  FAILURE_LINK_URL,
  REQUEST_TIMEOUT_MS,
  CONTEXT_MENU_TITLE,
} from "./config.js";

const MENU_ID = "send-to-chatgpt-proxy";
const notificationLinks = new Map();
const manifest = chrome.runtime.getManifest();
const menuTitle = CONTEXT_MENU_TITLE?.trim() || "Send to ChatGPT (via Proxy)";

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

  if (!PROXY_ENDPOINT || PROXY_ENDPOINT.includes("your-proxy.example.com")) {
    await showNotification({
      title: "Proxy endpoint missing",
      message: "Update extension/config.js with your proxy endpoint before sending.",
      isError: true,
      targetUrl: FAILURE_LINK_URL,
    });
    return;
  }

  const selection = (info.selectionText || "").trim();
  if (!selection) {
    await showNotification({
      title: "Nothing to send",
      message: `Select some text before using “${menuTitle}”.`,
      isError: true,
      targetUrl: FAILURE_LINK_URL,
    });
    return;
  }

  const metadata = await collectPageMetadata(tab);
  const payload = buildPayload(selection, metadata);

  try {
    console.log("here");
    const response = await postWithTimeout(PROXY_ENDPOINT, payload, REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      throw new Error(`Proxy responded with ${response.status}`);
    }
    await showNotification({
      title: "Sent to ChatGPT",
      message: "Your selection was forwarded successfully.",
      isError: false,
      targetUrl: SUCCESS_LINK_URL,
    });
  } catch (error) {
    await showNotification({
      title: "Failed to send",
      message: error.message || "Unknown error while contacting the proxy.",
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

async function collectPageMetadata(tab) {
  if (!tab?.id) {
    return fallbackMetadata(tab);
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const getMeta = (name) =>
          document.querySelector(`meta[name=\"${name}\"]`)?.content ||
          document.querySelector(`meta[property=\"${name}\"]`)?.content ||
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

function buildPayload(selection, metadata) {
  return {
    createdAt: new Date().toISOString(),
    selection,
    metadata: {
      pageUrl: metadata.url,
      pageTitle: metadata.title,
      language: metadata.language,
      description: metadata.description,
      ogTitle: metadata.ogTitle,
      ogDescription: metadata.ogDescription,
      referrer: metadata.referrer,
      userAgent: metadata.userAgent,
    },
    source: {
      extension: manifest.name,
      version: manifest.version,
    },
  };
}

async function postWithTimeout(url, data, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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
    options.title = title || "Send to ChatGPT (via Proxy)";
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
