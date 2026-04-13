/**
 * AXiA 3D — Settings Panel (단위 설정 도구)
 *
 * 톱니바퀴 버튼 클릭 시 드롭다운 패널 표시
 * - 단위 선택 (mm/cm/m/in/ft)
 * - 소수점 자릿수 (0~8)
 * - 스냅 On/Off
 * - 스냅 간격
 */

import { UnitSystem, UnitType } from './UnitSystem';

export class SettingsPanel {
  private panel: HTMLElement;
  private isOpen = false;

  constructor(private units: UnitSystem) {
    this.panel = this.createPanel();
    document.body.appendChild(this.panel);

    // 패널 밖 클릭 시 닫기
    document.addEventListener('mousedown', (e) => {
      if (this.isOpen &&
          !this.panel.contains(e.target as Node) &&
          !(e.target as HTMLElement).closest('#settings-btn')) {
        this.close();
      }
    });

    // 단위 변경 시 UI 갱신
    units.onChange(() => this.updateDisplay());
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.updateDisplay();
    this.panel.style.display = 'block';
    this.isOpen = true;
  }

  close() {
    this.panel.style.display = 'none';
    this.isOpen = false;
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    panel.innerHTML = `
      <div class="sp-header">단위 설정</div>

      <div class="sp-section">
        <label class="sp-label">단위</label>
        <div class="sp-unit-btns" id="sp-unit-btns"></div>
      </div>

      <div class="sp-section">
        <label class="sp-label">소수점 자릿수</label>
        <div class="sp-row">
          <input type="range" id="sp-precision" min="0" max="8" step="1" />
          <span id="sp-precision-val" class="sp-value"></span>
        </div>
      </div>

      <div class="sp-divider"></div>

      <div class="sp-section">
        <label class="sp-label">
          <input type="checkbox" id="sp-snap" />
          그리드 스냅
        </label>
      </div>

      <div class="sp-section">
        <label class="sp-label">스냅 간격</label>
        <div class="sp-row">
          <input type="number" id="sp-snap-interval" step="0.1" min="0.0001" />
          <span id="sp-snap-unit" class="sp-value"></span>
        </div>
      </div>

      <div class="sp-divider"></div>
      <div class="sp-info" id="sp-info"></div>
    `;

    // 단위 버튼 생성
    const btnContainer = panel.querySelector('#sp-unit-btns')!;
    for (const cfg of UnitSystem.allUnits) {
      const btn = document.createElement('button');
      btn.className = 'sp-ubtn';
      btn.dataset.unit = cfg.type;
      btn.textContent = cfg.label;
      btn.title = cfg.labelLong;
      btn.addEventListener('click', () => {
        this.units.unit = cfg.type as UnitType;
      });
      btnContainer.appendChild(btn);
    }

    // 소수점 슬라이더
    const precSlider = panel.querySelector('#sp-precision') as HTMLInputElement;
    precSlider.addEventListener('input', () => {
      this.units.precision = parseInt(precSlider.value);
    });

    // 스냅 체크박스
    const snapCheck = panel.querySelector('#sp-snap') as HTMLInputElement;
    snapCheck.addEventListener('change', () => {
      this.units.gridSnap = snapCheck.checked;
    });

    // 스냅 간격
    const snapInput = panel.querySelector('#sp-snap-interval') as HTMLInputElement;
    snapInput.addEventListener('change', () => {
      const val = parseFloat(snapInput.value);
      if (!isNaN(val) && val > 0) {
        this.units.snapInterval = this.units.toInternal(val);
      }
    });

    return panel;
  }

  private updateDisplay() {
    // 단위 버튼 활성화
    this.panel.querySelectorAll('.sp-ubtn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.unit === this.units.unit);
    });

    // 소수점
    const precSlider = this.panel.querySelector('#sp-precision') as HTMLInputElement;
    const precVal = this.panel.querySelector('#sp-precision-val')!;
    precSlider.value = String(this.units.precision);
    precVal.textContent = String(this.units.precision);

    // 스냅
    const snapCheck = this.panel.querySelector('#sp-snap') as HTMLInputElement;
    snapCheck.checked = this.units.gridSnap;

    // 스냅 간격 (현재 단위로 표시)
    const snapInput = this.panel.querySelector('#sp-snap-interval') as HTMLInputElement;
    const snapUnit = this.panel.querySelector('#sp-snap-unit')!;
    snapInput.value = this.units.fromInternal(this.units.snapInterval).toFixed(this.units.precision);
    snapUnit.textContent = this.units.config.label;

    // 정보
    const info = this.panel.querySelector('#sp-info')!;
    info.textContent = `1 ${this.units.config.label} = ${this.units.config.toMM} mm`;
  }
}
