/**
 * AXiA 3D — Dimension Label Overlay
 *
 * 3D 공간의 치수를 화면에 예쁘게 표시하는 오버레이 레이블.
 * - Rect: 가로 x 세로
 * - Push/Pull: 높이(거리)
 * - Line: 길이
 * - Circle: 반지름
 *
 * 3D 월드 좌표를 스크린 좌표로 변환하여 HTML 레이블로 표시.
 */

import * as THREE from 'three';

export interface DimLine {
  /** 3D 시작점 */
  from: THREE.Vector3;
  /** 3D 끝점 */
  to: THREE.Vector3;
  /** 표시 텍스트 (포매팅된 치수) */
  text: string;
  /** 색상 (CSS) */
  color?: string;
  /** If true, this label can be clicked to edit the value */
  editable?: boolean;
}

/** Callback when a dimension value is edited */
export type DimEditCallback = (index: number, newValue: number, dimLine: DimLine) => void;

export class DimensionLabel {
  private container: HTMLElement;
  private overlay: HTMLElement;
  private labels: HTMLElement[] = [];
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // ═══ Inline Edit State ═══
  private editInput: HTMLInputElement | null = null;
  private editingIndex: number = -1;
  private _onEdit: DimEditCallback | null = null;
  private _currentLines: DimLine[] = [];

  constructor(container: HTMLElement) {
    this.container = container;

    // 오버레이 컨테이너 (HTML 레이블용)
    this.overlay = document.createElement('div');
    this.overlay.id = 'dim-overlay';
    this.overlay.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; z-index: 200; overflow: hidden;
    `;
    container.appendChild(this.overlay);

    // 치수선 캔버스 (보조선 그리기용)
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'dim-canvas';
    this.canvas.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; z-index: 199;
    `;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // 리사이즈 대응
    const ro = new ResizeObserver(() => {
      this.canvas.width = container.clientWidth * window.devicePixelRatio;
      this.canvas.height = container.clientHeight * window.devicePixelRatio;
      this.canvas.style.width = container.clientWidth + 'px';
      this.canvas.style.height = container.clientHeight + 'px';
      this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    });
    ro.observe(container);
  }

  /** Register callback for when a dimension value is edited */
  set onEdit(cb: DimEditCallback | null) {
    this._onEdit = cb;
  }

  /** Whether an inline edit is currently active */
  get isEditing(): boolean {
    return this.editingIndex >= 0;
  }

  /**
   * 치수 라인들 업데이트 (매 프레임 호출)
   */
  update(camera: THREE.Camera, lines: DimLine[]) {
    // Don't update layout while editing (keeps the input stable)
    if (this.isEditing) return;

    this._currentLines = lines;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    // 캔버스 클리어
    this.ctx.save();
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    this.ctx.clearRect(0, 0, w, h);

    // 기존 라벨 정리
    while (this.labels.length > lines.length) {
      const el = this.labels.pop()!;
      this.overlay.removeChild(el);
    }
    // 라벨 부족하면 추가
    while (this.labels.length < lines.length) {
      const el = document.createElement('div');
      el.className = 'dim-label';
      this.overlay.appendChild(el);
      this.labels.push(el);
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const label = this.labels[i];
      const color = line.color || '#4ac1ff';

      // 3D → 스크린 변환
      const screenFrom = this.toScreen(line.from, camera, w, h);
      const screenTo = this.toScreen(line.to, camera, w, h);

      if (!screenFrom || !screenTo) {
        label.style.display = 'none';
        continue;
      }

      // 치수선 그리기
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 1.5;
      this.ctx.setLineDash([4, 3]);
      this.ctx.beginPath();
      this.ctx.moveTo(screenFrom.x, screenFrom.y);
      this.ctx.lineTo(screenTo.x, screenTo.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      // 양쪽 끝 작은 다이아몬드
      this.drawEndpoint(screenFrom.x, screenFrom.y, color);
      this.drawEndpoint(screenTo.x, screenTo.y, color);

      // 선의 방향 및 각도 계산
      const dx = screenTo.x - screenFrom.x;
      const dy = screenTo.y - screenFrom.y;
      const len = Math.sqrt(dx * dx + dy * dy);

      // 선과 평행한 각도 (라디안)
      let angle = Math.atan2(dy, dx);
      // 텍스트가 뒤집히지 않도록 -90°~90° 범위로 보정
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;

      // 법선 방향으로 약간 오프셋 (선 위에 겹치지 않게)
      const nx = len > 0 ? -dy / len : 0;
      const ny = len > 0 ? dx / len : -1;
      const offset = 14;

      const mx = (screenFrom.x + screenTo.x) / 2 + nx * offset;
      const my = (screenFrom.y + screenTo.y) / 2 + ny * offset;

      label.textContent = line.text;
      label.style.display = 'block';
      label.style.left = mx + 'px';
      label.style.top = my + 'px';
      label.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
      label.style.setProperty('--dim-color', color);

      // Editable labels get pointer-events and click handler
      if (line.editable && this._onEdit) {
        label.style.pointerEvents = 'auto';
        label.style.cursor = 'pointer';
        label.title = '클릭하여 치수 편집';
        const idx = i;
        label.onmousedown = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          this.startEdit(idx);
        };
      } else {
        label.style.pointerEvents = 'none';
        label.style.cursor = '';
        label.title = '';
        label.onmousedown = null;
      }
    }

    this.ctx.restore();
  }

  /**
   * 단일 값 표시 (마우스 근처에 표시, Push/Pull 등)
   */
  showAtCursor(camera: THREE.Camera, worldPos: THREE.Vector3, text: string, color = '#4ac1ff') {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.ctx.save();
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.restore();

    // 라벨 1개만
    while (this.labels.length > 1) {
      const el = this.labels.pop()!;
      this.overlay.removeChild(el);
    }
    if (this.labels.length === 0) {
      const el = document.createElement('div');
      el.className = 'dim-label';
      this.overlay.appendChild(el);
      this.labels.push(el);
    }

    const screen = this.toScreen(worldPos, camera, w, h);
    if (!screen) {
      this.labels[0].style.display = 'none';
      return;
    }

    this.labels[0].textContent = text;
    this.labels[0].style.display = 'block';
    this.labels[0].style.left = (screen.x + 20) + 'px';
    this.labels[0].style.top = (screen.y - 14) + 'px';
    this.labels[0].style.setProperty('--dim-color', color);
  }

  /**
   * 마우스 스크린 좌표 근처에 값 표시
   */
  showAtScreen(screenX: number, screenY: number, text: string, color = '#4ac1ff') {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.ctx.save();
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.restore();

    while (this.labels.length > 1) {
      const el = this.labels.pop()!;
      this.overlay.removeChild(el);
    }
    if (this.labels.length === 0) {
      const el = document.createElement('div');
      el.className = 'dim-label';
      this.overlay.appendChild(el);
      this.labels.push(el);
    }

    // 화면 밖으로 나가지 않도록
    const lx = Math.min(screenX + 20, w - 120);
    const ly = Math.max(screenY - 14, 10);

    this.labels[0].textContent = text;
    this.labels[0].style.display = 'block';
    this.labels[0].style.left = lx + 'px';
    this.labels[0].style.top = ly + 'px';
    this.labels[0].style.setProperty('--dim-color', color);
  }

  // ═══════════════════════════════════════════════════
  //  Inline Dimension Edit
  // ═══════════════════════════════════════════════════

  /** Start inline editing of a dimension label */
  private startEdit(index: number): void {
    if (index < 0 || index >= this.labels.length || index >= this._currentLines.length) return;
    this.cancelEdit(); // Close any previous edit

    this.editingIndex = index;
    const label = this.labels[index];
    const line = this._currentLines[index];

    // Get the label's position
    const left = parseFloat(label.style.left) || 0;
    const top = parseFloat(label.style.top) || 0;

    // Create inline input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dim-edit-input';
    // Extract numeric value from formatted text (e.g. "1,234.56 mm" → "1234.56")
    const rawLength = line.from.distanceTo(line.to);
    // Show empty input with placeholder = current value (user types new value directly)
    input.value = '';
    input.placeholder = rawLength.toFixed(1);
    input.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      transform: translate(-50%, -50%);
      width: 90px;
      padding: 2px 6px;
      font-size: 12px;
      font-family: 'Segoe UI', sans-serif;
      font-weight: 600;
      text-align: center;
      color: #fff;
      background: rgba(30, 30, 50, 0.95);
      border: 2px solid ${line.color || '#4ac1ff'};
      border-radius: 4px;
      outline: none;
      z-index: 210;
      pointer-events: auto;
    `;
    this.overlay.appendChild(input);
    this.editInput = input;

    // Hide the label text while editing
    label.style.display = 'none';

    // Focus and select
    input.focus();
    input.select();

    // Event handlers
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        this.commitEdit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.cancelEdit();
      }
    });

    input.addEventListener('blur', () => {
      // Small delay to allow click-to-commit patterns
      setTimeout(() => {
        if (this.editInput === input) {
          this.cancelEdit();
        }
      }, 150);
    });
  }

  /** Commit the edited value */
  private commitEdit(): void {
    if (this.editingIndex < 0 || !this.editInput) return;

    const raw = this.editInput.value.trim();
    if (!raw) {
      // Empty input → cancel (no change)
      this.cancelEdit();
      return;
    }
    const newValue = parseFloat(raw);
    if (isNaN(newValue) || newValue <= 0) {
      this.cancelEdit();
      return;
    }

    const idx = this.editingIndex;
    const dimLine = this._currentLines[idx];
    this.removeEditInput();
    this.editingIndex = -1;

    // Fire callback
    if (this._onEdit && dimLine) {
      this._onEdit(idx, newValue, dimLine);
    }
  }

  /** Cancel editing without applying */
  cancelEdit(): void {
    this.removeEditInput();
    this.editingIndex = -1;
  }

  private removeEditInput(): void {
    if (this.editInput) {
      this.editInput.remove();
      this.editInput = null;
    }
  }

  /** 모든 치수 표시 숨기기 */
  clear() {
    this.cancelEdit();
    for (const el of this.labels) {
      el.style.display = 'none';
    }
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.ctx.save();
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.restore();
  }

  /** 3D → 스크린 좌표 변환 */
  private toScreen(
    pos: THREE.Vector3, camera: THREE.Camera, w: number, h: number,
  ): { x: number; y: number } | null {
    const v = pos.clone().project(camera);
    if (v.z < -1 || v.z > 1) return null; // 카메라 뒤
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
    };
  }

  /** 끝점 마커 (작은 다이아몬드) */
  private drawEndpoint(x: number, y: number, color: string) {
    const s = 3;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y - s);
    this.ctx.lineTo(x + s, y);
    this.ctx.lineTo(x, y + s);
    this.ctx.lineTo(x - s, y);
    this.ctx.closePath();
    this.ctx.fill();
  }
}
