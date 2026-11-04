/**
 * False once this content script's extension has been reloaded or updated: Chrome leaves the old script
 * running in open tabs but cuts it off, and any chrome.* call then throws "Extension context invalidated".
 */
export function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}
