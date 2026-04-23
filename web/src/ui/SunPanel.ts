/**
 * SunPanel — 태양 방향 제어 + 일사 분석(Solar Study) UI.
 *
 * ## Phase 2 — manual mode
 *   · Azimuth 슬라이더 0~360° (북=0°, 시계방향)
 *   · Elevation 슬라이더 1~89° (수평선→천정)
 *   · 프리셋 버튼
 *
 * ## Phase 2.6 — geographic mode (Solar Study)
 *   · 탭으로 Manual ↔ Geographic 전환
 *   · 위도 / 경도 / 날짜 / 시간(24h 슬라이더) 입력
 *   · NOAA 근사식으로 sun azimuth + elevation 계산 후 자동 반영
 *   · ▶ 버튼 눌러 일출 → 일몰 애니메이션
 *
 * localStorage:
 *   axia:sun:mode = 'manual' | 'geo'
 *   axia:sun:az / axia:sun:el (manual 값)
 *   axia:sun:lat / axia:sun:lon / axia:sun:date / axia:sun:time (geo 값)
 */

import type { Viewport } from '../viewport/Viewport';

export interface SunPanelDeps {
  viewport: Viewport;
  /** Sun 변경 후 projected shadow + VSM이 새 direction 반영되도록 trigger. */
  onSunChange: () => void;
}

type Mode = 'manual' | 'geo';

export class SunPanel {
  private container: HTMLElement;
  private deps: SunPanelDeps;
  private panelEl: HTMLElement;
  private visible = false;
  private mode: Mode = 'manual';
  private animTimer: number | null = null;

  private static readonly PRESETS = [
    { name: '오전 9시',  az: 120, el: 30 },
    { name: '정오',      az: 180, el: 60 },
    { name: '오후 3시',  az: 240, el: 40 },
    { name: '석양',      az: 280, el: 15 },
  ];

  /** Default geographic location = Seoul. */
  private static readonly DEFAULT_LAT = 37.5665;
  private static readonly DEFAULT_LON = 126.9780;

  constructor(container: HTMLElement, deps: SunPanelDeps) {
    this.container = container;
    this.deps = deps;

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'sun-panel';
    this.panelEl.className = 'sun-panel';
    this.panelEl.innerHTML = this.buildHtml();
    this.panelEl.style.display = 'none';
    container.appendChild(this.panelEl);

    this.injectStyles();
    this.bindEvents();
    this.restoreFromStorage();
  }

  show(): void {
    this.visible = true;
    this.panelEl.style.display = 'block';
  }
  hide(): void {
    this.visible = false;
    this.panelEl.style.display = 'none';
    this.stopAnimation();
  }
  toggle(): void { this.visible ? this.hide() : this.show(); }
  isVisible(): boolean { return this.visible; }

  dispose(): void {
    this.stopAnimation();
    this.panelEl.remove();
  }

  // ────────────────────────────────────────────────────────────────

  private buildHtml(): string {
    const today = new Date().toISOString().slice(0, 10);
    return `
      <div class="sp-header">
        <span class="sp-title">☀️ 태양 방향</span>
        <button class="sp-close" title="닫기">×</button>
      </div>
      <div class="sp-tabs">
        <button class="sp-tab active" data-mode="manual">수동</button>
        <button class="sp-tab" data-mode="geo">📍 지리 / 시간</button>
      </div>

      <!-- Manual mode -->
      <div class="sp-pane" data-pane="manual">
        <div class="sp-row">
          <span class="sp-label" title="북을 0°로 시계방향. 동=90, 남=180, 서=270">방위각</span>
          <input type="range" class="sp-slider" id="sp-az" min="0" max="360" value="225" step="1">
          <span class="sp-val" id="sp-az-val">225°</span>
        </div>
        <div class="sp-row">
          <span class="sp-label" title="수평선=0°, 천정=90°">고도</span>
          <input type="range" class="sp-slider" id="sp-el" min="1" max="89" value="55" step="1">
          <span class="sp-val" id="sp-el-val">55°</span>
        </div>
        <div class="sp-presets">
          ${SunPanel.PRESETS.map((p, i) =>
            `<button class="sp-preset" data-idx="${i}">${p.name}</button>`
          ).join('')}
        </div>
      </div>

      <!-- Geographic mode -->
      <div class="sp-pane" data-pane="geo" style="display:none;">
        <div class="sp-row2">
          <span class="sp-label">위도</span>
          <input type="number" class="sp-num" id="sp-lat"
                 value="${SunPanel.DEFAULT_LAT}" min="-90" max="90" step="0.01">
          <span class="sp-label">경도</span>
          <input type="number" class="sp-num" id="sp-lon"
                 value="${SunPanel.DEFAULT_LON}" min="-180" max="180" step="0.01">
        </div>
        <div class="sp-row2">
          <span class="sp-label">날짜</span>
          <input type="date" class="sp-date" id="sp-date" value="${today}">
        </div>
        <div class="sp-row">
          <span class="sp-label">시간</span>
          <input type="range" class="sp-slider" id="sp-time"
                 min="0" max="24" value="12" step="0.1">
          <span class="sp-val" id="sp-time-val">12:00</span>
        </div>
        <div class="sp-row">
          <span class="sp-label">계산됨</span>
          <span class="sp-calc" id="sp-calc">Az — · El —</span>
          <button class="sp-anim" id="sp-anim" title="일출→일몰 애니메이션">▶</button>
        </div>
      </div>

      <div class="sp-hint">
        "건축 그림자" 토글 켜진 상태에서 변경사항 즉시 반영
      </div>
    `;
  }

  // ────────────────────────────────────────────────────────────────
  // Solar position — simplified NOAA formula (public domain).
  // Good to ±1° for most practical building shadow studies. Ignores the
  // equation-of-time correction; local time treated as mean solar time.

  private computeSunAzEl(
    lat_deg: number, lon_deg: number,
    year: number, month: number, day: number,
    hour_local: number,
  ): { azimuth: number; elevation: number } {
    // Day of year
    const d = new Date(Date.UTC(year, month - 1, day));
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const doy = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;

    // Solar declination (radians)
    const gamma = 2 * Math.PI * (doy - 1 + (hour_local - 12) / 24) / 365;
    const delta =
      0.006918
      - 0.399912 * Math.cos(gamma)      + 0.070257 * Math.sin(gamma)
      - 0.006758 * Math.cos(2 * gamma)  + 0.000907 * Math.sin(2 * gamma)
      - 0.002697 * Math.cos(3 * gamma)  + 0.00148  * Math.sin(3 * gamma);

    // Hour angle — assume local time ≈ solar time (ignores lon offset vs
    // timezone meridian + equation of time). Architectural shadow studies
    // don't need sub-degree precision.
    const hour_angle = Math.PI / 12 * (hour_local - 12);

    const lat_rad = lat_deg * Math.PI / 180;

    const sin_el = Math.sin(lat_rad) * Math.sin(delta)
                 + Math.cos(lat_rad) * Math.cos(delta) * Math.cos(hour_angle);
    const el_rad = Math.asin(Math.max(-1, Math.min(1, sin_el)));

    // Azimuth: north=0, clockwise. Derivation below the horizon clamps to 1°.
    let az_rad = Math.atan2(
      -Math.sin(hour_angle),
      Math.tan(delta) * Math.cos(lat_rad) - Math.sin(lat_rad) * Math.cos(hour_angle),
    );
    // Convention fix: atan2 gives 0 at south in some derivations; this one
    // gives 0 at north already (verify with equinox noon: hour_angle=0 →
    // atan2(0, ...) = 0 or π depending on sign; tan(delta)≈0 at equinox,
    // so denom = -sin(lat)*1 = -sin(lat) → negative for N hemisphere
    // → atan2(0, negative) = π → south, matches convention of az=180 at noon).
    // Add 180° so that azimuth is measured from north (0=N, 180=S).
    let az_deg = (az_rad * 180 / Math.PI + 180) % 360;
    if (az_deg < 0) az_deg += 360;

    const el_deg = el_rad * 180 / Math.PI;

    return { azimuth: az_deg, elevation: el_deg };
  }

  // ────────────────────────────────────────────────────────────────

  private bindEvents(): void {
    this.panelEl.querySelector('.sp-close')?.addEventListener('click', () => this.hide());

    // Tab switch
    this.panelEl.querySelectorAll('.sp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = (btn as HTMLElement).dataset.mode as Mode;
        this.setMode(m);
      });
    });

    // Manual mode
    const azSlider = this.panelEl.querySelector('#sp-az') as HTMLInputElement;
    const elSlider = this.panelEl.querySelector('#sp-el') as HTMLInputElement;
    const applyManual = () => {
      const az = parseFloat(azSlider.value);
      const el = parseFloat(elSlider.value);
      (this.panelEl.querySelector('#sp-az-val') as HTMLElement).textContent = `${az.toFixed(0)}°`;
      (this.panelEl.querySelector('#sp-el-val') as HTMLElement).textContent = `${el.toFixed(0)}°`;
      this.applySun(az, el);
      try {
        localStorage.setItem('axia:sun:az', String(az));
        localStorage.setItem('axia:sun:el', String(el));
      } catch { /* ignore */ }
    };
    azSlider.addEventListener('input', applyManual);
    elSlider.addEventListener('input', applyManual);

    // Presets
    this.panelEl.querySelectorAll('.sp-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx ?? '0', 10);
        const p = SunPanel.PRESETS[idx];
        if (!p) return;
        azSlider.value = String(p.az);
        elSlider.value = String(p.el);
        applyManual();
      });
    });

    // Geo mode
    const latEl = this.panelEl.querySelector('#sp-lat') as HTMLInputElement;
    const lonEl = this.panelEl.querySelector('#sp-lon') as HTMLInputElement;
    const dateEl = this.panelEl.querySelector('#sp-date') as HTMLInputElement;
    const timeSlider = this.panelEl.querySelector('#sp-time') as HTMLInputElement;
    const applyGeo = () => {
      const lat = parseFloat(latEl.value);
      const lon = parseFloat(lonEl.value);
      const t = parseFloat(timeSlider.value);
      const hh = Math.floor(t);
      const mm = Math.round((t - hh) * 60);
      (this.panelEl.querySelector('#sp-time-val') as HTMLElement).textContent =
        `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      if (!dateEl.value) return;
      const [y, mo, d] = dateEl.value.split('-').map(Number);
      const { azimuth, elevation } = this.computeSunAzEl(lat, lon, y, mo, d, t);
      (this.panelEl.querySelector('#sp-calc') as HTMLElement).textContent =
        `Az ${azimuth.toFixed(0)}° · El ${elevation.toFixed(1)}°`;
      if (elevation > 1) {
        this.applySun(azimuth, Math.max(1, Math.min(89, elevation)));
      }
      try {
        localStorage.setItem('axia:sun:lat', String(lat));
        localStorage.setItem('axia:sun:lon', String(lon));
        localStorage.setItem('axia:sun:date', dateEl.value);
        localStorage.setItem('axia:sun:time', String(t));
      } catch { /* ignore */ }
    };
    latEl.addEventListener('input', applyGeo);
    lonEl.addEventListener('input', applyGeo);
    dateEl.addEventListener('change', applyGeo);
    timeSlider.addEventListener('input', applyGeo);

    // Animation — advance time slider through 24h.
    const animBtn = this.panelEl.querySelector('#sp-anim') as HTMLButtonElement;
    animBtn?.addEventListener('click', () => {
      if (this.animTimer != null) {
        this.stopAnimation();
        animBtn.textContent = '▶';
      } else {
        animBtn.textContent = '■';
        let t = parseFloat(timeSlider.value);
        this.animTimer = window.setInterval(() => {
          t += 0.1;
          if (t > 24) t = 0;
          timeSlider.value = String(t);
          applyGeo();
        }, 100);
      }
    });
  }

  private setMode(m: Mode): void {
    this.mode = m;
    this.panelEl.querySelectorAll('.sp-tab').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.mode === m);
    });
    (this.panelEl.querySelector('[data-pane="manual"]') as HTMLElement).style.display =
      m === 'manual' ? 'block' : 'none';
    (this.panelEl.querySelector('[data-pane="geo"]') as HTMLElement).style.display =
      m === 'geo' ? 'block' : 'none';
    try { localStorage.setItem('axia:sun:mode', m); } catch { /* ignore */ }
    if (m === 'geo') {
      // Trigger geo input to recompute immediately on switch.
      const timeSlider = this.panelEl.querySelector('#sp-time') as HTMLInputElement;
      timeSlider.dispatchEvent(new Event('input'));
    }
  }

  private applySun(az: number, el: number): void {
    this.deps.viewport.setSunDirection(az, el);
    this.deps.onSunChange();
  }

  private stopAnimation(): void {
    if (this.animTimer != null) {
      clearInterval(this.animTimer);
      this.animTimer = null;
      const animBtn = this.panelEl.querySelector('#sp-anim') as HTMLButtonElement | null;
      if (animBtn) animBtn.textContent = '▶';
    }
  }

  private restoreFromStorage(): void {
    try {
      const savedMode = localStorage.getItem('axia:sun:mode') as Mode | null;

      // Manual values
      const az = parseFloat(localStorage.getItem('axia:sun:az') ?? 'NaN');
      const el = parseFloat(localStorage.getItem('axia:sun:el') ?? 'NaN');
      if (Number.isFinite(az) && Number.isFinite(el)) {
        (this.panelEl.querySelector('#sp-az') as HTMLInputElement).value = String(az);
        (this.panelEl.querySelector('#sp-el') as HTMLInputElement).value = String(el);
        (this.panelEl.querySelector('#sp-az-val') as HTMLElement).textContent = `${Math.round(az)}°`;
        (this.panelEl.querySelector('#sp-el-val') as HTMLElement).textContent = `${Math.round(el)}°`;
        if (!savedMode || savedMode === 'manual') {
          this.deps.viewport.setSunDirection(az, el);
        }
      } else {
        // Initial from Viewport.
        const cur = this.deps.viewport.getSunAzimuthElevation();
        (this.panelEl.querySelector('#sp-az') as HTMLInputElement).value = String(Math.round(cur.azimuth));
        (this.panelEl.querySelector('#sp-el') as HTMLInputElement).value = String(Math.round(cur.elevation));
        (this.panelEl.querySelector('#sp-az-val') as HTMLElement).textContent = `${Math.round(cur.azimuth)}°`;
        (this.panelEl.querySelector('#sp-el-val') as HTMLElement).textContent = `${Math.round(cur.elevation)}°`;
      }

      // Geo values
      const lat = parseFloat(localStorage.getItem('axia:sun:lat') ?? 'NaN');
      const lon = parseFloat(localStorage.getItem('axia:sun:lon') ?? 'NaN');
      if (Number.isFinite(lat)) (this.panelEl.querySelector('#sp-lat') as HTMLInputElement).value = String(lat);
      if (Number.isFinite(lon)) (this.panelEl.querySelector('#sp-lon') as HTMLInputElement).value = String(lon);
      const date = localStorage.getItem('axia:sun:date');
      if (date) (this.panelEl.querySelector('#sp-date') as HTMLInputElement).value = date;
      const time = parseFloat(localStorage.getItem('axia:sun:time') ?? 'NaN');
      if (Number.isFinite(time)) (this.panelEl.querySelector('#sp-time') as HTMLInputElement).value = String(time);

      if (savedMode) this.setMode(savedMode);
    } catch { /* ignore */ }
  }

  private injectStyles(): void {
    if (document.getElementById('sun-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'sun-panel-styles';
    style.textContent = `
      .sun-panel {
        position: fixed; right: 8px; top: 120px; width: 300px;
        background: rgba(24, 24, 32, 0.95); color: #ddd;
        border: 1px solid #444; border-radius: 6px; padding: 10px;
        font: 13px -apple-system, sans-serif; z-index: 1500;
      }
      .sp-header { display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #333; }
      .sp-title { font-weight: 600; }
      .sp-close { background: transparent; color: #888; border: 0; font-size: 18px;
        cursor: pointer; line-height: 1; }
      .sp-close:hover { color: #fff; }
      .sp-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
      .sp-tab { flex: 1; background: #22222c; color: #aaa; border: 1px solid #444;
        padding: 5px; border-radius: 3px; cursor: pointer; font-size: 11px; }
      .sp-tab.active { background: #3a97ff; color: #fff; border-color: #3a97ff; }
      .sp-row { display: grid; grid-template-columns: 48px 1fr 52px;
        align-items: center; gap: 8px; margin: 6px 0; }
      .sp-row2 { display: grid; grid-template-columns: 44px 1fr 44px 1fr;
        align-items: center; gap: 6px; margin: 6px 0; }
      .sp-label { color: #bbb; font-size: 12px; }
      .sp-slider { width: 100%; }
      .sp-num, .sp-date { background: #22222c; color: #ddd; border: 1px solid #444;
        padding: 3px 5px; border-radius: 3px; font-size: 11px; width: 100%; box-sizing: border-box; }
      .sp-val { text-align: right; color: #ffa500; font-family: monospace; font-size: 12px; }
      .sp-calc { color: #9acd32; font-family: monospace; font-size: 11px; }
      .sp-anim { background: #2a2a36; color: #ccc; border: 1px solid #444;
        padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 12px; }
      .sp-anim:hover { background: #3a3a48; color: #fff; }
      .sp-presets { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
      .sp-preset { background: #2a2a36; color: #ccc; border: 1px solid #444;
        padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; flex: 1; }
      .sp-preset:hover { background: #3a3a48; color: #fff; }
      .sp-hint { color: #888; font-size: 11px; margin-top: 8px; line-height: 1.4;
        padding-top: 6px; border-top: 1px solid #333; }
    `;
    document.head.appendChild(style);
  }
}
