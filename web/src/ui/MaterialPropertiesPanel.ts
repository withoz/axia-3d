/**
 * Material Properties Panel — 재질 속성 편집 UI
 *
 * 스크린샷 형식: 일반/물리/시각 속성 섹션별 표시
 */

import { Material, PhysicalProperties, VisualProperties, MaterialCategory } from '../materials/MaterialLibrary';
import { Toast } from './Toast';

export class MaterialPropertiesPanel {
  private container: HTMLElement;
  private material: Material | null = null;
  private onPropertyChange: ((material: Material) => void) | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container ${containerId} not found`);
    this.container = el;
    this.container.className = 'material-properties-panel';
  }

  /** 특정 재질의 속성 표시 */
  showMaterial(material: Material, onPropertyChange?: (material: Material) => void): void {
    this.material = material;
    this.onPropertyChange = onPropertyChange || null;
    this.render();
  }

  /** 속성 패널 숨김 */
  hide(): void {
    this.material = null;
    this.container.innerHTML = '';
  }

  /** UI 렌더링 */
  private render(): void {
    if (!this.material) {
      this.container.innerHTML = '';
      return;
    }

    const m = this.material;
    const html = `
      <div class="mat-panel-header">
        <h3>${m.name}</h3>
        <span class="mat-panel-built-in">${m.builtIn ? '내장' : '사용자정의'}</span>
      </div>

      <!-- 일반 섹션 -->
      <div class="mat-panel-section">
        <div class="mat-panel-title">일반</div>
        <div class="mat-panel-row">
          <label>이름</label>
          <input type="text" class="mat-input" data-field="name" value="${m.name}" placeholder="재질 이름">
        </div>
        <div class="mat-panel-row">
          <label>영문명</label>
          <input type="text" class="mat-input" data-field="nameEn" value="${m.nameEn}" placeholder="Material name">
        </div>
        <div class="mat-panel-row">
          <label>카테고리</label>
          <select class="mat-select" data-field="category">
            <option value="concrete" ${m.category === 'concrete' ? 'selected' : ''}>콘크리트</option>
            <option value="metal" ${m.category === 'metal' ? 'selected' : ''}>금속</option>
            <option value="wood" ${m.category === 'wood' ? 'selected' : ''}>목재</option>
            <option value="glass" ${m.category === 'glass' ? 'selected' : ''}>유리</option>
            <option value="stone" ${m.category === 'stone' ? 'selected' : ''}>석재</option>
            <option value="insulation" ${m.category === 'insulation' ? 'selected' : ''}>단열</option>
            <option value="composite" ${m.category === 'composite' ? 'selected' : ''}>복합</option>
            <option value="custom" ${m.category === 'custom' ? 'selected' : ''}>기타</option>
          </select>
        </div>
      </div>

      <!-- 물리 섹션 -->
      <div class="mat-panel-section">
        <div class="mat-panel-title">물리</div>
        <div class="mat-panel-row">
          <label>밀도</label>
          <div class="mat-input-unit">
            <input type="number" class="mat-input-number" data-field="density"
              value="${m.physical.density}" step="10" min="0">
            <span class="mat-unit">kg/m³</span>
          </div>
        </div>
        <div class="mat-panel-row">
          <label>마찰계수</label>
          <div class="mat-input-unit">
            <input type="number" class="mat-input-number" data-field="friction"
              value="${m.physical.friction.toFixed(2)}" step="0.1" min="0" max="1">
            <span class="mat-unit">(0~1)</span>
          </div>
        </div>
        <div class="mat-panel-row">
          <label>탄성계수</label>
          <div class="mat-input-unit">
            <input type="number" class="mat-input-number" data-field="restitution"
              value="${m.physical.restitution.toFixed(2)}" step="0.1" min="0" max="1">
            <span class="mat-unit">(0~1)</span>
          </div>
        </div>
        <div class="mat-panel-row">
          <label>비중</label>
          <div class="mat-input-unit">
            <input type="number" class="mat-input-number" data-field="specificGravity"
              value="${m.physical.specificGravity.toFixed(2)}" step="0.1" min="0">
            <span class="mat-unit">상대밀도</span>
          </div>
        </div>
        <div class="mat-panel-row">
          <label>열관류율</label>
          <div class="mat-input-unit">
            <input type="number" class="mat-input-number" data-field="thermalConductivity"
              value="${m.physical.thermalConductivity.toFixed(2)}" step="0.1" min="0">
            <span class="mat-unit">W/(m·K)</span>
          </div>
        </div>
        <div class="mat-panel-row">
          <label>방화등급</label>
          <select class="mat-select" data-field="fireRating">
            <option value="incombustible" ${m.physical.fireRating === 'incombustible' ? 'selected' : ''}>불연</option>
            <option value="semi" ${m.physical.fireRating === 'semi' ? 'selected' : ''}>준불연</option>
            <option value="retardant" ${m.physical.fireRating === 'retardant' ? 'selected' : ''}>난연</option>
          </select>
        </div>
      </div>

      <!-- 시각 섹션 -->
      <div class="mat-panel-section">
        <div class="mat-panel-title">시각</div>
        <div class="mat-panel-row">
          <label>색상</label>
          <div class="mat-color-picker">
            <input type="color" class="mat-input-color" data-field="color"
              value="#${this.hexColor(m.visual.color)}">
            <span class="mat-color-hex">#${this.hexColor(m.visual.color).toUpperCase()}</span>
          </div>
        </div>
        <div class="mat-panel-row">
          <label>거칠기</label>
          <div class="mat-input-unit">
            <input type="range" class="mat-input-slider" data-field="roughness"
              value="${m.visual.roughness}" step="0.05" min="0" max="1">
            <span class="mat-value">${(m.visual.roughness * 100).toFixed(0)}%</span>
          </div>
        </div>
        <div class="mat-panel-row">
          <label>금속성</label>
          <div class="mat-input-unit">
            <input type="range" class="mat-input-slider" data-field="metalness"
              value="${m.visual.metalness}" step="0.05" min="0" max="1">
            <span class="mat-value">${(m.visual.metalness * 100).toFixed(0)}%</span>
          </div>
        </div>
        <div class="mat-panel-row">
          <label>투명도</label>
          <div class="mat-input-unit">
            <input type="range" class="mat-input-slider" data-field="opacity"
              value="${m.visual.opacity}" step="0.05" min="0" max="1">
            <span class="mat-value">${(m.visual.opacity * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this.attachEventListeners();
  }

  /** 이벤트 리스너 연결 */
  private attachEventListeners(): void {
    if (!this.material) return;

    // Text inputs
    this.container.querySelectorAll('input[type="text"]').forEach(el => {
      el.addEventListener('change', (evt) => this.handlePropertyChange(evt as Event));
    });

    // Number inputs
    this.container.querySelectorAll('input[type="number"]').forEach(el => {
      el.addEventListener('change', (evt) => this.handlePropertyChange(evt as Event));
    });

    // Selects
    this.container.querySelectorAll('select').forEach(el => {
      el.addEventListener('change', (evt) => this.handlePropertyChange(evt as Event));
    });

    // Color picker
    this.container.querySelectorAll('input[type="color"]').forEach(el => {
      el.addEventListener('change', (evt) => this.handlePropertyChange(evt as Event));
    });

    // Range sliders
    this.container.querySelectorAll('input[type="range"]').forEach(el => {
      el.addEventListener('input', (evt) => {
        const target = evt.target as HTMLInputElement;
        const valueSpan = target.closest('.mat-input-unit')?.querySelector('.mat-value');
        if (valueSpan) {
          valueSpan.textContent = `${(parseFloat(target.value) * 100).toFixed(0)}%`;
        }
      });
      el.addEventListener('change', (evt) => this.handlePropertyChange(evt as Event));
    });
  }

  /** 속성 변경 처리 */
  private handlePropertyChange(evt: Event): void {
    if (!this.material) return;

    const target = evt.target as HTMLInputElement | HTMLSelectElement;
    const field = target.getAttribute('data-field');
    if (!field) return;

    try {
      const newMaterial = { ...this.material };

      if (field === 'name' || field === 'nameEn' || field === 'category') {
        (newMaterial as any)[field] = target.value;
      } else if (['density', 'friction', 'restitution', 'specificGravity', 'thermalConductivity'].includes(field)) {
        const numValue = parseFloat((target as HTMLInputElement).value);
        newMaterial.physical = { ...newMaterial.physical, [field]: numValue };
      } else if (field === 'fireRating') {
        newMaterial.physical = { ...newMaterial.physical, fireRating: target.value as any };
      } else if (field === 'color') {
        const hexColor = (target as HTMLInputElement).value;
        const colorNum = parseInt(hexColor.replace('#', ''), 16);
        newMaterial.visual = { ...newMaterial.visual, color: colorNum };
      } else if (['roughness', 'metalness', 'opacity'].includes(field)) {
        const numValue = parseFloat((target as HTMLInputElement).value);
        newMaterial.visual = { ...newMaterial.visual, [field]: numValue };
      }

      this.material = newMaterial;
      if (this.onPropertyChange) {
        this.onPropertyChange(newMaterial);
      }
    } catch (err) {
      Toast.error(`속성 변경 실패: ${(err as Error).message}`);
    }
  }

  /** 색상값을 hex 문자열로 변환 */
  private hexColor(color: number): string {
    return color.toString(16).padStart(6, '0');
  }
}
