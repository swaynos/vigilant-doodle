const PROMPT_PREFIX_PATH = "prompt-prefix.txt";

let cachedPrefix = null;
let loadPromise = null;

export async function getPromptPrefix() {
  if (cachedPrefix !== null) {
    return cachedPrefix;
  }

  if (!loadPromise) {
    loadPromise = loadPromptPrefixFromFile().finally(() => {
      loadPromise = null;
    });
  }

  cachedPrefix = await loadPromise;
  return cachedPrefix;
}

async function loadPromptPrefixFromFile() {
  try {
    const resourceUrl = chrome.runtime.getURL(PROMPT_PREFIX_PATH);
    const response = await fetch(resourceUrl);

    if (!response.ok) {
      throw new Error(`Failed to load prompt prefix (status ${response.status}).`);
    }

    const prefix = (await response.text()).trim();
    return prefix;
  } catch (error) {
    console.error("Unable to read prompt prefix. Falling back to empty prefix.", error);
    return "";
  }
}
