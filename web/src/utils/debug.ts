/**
 * Debug logging utility — gated behind a global flag.
 *
 * In production, all debug logs are no-ops (zero overhead).
 * Enable debug mode by setting `window.__AXIA_DEBUG = true` in the console.
 */

declare global {
  interface Window {
    __AXIA_DEBUG?: boolean;
  }
}

/** Check if debug mode is enabled */
export function isDebug(): boolean {
  return !!(typeof window !== 'undefined' && window.__AXIA_DEBUG);
}

/** Debug log — only outputs when __AXIA_DEBUG is true */
export function debugLog(...args: any[]): void {
  if (isDebug()) {
    console.log(...args);
  }
}

/** Debug warn — only outputs when __AXIA_DEBUG is true */
export function debugWarn(...args: any[]): void {
  if (isDebug()) {
    console.warn(...args);
  }
}
