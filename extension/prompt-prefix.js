const PROMPT_FILES = Object.freeze({
  summarize: "prompts/summarize.txt",
  format: "prompts/format.txt",
});

const promptCache = new Map();
const loadPromises = new Map();

export async function getPromptTemplate(key) {
  if (!PROMPT_FILES[key]) {
    console.warn(`Requested unknown prompt template "${key}".`);
    return "";
  }

  if (promptCache.has(key)) {
    return promptCache.get(key);
  }

  if (!loadPromises.has(key)) {
    loadPromises.set(
      key,
      loadPromptTemplateFromFile(PROMPT_FILES[key])
        .then((template) => {
          promptCache.set(key, template);
          return template;
        })
        .finally(() => {
          loadPromises.delete(key);
        })
    );
  }

  return loadPromises.get(key);
}

export function listPromptTemplates() {
  return Object.keys(PROMPT_FILES);
}

async function loadPromptTemplateFromFile(path) {
  try {
    const resourceUrl = chrome.runtime.getURL(path);
    const response = await fetch(resourceUrl);

    if (!response.ok) {
      throw new Error(`Failed to load prompt template (status ${response.status}).`);
    }

    return (await response.text()).trim();
  } catch (error) {
    console.error(`Unable to read prompt template "${path}".`, error);
    return "";
  }
}
