/**
 * Material Properties Panel — 재질 속성 편집 UI
 *
 * 스크린샷 형식: 일반/물리/시각 속성 섹션별 표시
 */

import { Material, MaterialCategory, FireRating, TextureInfo, AuxTextureInfo } from '../materials/MaterialLibrary';
import { Toast } from './Toast';

/** 최대 텍스처 파일 크기 (base64 인코딩 후 AXIA 파일 크기 고려) */
const MAX_TEXTURE_BYTES = 4 * 1024 * 1024; // 4MB

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

      <!-- 텍스처 섹션 -->
      <div class="mat-panel-section">
        <div class="mat-panel-title">텍스처</div>
        ${this.renderTextureSection(m.visual.texture)}
      </div>

      <!-- PBR 보조 채널 (Normal / Roughness) -->
      <div class="mat-panel-section">
        <div class="mat-panel-title">PBR 보조 채널</div>
        ${this.renderAuxSection(m.visual.aux)}
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

    // 텍스처 섹션 전용 리스너
    this.attachTextureListeners();
    // PBR 보조 채널 리스너
    this.attachAuxListeners();
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
        newMaterial[field as 'name' | 'nameEn' | 'category'] = target.value as string & MaterialCategory;
      } else if (['density', 'friction', 'restitution', 'specificGravity', 'thermalConductivity'].includes(field)) {
        const numValue = parseFloat((target as HTMLInputElement).value);
        newMaterial.physical = { ...newMaterial.physical, [field]: numValue };
      } else if (field === 'fireRating') {
        newMaterial.physical = { ...newMaterial.physical, fireRating: target.value as FireRating };
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

  // ═══════════════════════════════════════════════════
  //  Texture section
  // ═══════════════════════════════════════════════════

  /** 텍스처 섹션 HTML 생성 */
  private renderTextureSection(tex?: TextureInfo): string {
    const hasTexture = !!tex;
    const preview = hasTexture
      ? `<img class="mat-tex-preview" src="${tex!.dataUrl}" alt="${tex!.label ?? 'texture'}">`
      : `<div class="mat-tex-placeholder">없음</div>`;
    const label = tex?.label ?? '—';
    const scale = tex?.scale ?? 0.001;
    const rotation = tex?.rotation ?? 0;
    const projection = tex?.projection ?? 'planar';

    return `
      <div class="mat-panel-row mat-tex-row">
        <label>이미지</label>
        <div class="mat-tex-slot">
          ${preview}
          <div class="mat-tex-label">${label}</div>
          <div class="mat-tex-actions">
            <button type="button" class="mat-tex-load">불러오기</button>
            ${hasTexture ? `<button type="button" class="mat-tex-remove">제거</button>` : ''}
          </div>
          <input type="file" class="mat-tex-file" accept="image/png,image/jpeg,image/webp" style="display:none">
        </div>
      </div>
      ${hasTexture ? `
        <div class="mat-panel-row">
          <label>투영</label>
          <select class="mat-select" data-field="tex-projection">
            <option value="planar" ${projection === 'planar' ? 'selected' : ''}>평면 (Planar)</option>
            <option value="box" ${projection === 'box' ? 'selected' : ''}>박스 (Box)</option>
            <option value="cylindrical" ${projection === 'cylindrical' ? 'selected' : ''}>원통 (Cylindrical)</option>
          </select>
        </div>
        <div class="mat-panel-row">
          <label>스케일</label>
          <div class="mat-input-unit">
            <input type="number" class="mat-input" data-field="tex-scale"
              value="${scale}" step="0.0005" min="0.0001" max="1">
            <span class="mat-unit">tiles/mm</span>
          </div>
        </div>
        <div class="mat-panel-row">
          <label>회전</label>
          <div class="mat-input-unit">
            <input type="range" class="mat-input-slider" data-field="tex-rotation"
              value="${rotation}" step="0.0873" min="0" max="6.2832">
            <span class="mat-value">${(rotation * 180 / Math.PI).toFixed(0)}°</span>
          </div>
        </div>
      ` : ''}
    `;
  }

  /** 텍스처 섹션 이벤트 리스너 — render 뒤 attachEventListeners에서 호출 */
  private attachTextureListeners(): void {
    const loadBtn = this.container.querySelector('.mat-tex-load') as HTMLButtonElement | null;
    const fileInput = this.container.querySelector('.mat-tex-file') as HTMLInputElement | null;
    const removeBtn = this.container.querySelector('.mat-tex-remove') as HTMLButtonElement | null;
    const projSel = this.container.querySelector('[data-field="tex-projection"]') as HTMLSelectElement | null;
    const scaleInput = this.container.querySelector('[data-field="tex-scale"]') as HTMLInputElement | null;
    const rotInput = this.container.querySelector('[data-field="tex-rotation"]') as HTMLInputElement | null;

    if (loadBtn && fileInput) {
      loadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => this.handleTextureFile(fileInput));
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', () => this.updateTexture(undefined));
    }

    if (projSel) {
      projSel.addEventListener('change', () => {
        const cur = this.material?.visual.texture;
        if (!cur) return;
        this.updateTexture({ ...cur, projection: projSel.value as TextureInfo['projection'] });
      });
    }

    if (scaleInput) {
      scaleInput.addEventListener('change', () => {
        const cur = this.material?.visual.texture;
        if (!cur) return;
        const v = parseFloat(scaleInput.value);
        if (!Number.isFinite(v) || v <= 0) return;
        this.updateTexture({ ...cur, scale: v });
      });
    }

    if (rotInput) {
      rotInput.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const span = target.closest('.mat-input-unit')?.querySelector('.mat-value');
        if (span) span.textContent = `${(parseFloat(target.value) * 180 / Math.PI).toFixed(0)}°`;
      });
      rotInput.addEventListener('change', () => {
        const cur = this.material?.visual.texture;
        if (!cur) return;
        this.updateTexture({ ...cur, rotation: parseFloat(rotInput.value) });
      });
    }
  }

  /** 파일 입력에서 이미지를 읽어 data URL로 변환 후 texture 업데이트 */
  private handleTextureFile(input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > MAX_TEXTURE_BYTES) {
      Toast.warning(`텍스처 파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB > 4MB)`);
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (typeof dataUrl !== 'string') {
        Toast.error('텍스처를 읽을 수 없습니다');
        return;
      }
      const prev = this.material?.visual.texture;
      const tex: TextureInfo = {
        dataUrl,
        projection: prev?.projection ?? 'planar',
        scale: prev?.scale ?? 0.001,
        rotation: prev?.rotation ?? 0,
        label: file.name,
      };
      this.updateTexture(tex);
      Toast.info(`텍스처 로드: ${file.name}`);
    };
    reader.onerror = () => Toast.error('텍스처 로드 실패');
    reader.readAsDataURL(file);
    // 같은 파일 다시 선택 가능하도록 초기화
    input.value = '';
  }

  // ═══════════════════════════════════════════════════
  //  Aux PBR section (Normal / Roughness map)
  //  ADR-007 도구는 wall/sheet 무관하게 동일 적용. 2026-04-26 추가.
  // ═══════════════════════════════════════════════════

  private renderAuxSection(aux?: AuxTextureInfo): string {
    const normal = aux?.normal;
    const roughness = aux?.roughness;
    const intensity = aux?.normalIntensity ?? 1.0;

    const slot = (label: string, kind: 'normal' | 'roughness', tex?: TextureInfo) => {
      const has = !!tex;
      const preview = has
        ? `<img class="mat-tex-preview" src="${tex!.dataUrl}" alt="${tex!.label ?? label}">`
        : `<div class="mat-tex-placeholder">없음</div>`;
      return `
        <div class="mat-panel-row mat-tex-row">
          <label>${label}</label>
          <div class="mat-tex-slot">
            ${preview}
            <div class="mat-tex-label">${tex?.label ?? '—'}</div>
            <div class="mat-tex-actions">
              <button type="button" class="mat-aux-load" data-kind="${kind}">불러오기</button>
              ${has ? `<button type="button" class="mat-aux-remove" data-kind="${kind}">제거</button>` : ''}
            </div>
            <input type="file" class="mat-aux-file" data-kind="${kind}" accept="image/png,image/jpeg,image/webp" style="display:none">
          </div>
        </div>
      `;
    };

    return `
      ${slot('Normal Map', 'normal', normal)}
      ${normal ? `
        <div class="mat-panel-row">
          <label>강도</label>
          <div class="mat-input-unit">
            <input type="range" class="mat-input-slider" data-field="aux-normal-intensity"
              value="${intensity}" step="0.05" min="0" max="3">
            <span class="mat-value">${intensity.toFixed(2)}</span>
          </div>
        </div>
      ` : ''}
      ${slot('Roughness Map', 'roughness', roughness)}
    `;
  }

  /** 보조 PBR 채널 listeners — render 뒤 attachEventListeners 끝에서 호출 */
  private attachAuxListeners(): void {
    this.container.querySelectorAll<HTMLButtonElement>('.mat-aux-load').forEach(btn => {
      const kind = btn.dataset.kind as 'normal' | 'roughness';
      const fileInput = this.container.querySelector<HTMLInputElement>(`.mat-aux-file[data-kind="${kind}"]`);
      if (!fileInput) return;
      btn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => this.handleAuxFile(fileInput, kind));
    });
    this.container.querySelectorAll<HTMLButtonElement>('.mat-aux-remove').forEach(btn => {
      const kind = btn.dataset.kind as 'normal' | 'roughness';
      btn.addEventListener('click', () => this.updateAux(kind, undefined));
    });
    const intensitySlider = this.container.querySelector<HTMLInputElement>('[data-field="aux-normal-intensity"]');
    if (intensitySlider) {
      intensitySlider.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const span = target.closest('.mat-input-unit')?.querySelector('.mat-value');
        if (span) span.textContent = parseFloat(target.value).toFixed(2);
      });
      intensitySlider.addEventListener('change', () => {
        if (!this.material) return;
        const v = parseFloat(intensitySlider.value);
        const aux: AuxTextureInfo = { ...(this.material.visual.aux ?? {}), normalIntensity: v };
        this.material = {
          ...this.material,
          visual: { ...this.material.visual, aux },
        };
        if (this.onPropertyChange) this.onPropertyChange(this.material);
      });
    }
  }

  private handleAuxFile(input: HTMLInputElement, kind: 'normal' | 'roughness'): void {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_TEXTURE_BYTES) {
      Toast.warning(`텍스처 파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB > 4MB)`);
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (typeof dataUrl !== 'string') {
        Toast.error('텍스처를 읽을 수 없습니다');
        return;
      }
      this.updateAux(kind, {
        dataUrl,
        projection: 'planar',
        scale: this.material?.visual.texture?.scale ?? 0.001,
        rotation: 0,
        label: file.name,
      });
      Toast.info(`${kind === 'normal' ? 'Normal' : 'Roughness'} map 로드: ${file.name}`);
    };
    reader.onerror = () => Toast.error('텍스처 로드 실패');
    reader.readAsDataURL(file);
    input.value = '';
  }

  private updateAux(kind: 'normal' | 'roughness', tex: TextureInfo | undefined): void {
    if (!this.material) return;
    const cur: AuxTextureInfo = { ...(this.material.visual.aux ?? {}) };
    if (kind === 'normal') cur.normal = tex;
    else cur.roughness = tex;
    // Empty aux object → store undefined for clean serialization.
    const empty = !cur.normal && !cur.roughness;
    const newMaterial: Material = {
      ...this.material,
      visual: { ...this.material.visual, aux: empty ? undefined : cur },
    };
    this.material = newMaterial;
    if (this.onPropertyChange) this.onPropertyChange(newMaterial);
    this.render();
  }

  /** 텍스처 업데이트 후 material 전파 + 리렌더 */
  private updateTexture(tex: TextureInfo | undefined): void {
    if (!this.material) return;
    const newMaterial: Material = {
      ...this.material,
      visual: { ...this.material.visual, texture: tex },
    };
    this.material = newMaterial;
    if (this.onPropertyChange) this.onPropertyChange(newMaterial);
    // 현재 패널을 새 상태로 다시 그려 UI 반영 (placeholder ↔ 프리뷰 전환)
    this.render();
  }
}
