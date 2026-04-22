/**
 * SunPanel — 태양 방향 제어 UI (Phase 2).
 *
 * SketchUp "Shadows Panel" 유사. 현재 MVP:
 *   · Azimuth 슬라이더 0~360° (북=0°, 시계방향)
 *   · Elevation 슬라이더 1~89° (수평선→천정)
 *   · 프리셋 버튼 (아침 9시 / 정오 / 오후 3시 / 석양 풍 각도)
 *
 * 지리 좌표 기반(위도·경도·날짜·시간) 모드는 Phase 3.
 *
 * 위치: 우측 상단 floating panel, 토글 방식 (View 메뉴 또는 Shift+U 단축키).
 * 슬라이더 드래그 중 매 input마다 Viewport.setSunDirection 호출 +
 * syncMesh로 projected shadow 재계산.
 */

import type { Viewport } from '../viewport/Viewport';

export interface SunPanelDeps {
  viewport: Viewport;
  /** Sun 변경 후 projected shadow + VSM이 새 direction 반영되도록 trigger. */
  onSunChange: () => void;
}

export class SunPanel {
  private container: HTMLElement;
  private deps: SunPanelDeps;
  private panelEl: HTMLElement;
  private visible = false;

  // 건축 preset — elevation 값은 서울 기준 한여름·한겨울 중간치 근처.
  private static readonly PRESETS = [
    { name: '오전 9시',  az: 120, el: 30 },
    { name: '정오',      az: 180, el: 60 },
    { name: '오후 3시',  az: 240, el: 40 },
    { name: '석양',      az: 280, el: 15 },
  ];

  constructor(container: HTMLElement, deps: SunPanelDeps) {
    this.container = container;
    this.deps = deps;

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'sun-panel';
    this.panelEl.className = 'sun-panel';
    this.panelEl.innerHTML = `
      <div class="sp-header">
        <span class="sp-title">☀️ 태양 방향</span>
        <button class="sp-close" title="닫기">×</button>
      </div>
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
      <div class="sp-hint">
        "건축 그림자 (Projected)" 토글 켜진 상태에서 변경사항 즉시 반영
      </div>
    `;
    this.panelEl.style.display = 'none';
    container.appendChild(this.panelEl);

    this.injectStyles();
    this.bindEvents();

    // 초기값은 Viewport 기존 sun 방향 반영.
    const cur = this.deps.viewport.getSunAzimuthElevation();
    this.setSliderValues(cur.azimuth, cur.elevation);
  }

  show(): void {
    this.visible = true;
    this.panelEl.style.display = 'block';
  }
  hide(): void {
    this.visible = false;
    this.panelEl.style.display = 'none';
  }
  toggle(): void { this.visible ? this.hide() : this.show(); }
  isVisible(): boolean { return this.visible; }

  dispose(): void { this.panelEl.remove(); }

  private bindEvents(): void {
    this.panelEl.querySelector('.sp-close')?.addEventListener('click', () => this.hide());

    const azSlider = this.panelEl.querySelector('#sp-az') as HTMLInputElement;
    const elSlider = this.panelEl.querySelector('#sp-el') as HTMLInputElement;

    const apply = () => {
      const az = parseFloat(azSlider.value);
      const el = parseFloat(elSlider.value);
      (this.panelEl.querySelector('#sp-az-val') as HTMLElement).textContent = `${az.toFixed(0)}°`;
      (this.panelEl.querySelector('#sp-el-val') as HTMLElement).textContent = `${el.toFixed(0)}°`;
      this.deps.viewport.setSunDirection(az, el);
      this.deps.onSunChange();
      // localStorage에 저장 — 세션 간 유지
      try {
        localStorage.setItem('axia:sun:az', String(az));
        localStorage.setItem('axia:sun:el', String(el));
      } catch { /* ignore */ }
    };

    azSlider.addEventListener('input', apply);
    elSlider.addEventListener('input', apply);

    // Preset 버튼
    this.panelEl.querySelectorAll('.sp-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx ?? '0', 10);
        const p = SunPanel.PRESETS[idx];
        if (!p) return;
        this.setSliderValues(p.az, p.el);
        apply();
      });
    });

    // 세션 시작 시 localStorage 복원
    try {
      const az = parseFloat(localStorage.getItem('axia:sun:az') ?? 'NaN');
      const el = parseFloat(localStorage.getItem('axia:sun:el') ?? 'NaN');
      if (Number.isFinite(az) && Number.isFinite(el)) {
        this.setSliderValues(az, el);
        // Viewport에도 즉시 반영 (panel 안 열어도 적용되도록)
        this.deps.viewport.setSunDirection(az, el);
      }
    } catch { /* ignore */ }
  }

  private setSliderValues(az: number, el: number): void {
    const azSlider = this.panelEl.querySelector('#sp-az') as HTMLInputElement;
    const elSlider = this.panelEl.querySelector('#sp-el') as HTMLInputElement;
    azSlider.value = String(Math.round(az));
    elSlider.value = String(Math.round(el));
    (this.panelEl.querySelector('#sp-az-val') as HTMLElement).textContent = `${Math.round(az)}°`;
    (this.panelEl.querySelector('#sp-el-val') as HTMLElement).textContent = `${Math.round(el)}°`;
  }

  private injectStyles(): void {
    if (document.getElementById('sun-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'sun-panel-styles';
    style.textContent = `
      .sun-panel {
        position: fixed; right: 8px; top: 120px; width: 280px;
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
      .sp-row { display: grid; grid-template-columns: 48px 1fr 40px;
        align-items: center; gap: 8px; margin: 6px 0; }
      .sp-label { color: #bbb; font-size: 12px; }
      .sp-slider { width: 100%; }
      .sp-val { text-align: right; color: #ffa500; font-family: monospace; font-size: 12px; }
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
