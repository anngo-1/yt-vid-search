export function safePersist(data: Record<string, unknown>): void {
    try {
        chrome.storage.local.set(data);
    } catch {
        console.warn('[ask-transcript] Failed to persist (extension context invalidated)');
    }
}
