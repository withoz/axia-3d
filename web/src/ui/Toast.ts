/**
 * Toast notification system for user feedback.
 * Shows temporary messages at the bottom of the viewport.
 *
 * Usage:
 *   Toast.init(container);
 *   Toast.success('Saved successfully');
 *   Toast.error('Failed to export');
 *   Toast.warning('Deprecated action');
 *   Toast.info('Processing...');
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

/**
 * ADR-091 D-δ — Optional action button payload for `Toast.show`.
 * When supplied, an inline button (label + click handler) is rendered
 * to the right of the message. Clicking the button invokes `onClick`
 * once and dismisses the toast immediately. Backward-compatible —
 * existing callers pass `undefined` and see no UI change.
 */
export interface ToastAction {
  /** Button label (Korean OK; rendered as plain text). */
  label: string;
  /** Click handler — invoked exactly once before the toast is dismissed. */
  onClick: () => void;
}

export class Toast {
  private container: HTMLElement;
  private toastQueue: HTMLElement[] = [];
  private maxToasts: number = 3;
  private static instance: Toast | null = null;

  private static readonly COLORS = {
    success: '#27ae60',
    error: '#c0392b',
    warning: '#e67e22',
    info: '#2e75b6',
  };

  private constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'axia-toast-container';
    this.container.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    `;
    parent.appendChild(this.container);
  }

  /**
   * Initialize Toast system. Call once on app startup.
   */
  static init(parent: HTMLElement): Toast {
    if (!Toast.instance) {
      Toast.instance = new Toast(parent);
    }
    return Toast.instance;
  }

  /**
   * Get singleton instance. Returns null if not initialized.
   */
  static getInstance(): Toast | null {
    return Toast.instance;
  }

  /**
   * Show a toast notification.
   * @param message The message to display
   * @param type Type of notification: 'success', 'error', 'warning', 'info'
   * @param duration How long to show in milliseconds (default 3000)
   */
  show(
    message: string,
    type: ToastType = 'info',
    duration: number = 3000,
    action?: ToastAction,
  ): void {
    const toastEl = document.createElement('div');
    const bgColor = Toast.COLORS[type];

    toastEl.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background-color: ${bgColor};
      color: white;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-size: 14px;
      font-weight: 500;
      max-width: 400px;
      word-break: break-word;
      pointer-events: auto;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      animation: slideUp 0.3s ease-out;
      opacity: 1;
    `;

    // Icon (simple colored square or symbol)
    const iconEl = document.createElement('div');
    iconEl.style.cssText = `
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
    `;

    switch (type) {
      case 'success':
        iconEl.textContent = '✓';
        break;
      case 'error':
        iconEl.textContent = '✕';
        break;
      case 'warning':
        iconEl.textContent = '⚠';
        break;
      case 'info':
        iconEl.textContent = 'ℹ';
        break;
    }

    // Message text
    const textEl = document.createElement('span');
    textEl.textContent = message;
    textEl.style.flex = '1';

    toastEl.appendChild(iconEl);
    toastEl.appendChild(textEl);

    // ADR-091 D-δ — Optional action button (e.g., "되돌리기"). Click
    // invokes the handler once, then dismisses the toast immediately.
    // Action click stops propagation so it doesn't double-trigger the
    // outer "click to dismiss" handler.
    let actionInvoked = false;
    if (action) {
      const actionEl = document.createElement('button');
      actionEl.type = 'button';
      actionEl.textContent = action.label;
      actionEl.style.cssText = `
        flex-shrink: 0;
        margin-left: 8px;
        padding: 4px 10px;
        background-color: rgba(255, 255, 255, 0.2);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.5);
        border-radius: 4px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      `;
      actionEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!actionInvoked) {
          actionInvoked = true;
          try { action.onClick(); } catch { /* swallow handler errors */ }
        }
        this.removeToast(toastEl);
      });
      toastEl.appendChild(actionEl);
    }

    // Click to dismiss
    toastEl.addEventListener('click', () => {
      this.removeToast(toastEl);
    });

    // Add to container
    this.container.appendChild(toastEl);
    this.toastQueue.push(toastEl);

    // Enforce max toasts
    if (this.toastQueue.length > this.maxToasts) {
      const oldestToast = this.toastQueue.shift();
      if (oldestToast) {
        oldestToast.style.animation = 'slideDown 0.3s ease-in forwards';
        setTimeout(() => oldestToast.remove(), 300);
      }
    }

    // Auto-dismiss
    setTimeout(() => {
      if (toastEl.parentElement) {
        this.removeToast(toastEl);
      }
    }, duration);
  }

  /**
   * Remove a toast with slide-down animation.
   */
  private removeToast(toastEl: HTMLElement): void {
    const index = this.toastQueue.indexOf(toastEl);
    if (index > -1) {
      this.toastQueue.splice(index, 1);
    }

    toastEl.style.animation = 'slideDown 0.3s ease-in forwards';
    setTimeout(() => {
      if (toastEl.parentElement) {
        toastEl.remove();
      }
    }, 300);
  }

  // ════════════════════════════════════════════════
  // Convenience Methods
  // ════════════════════════════════════════════════

  static success(message: string, duration?: number): void {
    Toast.getInstance()?.show(message, 'success', duration);
  }

  static error(message: string, duration?: number): void {
    Toast.getInstance()?.show(message, 'error', duration);
  }

  static warning(message: string, duration?: number): void {
    Toast.getInstance()?.show(message, 'warning', duration);
  }

  static info(message: string, duration?: number): void {
    Toast.getInstance()?.show(message, 'info', duration);
  }

  /**
   * ADR-091 D-δ — Info toast with an inline action button (e.g.,
   * "되돌리기"). Used by Material Removal → Shape demotion to give the
   * user a 5-second one-click Undo affordance per Lock-in D-E=a.
   */
  static infoWithAction(
    message: string,
    action: ToastAction,
    duration: number = 5000,
  ): void {
    Toast.getInstance()?.show(message, 'info', duration, action);
  }

  /**
   * Show a failure toast that prefers the engine's last error message,
   * falling back to `fallback` when the engine didn't populate one.
   * Standardizes the `Toast.error(bridge.lastError() || 'X 실패')` idiom
   * used across action handlers.
   */
  static fromBridgeError(
    bridge: { lastError(): string },
    fallback: string,
    severity: 'error' | 'warning' = 'error',
    duration?: number,
  ): void {
    const err = bridge.lastError();
    const msg = err && err.trim().length > 0 ? err : fallback;
    if (severity === 'warning') {
      Toast.warning(msg, duration);
    } else {
      Toast.error(msg, duration);
    }
  }
}

// Inject CSS animations into document head (run once on first import)
function injectToastStyles(): void {
  if (document.getElementById('axia-toast-styles')) return;

  const style = document.createElement('style');
  style.id = 'axia-toast-styles';
  style.textContent = `
    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    @keyframes slideDown {
      from {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
    }
  `;
  document.head.appendChild(style);
}

// Auto-inject styles on module load
injectToastStyles();
