/**
 * BoundaryTool — ADR-148 β-4 (CAD 표준 BOUNDARY 명령 equivalent).
 *
 * 사용자가 영역 내부의 한 점을 클릭하면 그 점을 둘러싼 가장 작은
 * boundary loop 검출 → face 합성. AutoCAD `BPOLY` / `BHATCH` 와 동일
 * UX.
 *
 *   Click 1: 영역 내부의 한 점 (ground plane 자동 추론)
 *   → bridge.boundaryFromPoint(...) 호출
 *   → 성공 시 boundary face 합성 + syncMesh
 *   → 실패 시 Toast.error (한국어 매핑)
 *
 * 메타-원칙 #16 정합: 휴리스틱 자동 activation 0, 사용자 명시 trigger
 * only. ADR-139 (LOCKED #64 Boundary tool 명시 only) 직계 후속.
 *
 * Keyboard: 'Ctrl+B' (bottom view 'b' 충돌 회피, CAD 관습 정합).
 *
 * Cross-link:
 *   - ADR-148 §2.3 (UI integration Q2=a)
 *   - ADR-139 §14 B-ε (TS BoundaryTool 'Ctrl+B' 단축키)
 *   - LOCKED #5 (1.5μm spatial-hash — point proximity)
 *   - LOCKED #63 (z=0 invariant — Cardinal plane 자동 추론)
 *   - LOCKED #64 (ADR-139 — direct predecessor)
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

/**
 * Default search radius (ADR-148 §2.1 — 10×10×10m 작업 공간 표준).
 * Engine 의 DEFAULT_SEARCH_RADIUS_MM 와 정합.
 */
const DEFAULT_SEARCH_RADIUS_MM = 1000.0;

/**
 * ADR-148 β-4 — Translate Engine BoundaryError to user-facing Korean
 * Toast message. silent skip 차단 (메타-원칙 #16 정합).
 *
 * Engine error format: `"boundaryFromPoint: <BoundaryError>"`.
 * Display impl (Rust):
 *   - "PointNotOnPlane (distance Nmm)"
 *   - "NoOrphanEdgesInRadius (radius Rmm)"
 *   - "NoEnclosingCycle"
 *   - "CycleAlreadyFaced (face N)"
 */
export function humanizeBoundaryError(rawMessage: string): string {
  if (rawMessage.includes('PointNotOnPlane')) {
    const match = rawMessage.match(/distance ([\d.]+)mm/);
    const dist = match ? match[1] : '?';
    return `클릭 위치가 평면 위가 아닙니다 (거리 ${dist}mm)`;
  }
  if (rawMessage.includes('NoOrphanEdgesInRadius')) {
    const match = rawMessage.match(/radius ([\d.]+)mm/);
    const r = match ? match[1] : '?';
    return `주변에 boundary 후보가 없습니다 (반경 ${r}mm 확대 필요)`;
  }
  if (rawMessage.includes('NoEnclosingCycle')) {
    return '이 영역을 둘러싼 boundary 가 없습니다';
  }
  if (rawMessage.includes('CycleAlreadyFaced')) {
    return '이 영역에 이미 면이 있습니다';
  }
  // Fallback — strip "boundaryFromPoint: " prefix if present.
  return rawMessage.replace(/^boundaryFromPoint:\s*/, '');
}

export class BoundaryTool implements ITool {
  readonly name = 'boundary';

  private ctx: ToolContext;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  isBusy(): boolean {
    // Single-click tool — never enters multi-step state.
    return false;
  }

  onActivate(): void {
    debugLog('[BoundaryTool] Activated (ADR-148 β-4, Ctrl+B)');
    Toast.info('Boundary 도구: 영역 내부 클릭');
  }

  onDeactivate(): void {
    // No persistent state to clean up.
  }

  onMouseDown(_e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!point) {
      Toast.warning('Boundary: 유효한 평면 위 위치를 클릭하세요');
      return;
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-170 β-3 — normalizeDrawInput SSOT migration (Phase 1)
    // ════════════════════════════════════════════════════════════════
    // Single chokepoint normalization (5-step routine):
    //   Step 1 Cardinal axis force (LOCKED #63 z=0)
    //   Step 2 Face plane projection (skipped — no faceId here)
    //   Step 3 Vertex_at silent dedup (LOCKED #5)
    //   Step 4 10mm short-circuit (skipped — no chainStart)
    //   Step 5 Plane lock validation (skipped — no targetNormal)
    //
    // Graceful fallback: if ctx.normalizeDrawInput? not available (legacy
    // test mocks), use raw point directly (L-170-6 backward compat).
    // ════════════════════════════════════════════════════════════════
    const normalized = this.ctx.normalizeDrawInput?.(point) ?? { point };
    const pt = normalized.point;

    if (normalized.skipReason === 'DegenerateBelowEpsilon') {
      Toast.warning('Boundary: 입력 위치가 너무 작은 영역');
      return;
    }

    // LOCKED #63 z=0 invariant: default plane = Z=0 ground (XY plane,
    // normal = +Z). Future ADR may infer plane from snapped face.
    const planeNormal = new THREE.Vector3(0, 0, 1);
    const planeDist = 0; // signed distance from origin: normal · origin = 0

    debugLog(
      '[BoundaryTool] click point',
      pt.toArray(),
      'normal',
      planeNormal.toArray(),
      'planeDist',
      planeDist,
    );

    try {
      const faceId = this.ctx.bridge.boundaryFromPoint(
        pt.x, pt.y, pt.z,
        planeNormal.x, planeNormal.y, planeNormal.z,
        planeDist,
        DEFAULT_SEARCH_RADIUS_MM,
      );
      debugLog('[BoundaryTool] synthesized face_id', faceId);
      Toast.success('Boundary 면이 생성되었습니다');
      this.ctx.syncMesh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const userMsg = humanizeBoundaryError(raw);
      Toast.error(`Boundary 생성 실패: ${userMsg}`);
      debugLog('[BoundaryTool] error:', raw);
    }
  }

  onMouseMove(_e: MouseEvent, _point: THREE.Vector3 | null): void {
    // No preview (single-click tool, instant action).
  }

  onMouseUp(_e: MouseEvent): void {
    // No-op (action triggered on mousedown).
  }

  onKeyDown(_e: KeyboardEvent): void {
    // No tool-specific keys (ESC handled by ToolManager).
  }

  commit(): void {
    // No-op — single-click tool commits inside onMouseDown.
  }

  cancel(): void {
    // No state to discard.
  }
}
