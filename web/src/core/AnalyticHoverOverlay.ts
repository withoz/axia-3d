/**
 * AnalyticHoverOverlay — ADR-070 Phase 1 Path Y C pilot.
 *
 * DOM overlay (absolute-positioned tooltip) showing surface/curve kind
 * + 주요 params on hover. Reads via WASM `getFaceSurfaceJson` /
 * `getEdgeCurveJson` (ADR-060 Step 6 endpoints — read-only).
 *
 * Per ADR-070 §C lock-ins:
 *   #1 DOM overlay only — Three.js helper objects 별도 ADR.
 *   #2 localStorage 영구 토글 (default off).
 *   #3 Hover read-only — selection / preselect 무관.
 *   #4 raf-throttle — 매 프레임 WASM call 회피.
 *
 * @see docs/adr/070-adr-046-phase-1-path-y-analytic-hover-overlay-pilot.md
 */

/** ADR-070 §B — overlay 데이터 입력 (debounced from mouse). */
export interface HoverProbe {
  /** 'face' or 'edge' or null (no hover). */
  target: { kind: 'face' | 'edge'; id: number } | null;
  /** Mouse position in viewport coords (px). */
  screenX: number;
  screenY: number;
}

/** Bridge contract — provides WASM lookups + toggle state. */
export interface AnalyticHoverOverlayBridge {
  getFaceSurfaceJson(faceId: number): string | null;
  getEdgeCurveJson(edgeId: number): string | null;
}

/** ADR-070 §D #4 — localStorage key (영구 고정). */
export const ANALYTIC_HOVER_OVERLAY_LS_KEY = 'axia.analyticHoverOverlay.enabled';

export class AnalyticHoverOverlay {
  private bridge: AnalyticHoverOverlayBridge;
  private overlayEl: HTMLElement;
  private container: HTMLElement;
  private enabled: boolean;
  /** ADR-070 §C #4 raf-throttle handle. */
  private rafHandle: number | null = null;
  /** Last probe — only re-evaluate when changed. */
  private lastProbe: HoverProbe | null = null;
  private lastRenderedTarget: string = '';  // 'face:42' / 'edge:7' / ''

  constructor(container: HTMLElement, bridge: AnalyticHoverOverlayBridge) {
    this.container = container;
    this.bridge = bridge;

    // Read persisted toggle state.
    let saved = false;
    try {
      saved = localStorage.getItem(ANALYTIC_HOVER_OVERLAY_LS_KEY) === '1';
    } catch { saved = false; }
    this.enabled = saved;

    // ADR-070 §C #3 — pointer-events: none (self-overlay 차단).
    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'analytic-hover-overlay';
    this.overlayEl.className = 'aho-tooltip';
    this.overlayEl.style.cssText = `
      position: fixed; pointer-events: none;
      background: rgba(28, 28, 32, 0.92); color: #e8e8e8;
      border: 1px solid #555; border-radius: 4px;
      padding: 4px 8px; font-family: ui-monospace, monospace;
      font-size: 11px; z-index: 9999;
      max-width: 360px; line-height: 1.45;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
      display: none;
    `;
    container.appendChild(this.overlayEl);
    this.injectStyles();
  }

  /** Toggle overlay on/off. Persists to localStorage. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(ANALYTIC_HOVER_OVERLAY_LS_KEY, on ? '1' : '0');
    } catch {}
    if (!on) this.hide();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** ADR-070 Step 2 — Mouse hover update (called per mousemove via raf-throttle). */
  update(probe: HoverProbe): void {
    if (!this.enabled) return;
    this.lastProbe = probe;
    if (this.rafHandle !== null) return;  // throttled — coalesce
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.flush();
    });
  }

  /** Test-only — bypass raf to force render. */
  flushForTest(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.flush();
  }

  dispose(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.overlayEl.remove();
  }

  private flush(): void {
    const probe = this.lastProbe;
    if (!probe || !this.enabled) {
      this.hide();
      return;
    }
    if (!probe.target) {
      this.hide();
      return;
    }

    const targetKey = `${probe.target.kind}:${probe.target.id}`;
    if (targetKey !== this.lastRenderedTarget) {
      this.lastRenderedTarget = targetKey;
      const html = this.formatTarget(probe.target);
      if (!html) {
        this.hide();
        return;
      }
      this.overlayEl.innerHTML = html;
    }

    // Position overlay near cursor (offset right + below).
    this.overlayEl.style.left = `${probe.screenX + 16}px`;
    this.overlayEl.style.top = `${probe.screenY + 16}px`;
    this.overlayEl.style.display = 'block';
  }

  private hide(): void {
    this.overlayEl.style.display = 'none';
    this.lastRenderedTarget = '';
  }

  /** ADR-070 §B D-E — kind + 주요 params (full JSON 미사용). */
  private formatTarget(target: { kind: 'face' | 'edge'; id: number }): string | null {
    if (target.kind === 'face') {
      return this.formatFace(target.id);
    } else {
      return this.formatEdge(target.id);
    }
  }

  private formatFace(faceId: number): string | null {
    let raw: string | null;
    try {
      raw = this.bridge.getFaceSurfaceJson(faceId);
    } catch {
      raw = null;
    }
    if (!raw || raw === 'null') {
      return `<span class="aho-id">Face ${faceId}</span> · <span class="aho-kind">polygon</span>`;
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return `<span class="aho-id">Face ${faceId}</span> · <span class="aho-warn">parse error</span>`;
    }
    const kind = (json.kind as string) ?? '?';
    const params = this.summarizeFaceParams(kind, json);
    return `
      <span class="aho-id">Face ${faceId}</span> · <span class="aho-kind">${this.escape(kind)}</span>
      ${params ? `<br><span class="aho-params">${params}</span>` : ''}
    `;
  }

  private formatEdge(edgeId: number): string | null {
    let raw: string | null;
    try {
      raw = this.bridge.getEdgeCurveJson(edgeId);
    } catch {
      raw = null;
    }
    if (!raw || raw === 'null') {
      return `<span class="aho-id">Edge ${edgeId}</span> · <span class="aho-kind">straight</span>`;
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return `<span class="aho-id">Edge ${edgeId}</span> · <span class="aho-warn">parse error</span>`;
    }
    const kind = (json.kind as string) ?? '?';
    const params = this.summarizeEdgeParams(kind, json);
    return `
      <span class="aho-id">Edge ${edgeId}</span> · <span class="aho-kind">${this.escape(kind)}</span>
      ${params ? `<br><span class="aho-params">${params}</span>` : ''}
    `;
  }

  private summarizeFaceParams(kind: string, json: Record<string, unknown>): string {
    const fmt = (n: number) => n.toFixed(3).replace(/\.?0+$/, '');
    const v = (key: string): string | null => {
      const arr = json[key] as number[] | undefined;
      if (!arr || arr.length < 3) return null;
      return `[${fmt(arr[0])}, ${fmt(arr[1])}, ${fmt(arr[2])}]`;
    };
    switch (kind) {
      case 'Plane':
        return [v('origin') && `origin=${v('origin')}`, v('normal') && `normal=${v('normal')}`]
          .filter(Boolean).join(' · ');
      case 'Cylinder':
        return [
          v('axisOrigin') && `axisOrigin=${v('axisOrigin')}`,
          json.radius != null ? `r=${fmt(Number(json.radius))}` : null,
        ].filter(Boolean).join(' · ');
      case 'Sphere':
        return [
          v('center') && `center=${v('center')}`,
          json.radius != null ? `r=${fmt(Number(json.radius))}` : null,
        ].filter(Boolean).join(' · ');
      case 'Cone':
        return [
          v('apex') && `apex=${v('apex')}`,
          json.halfAngle != null ? `α=${fmt(Number(json.halfAngle))}` : null,
        ].filter(Boolean).join(' · ');
      case 'Torus':
        return [
          v('center') && `center=${v('center')}`,
          json.majorRadius != null ? `R=${fmt(Number(json.majorRadius))}` : null,
          json.minorRadius != null ? `r=${fmt(Number(json.minorRadius))}` : null,
        ].filter(Boolean).join(' · ');
      case 'BezierPatch':
      case 'BSplineSurface':
      case 'NURBSSurface':
        return `nU=${json.nU ?? '?'} · nV=${json.nV ?? '?'}`;
      default:
        return '';
    }
  }

  private summarizeEdgeParams(kind: string, json: Record<string, unknown>): string {
    const fmt = (n: number) => n.toFixed(3).replace(/\.?0+$/, '');
    const v = (key: string): string | null => {
      const arr = json[key] as number[] | undefined;
      if (!arr || arr.length < 3) return null;
      return `[${fmt(arr[0])}, ${fmt(arr[1])}, ${fmt(arr[2])}]`;
    };
    switch (kind) {
      case 'Line':
        return [v('start') && `start=${v('start')}`, v('end') && `end=${v('end')}`]
          .filter(Boolean).join(' · ');
      case 'Circle':
      case 'Arc':
        return [
          v('center') && `center=${v('center')}`,
          json.radius != null ? `r=${fmt(Number(json.radius))}` : null,
        ].filter(Boolean).join(' · ');
      case 'Bezier':
      case 'BSpline':
      case 'NURBS': {
        const ctrl = json.controlPts as number[][] | undefined;
        return `ctrlPts=${ctrl?.length ?? '?'}`;
      }
      default:
        return '';
    }
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private injectStyles(): void {
    const styleId = 'analytic-hover-overlay-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .aho-tooltip .aho-id {
        color: #88c8a8; font-weight: 600;
      }
      .aho-tooltip .aho-kind {
        color: #f0c060; font-weight: 600;
      }
      .aho-tooltip .aho-params {
        color: #aaa; font-size: 10px;
      }
      .aho-tooltip .aho-warn {
        color: #e07878; font-style: italic;
      }
    `;
    document.head.appendChild(style);
  }
}
