/**
 * ReferenceImage — HTML overlay that pins a user-chosen image on top of
 * the 3D viewport for tracing / proportion matching.
 *
 * Design choice: the image is a plain `<img>` positioned over the canvas
 * via CSS, NOT a Three.js plane in 3D space. Rationale:
 *   - zero coupling to camera state → image stays put while user orbits
 *   - arbitrary pixel-perfect positioning (drag, resize)
 *   - no texture upload / geometry allocation cost
 *   - trivial opacity slider
 *
 * When the user wants a 3D billboard instead they can build one with the
 * existing Rect tool + material assignment later.
 *
 * Interactions:
 *   - Click-drag body     → translate
 *   - Shift+wheel         → scale
 *   - Opacity input       → alpha
 *   - Hide button         → detach from DOM (kept in memory for re-show)
 *   - Close button        → dispose
 */

export interface ReferenceImageOptions {
  container: HTMLElement;
}

export class ReferenceImage {
  private overlay: HTMLElement;
  private imgEl: HTMLImageElement;
  private toolbar: HTMLElement;
  private opacityInput: HTMLInputElement;
  private dragState: { startX: number; startY: number; baseLeft: number; baseTop: number } | null = null;
  private onMove: ((e: MouseEvent) => void) | null = null;
  private onUp: ((e: MouseEvent) => void) | null = null;

  constructor(src: string, opts: ReferenceImageOptions) {
    const container = opts.container;

    this.overlay = document.createElement('div');
    this.overlay.className = 'axia-refimg';
    Object.assign(this.overlay.style, {
      position: 'absolute',
      left: '64px', top: '80px',
      width: '320px',
      pointerEvents: 'auto',
      border: '1px solid rgba(255,255,255,0.25)',
      background: 'transparent',
      boxSizing: 'content-box',
      zIndex: '60', // above viewport but below toasts (10000)
      cursor: 'move',
    });

    this.imgEl = document.createElement('img');
    this.imgEl.src = src;
    Object.assign(this.imgEl.style, {
      display: 'block',
      width: '100%',
      height: 'auto',
      opacity: '0.6',
      userSelect: 'none',
      pointerEvents: 'none',
    });
    this.imgEl.draggable = false;

    this.toolbar = this.buildToolbar();
    this.opacityInput = this.toolbar.querySelector('.axia-refimg-alpha') as HTMLInputElement;

    this.overlay.appendChild(this.imgEl);
    this.overlay.appendChild(this.toolbar);
    container.appendChild(this.overlay);

    this.attachDragHandlers();
    this.attachWheelResize();
  }

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'absolute',
      top: '-30px',
      right: '0',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      background: 'rgba(20, 22, 26, 0.92)',
      color: 'rgba(255,255,255,0.85)',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    bar.innerHTML = `
      <span>투명도</span>
      <input type="range" class="axia-refimg-alpha" min="0.05" max="1" step="0.05" value="0.6"
             style="width: 80px; cursor: pointer;"/>
      <button class="axia-refimg-close" title="닫기"
              style="background:none; border:none; color:rgba(255,255,255,0.7);
                     cursor:pointer; font-size:14px; padding: 0 4px;">✕</button>
    `;
    const alpha = bar.querySelector('.axia-refimg-alpha') as HTMLInputElement;
    alpha.addEventListener('input', () => {
      this.imgEl.style.opacity = alpha.value;
    });
    alpha.addEventListener('mousedown', e => e.stopPropagation());
    alpha.addEventListener('wheel',     e => e.stopPropagation());

    const closeBtn = bar.querySelector('.axia-refimg-close') as HTMLButtonElement;
    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.dispose();
    });
    closeBtn.addEventListener('mousedown', e => e.stopPropagation());
    return bar;
  }

  private attachDragHandlers(): void {
    this.overlay.addEventListener('mousedown', e => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'BUTTON') return;
      e.preventDefault();
      const rect = this.overlay.getBoundingClientRect();
      this.dragState = {
        startX: e.clientX, startY: e.clientY,
        baseLeft: rect.left - (this.overlay.parentElement?.getBoundingClientRect().left ?? 0),
        baseTop:  rect.top  - (this.overlay.parentElement?.getBoundingClientRect().top  ?? 0),
      };
      this.onMove = (ev) => {
        if (!this.dragState) return;
        const dx = ev.clientX - this.dragState.startX;
        const dy = ev.clientY - this.dragState.startY;
        this.overlay.style.left = `${this.dragState.baseLeft + dx}px`;
        this.overlay.style.top  = `${this.dragState.baseTop  + dy}px`;
      };
      this.onUp = () => {
        this.dragState = null;
        if (this.onMove) document.removeEventListener('mousemove', this.onMove);
        if (this.onUp)   document.removeEventListener('mouseup',   this.onUp);
        this.onMove = null; this.onUp = null;
      };
      document.addEventListener('mousemove', this.onMove);
      document.addEventListener('mouseup',   this.onUp);
    });
  }

  private attachWheelResize(): void {
    this.overlay.addEventListener('wheel', e => {
      if (!e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      const cur = parseFloat(getComputedStyle(this.overlay).width) || 320;
      const scale = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      const next = Math.max(40, Math.min(2000, cur * scale));
      this.overlay.style.width = `${next}px`;
    }, { passive: false });
  }

  dispose(): void {
    if (this.onMove) document.removeEventListener('mousemove', this.onMove);
    if (this.onUp)   document.removeEventListener('mouseup',   this.onUp);
    this.overlay.remove();
  }
}

/**
 * Open a file picker, load the selected image as a data URL, and
 * attach it to the container as a new ReferenceImage overlay. No-op
 * if the user cancels.
 *
 * Returns the created instance for callers that want to stash/hide it.
 */
export function promptAndAddReferenceImage(container: HTMLElement): Promise<ReferenceImage | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let settled = false;
    const cleanup = () => { if (!settled) input.remove(); };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { settled = true; cleanup(); resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result as string;
        const ref = new ReferenceImage(src, { container });
        settled = true; cleanup();
        resolve(ref);
      };
      reader.onerror = () => { settled = true; cleanup(); resolve(null); };
      reader.readAsDataURL(file);
    });
    input.addEventListener('cancel', () => { settled = true; cleanup(); resolve(null); });
    document.body.appendChild(input);
    input.click();
  });
}
