/**
 * SnapVisual — AutoCAD/ZWCAD style snap marker renderer.
 *
 * Uses a 2D Canvas overlay to draw snap markers, tooltips,
 * and extension/tracking guide lines on top of the 3D viewport.
 *
 * Marker shapes follow AutoCAD/ZWCAD conventions:
 *   ■ Endpoint (사각형)      ▲ Midpoint (삼각형)
 *   ✕ Intersection (X)       ○ Center (원형)
 *   ◇ Quadrant (다이아몬드)  ⊥ Perpendicular (직각)
 *   // Parallel (평행선)      + Insertion (십자)
 *   ···· Extension (점선)    ✕□ Apparent (X+사각형)
 *   □· Geometric (사각형+점)
 *
 * Color: Green (#00FF00) — the classic AutoCAD snap marker color
 */

import * as THREE from 'three';
import { SnapPoint, SnapType, SNAP_MARKERS } from './SnapManager';

export class SnapVisual {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private markerSize = 8;  // half-size in pixels (AutoCAD style)
  private tooltipVisible = true;

  constructor(container: HTMLElement) {
    this.container = container;

    // Create overlay canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '50';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;

    // Match canvas resolution to display
    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Update the visual display for a snap point.
   *  Call every frame or on mousemove. */
  update(snap: SnapPoint | null, camera?: THREE.Camera, _extensionEdge?: { a: THREE.Vector3; b: THREE.Vector3 }) {
    this.clear();
    if (!snap || !snap.screenPos) return;

    // screenPos is in client coordinates — convert to container-local coordinates
    const containerRect = this.container.getBoundingClientRect();
    const x = snap.screenPos.x - containerRect.left;
    const y = snap.screenPos.y - containerRect.top;
    const marker = SNAP_MARKERS[snap.type];

    if (!marker) return;

    // Draw extension guide line if applicable
    if (snap.type === 'extension' && snap.edgeRef && camera) {
      this.drawExtensionLine(snap, camera);
    }

    // A6: Guide dashed line for relational snaps (axis / parallel / perpendicular)
    if (camera && snap.guideFrom && (
      snap.type === 'axisX' || snap.type === 'axisY' || snap.type === 'axisZ' ||
      snap.type === 'parallel' || snap.type === 'perpendicular'
    )) {
      this.drawRelationalGuide(snap, camera);
    }

    // Draw marker
    this.drawMarker(snap.type, x, y, marker.color);

    // Draw tooltip (AutoCAD style — text only, no background box)
    if (this.tooltipVisible) {
      this.drawTooltip(marker.label, x, y, marker.color);
    }
  }

  /** Clear the overlay */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Toggle tooltip visibility */
  setTooltipVisible(v: boolean) { this.tooltipVisible = v; }

  /** Set marker size */
  getMarkerSize(): number { return this.markerSize; }
  setMarkerSize(size: number) { this.markerSize = size; }

  // ═══ Marker Shapes (AutoCAD/ZWCAD style) ═══

  private drawMarker(type: SnapType, x: number, y: number, color: string) {
    const ctx = this.ctx;
    const s = this.markerSize;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    switch (SNAP_MARKERS[type].shape) {
      case 'square':       this.drawSquare(x, y, s, color); break;
      case 'triangle':     this.drawTriangle(x, y, s, color); break;
      case 'x':            this.drawX(x, y, s, color); break;
      case 'circle':       this.drawCircle(x, y, s, color); break;
      case 'diamond':      this.drawDiamond(x, y, s, color); break;
      case 'perpendicular': this.drawPerpendicular(x, y, s, color); break;
      case 'parallel':     this.drawParallel(x, y, s, color); break;
      case 'dot':          this.drawDot(x, y, s, color); break;
      case 'plus':         this.drawPlus(x, y, s, color); break;
      case 'extension':    this.drawExtensionMarker(x, y, s, color); break;
      case 'apparent':     this.drawApparent(x, y, s, color); break;
      case 'geometric':    this.drawGeometric(x, y, s, color); break;
      case 'filledCircle': this.drawFilledCircle(x, y, s, color); break;
      case 'onFace':       this.drawOnFace(x, y, s, color); break;
    }
  }

  /** ⊡ On Face — 사각형 + 중앙 점 (face 평면 hit 표시) */
  private drawOnFace(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    // 회전 45° 사각형 (기존 square/geometric과 구분)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.strokeRect(-s * 0.8, -s * 0.8, s * 1.6, s * 1.6);
    ctx.restore();
    // 중심 점
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  /** ■ Endpoint — 빈 사각형 (AutoCAD 초록 사각형) */
  private drawSquare(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x - s, y - s, s * 2, s * 2);
  }

  /** ▲ Midpoint — 삼각형 (꼭짓점 위) */
  private drawTriangle(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x - s, y + s * 0.8);
    ctx.lineTo(x + s, y + s * 0.8);
    ctx.closePath();
    ctx.stroke();
  }

  /** ✕ Intersection — X 마커 */
  private drawX(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s, y + s);
    ctx.stroke();
  }

  /** ○ Center — 원형 */
  private drawCircle(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** ◇ Quadrant — 다이아몬드 */
  private drawDiamond(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
    ctx.stroke();
  }

  /** ⊥ Perpendicular — 직각 기호 */
  private drawPerpendicular(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    // L 형태 직각
    ctx.beginPath();
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x - s, y + s);
    ctx.lineTo(x + s, y + s);
    ctx.stroke();
    // 작은 직각 표시
    const sq = s * 0.4;
    ctx.beginPath();
    ctx.moveTo(x - s, y + s - sq);
    ctx.lineTo(x - s + sq, y + s - sq);
    ctx.lineTo(x - s + sq, y + s);
    ctx.stroke();
  }

  /** // Parallel — 두 줄 평행선 */
  private drawParallel(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    const offset = s * 0.3;
    ctx.beginPath();
    ctx.moveTo(x - s + offset, y - s);
    ctx.lineTo(x + s + offset, y + s);
    ctx.moveTo(x - s - offset, y - s);
    ctx.lineTo(x + s - offset, y + s);
    ctx.stroke();
  }

  /** · Node — 점 + 외곽 원 */
  private drawDot(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // 외곽 원
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** + Insertion — 십자 마커 */
  private drawPlus(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s);
    ctx.lineTo(x, y + s);
    ctx.stroke();
  }

  /** ···· Extension — 점선 십자 */
  private drawExtensionMarker(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s);
    ctx.lineTo(x, y + s);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** ✕□ Apparent Intersection — X + 사각형 */
  private drawApparent(x: number, y: number, s: number, color: string) {
    // X 먼저
    this.drawX(x, y, s * 0.65, color);
    // 외곽 사각형
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x - s, y - s, s * 2, s * 2);
  }

  /** ● Filled Circle — 루프 닫기 (녹색 채운 원) */
  private drawFilledCircle(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    // Outer glow ring
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, s + 2, 0, Math.PI * 2);
    ctx.stroke();
    // Filled inner circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  /** □· Geometric Center — 사각형 + 중심점 */
  private drawGeometric(x: number, y: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    // 중심 점
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ═══ Tooltip (AutoCAD style — 텍스트만, 배경 없음) ═══

  private drawTooltip(text: string, x: number, y: number, color: string) {
    const ctx = this.ctx;
    const fontSize = 11;
    ctx.font = `100 ${fontSize}px "Pretendard Variable", Pretendard, sans-serif`;

    // Tooltip 위치: 마커 오른쪽 아래
    const tx = x + this.markerSize + 6;
    const ty = y + this.markerSize + 14;

    // AutoCAD style — 텍스트만 (약간의 그림자 효과)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.textBaseline = 'top';
    ctx.fillText(text, tx + 1, ty + 1);  // shadow

    ctx.fillStyle = color;
    ctx.fillText(text, tx, ty);
  }

  // ═══ Extension Guide Line ═══

  private drawExtensionLine(snap: SnapPoint, camera: THREE.Camera) {
    if (!snap.edgeRef) return;

    const ctx = this.ctx;
    const containerRect = this.container.getBoundingClientRect();

    // Project edge endpoints to container-local coordinates
    const project = (v: THREE.Vector3): THREE.Vector2 | null => {
      const p = v.clone().project(camera);
      if (p.z < -1 || p.z > 1) return null;
      return new THREE.Vector2(
        (p.x * 0.5 + 0.5) * containerRect.width,
        (-p.y * 0.5 + 0.5) * containerRect.height,
      );
    };

    // Draw dashed line from nearest endpoint to snap point
    const aScreen = project(snap.edgeRef.a);
    const bScreen = project(snap.edgeRef.b);

    if (!snap.screenPos) return;

    // Convert snap screenPos (client coords) to container-local
    const snapLocal = new THREE.Vector2(
      snap.screenPos.x - containerRect.left,
      snap.screenPos.y - containerRect.top,
    );

    // Find which endpoint is closer to the snap point (extension origin)
    let origin: THREE.Vector2 | null = null;
    if (aScreen && bScreen) {
      const da = aScreen.distanceTo(snapLocal);
      const db = bScreen.distanceTo(snapLocal);
      origin = da > db ? bScreen : aScreen;
    } else {
      origin = aScreen || bScreen;
    }

    if (!origin) return;

    // Draw dashed extension line
    ctx.strokeStyle = 'rgba(255, 51, 51, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(snapLocal.x, snapLocal.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * A6: Dashed guide from `snap.guideFrom` to `snap.position` for relational
   * snaps (axis / parallel / perpendicular). Uses the marker color.
   */
  private drawRelationalGuide(snap: SnapPoint, camera: THREE.Camera) {
    if (!snap.guideFrom || !snap.screenPos) return;
    const ctx = this.ctx;
    const rect = this.container.getBoundingClientRect();
    const projFrom = snap.guideFrom.clone().project(camera);
    if (projFrom.z < -1 || projFrom.z > 1) return;
    const fromX = (projFrom.x * 0.5 + 0.5) * rect.width;
    const fromY = (-projFrom.y * 0.5 + 0.5) * rect.height;
    const toX = snap.screenPos.x - rect.left;
    const toY = snap.screenPos.y - rect.top;
    const color = SNAP_MARKERS[snap.type]?.color ?? '#FF3333';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
  }

  /** Destroy the overlay canvas */
  dispose() {
    this.canvas.remove();
  }
}
