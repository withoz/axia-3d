/**
 * Context Menu — Right-click context menu with snap submenu
 *
 * Extracted from main.ts (lines 1003-1222).
 * Handles context menu display, group/component actions, view switching,
 * and snap override submenu with hover behavior.
 */

import { Viewport, ViewMode } from '../viewport/Viewport';
import { WasmBridge } from '../bridge/WasmBridge';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { Toast } from './Toast';
import { debugLog } from '../utils/debug';
import type { SnapType } from '../snap/SnapManager';

export interface ContextMenuDeps {
  viewport: Viewport;
  bridge: WasmBridge;
  toolManager: ToolManager;
  viewModeBar: HTMLElement | null;
  /** OSNAP settings panel open callback */
  openOsnapPanel?: () => void;
}

export function initContextMenu(deps: ContextMenuDeps): void {
  const { viewport, bridge, toolManager, viewModeBar, openOsnapPanel } = deps;
  const snapManager = toolManager.snap;

  const ctxMenu = document.getElementById('context-menu');
  if (!ctxMenu) return;

  // 컨텍스트 메뉴 표시
  viewport.onContextMenu((x, y) => {
    // 라인 그리기 중 우클릭 → 라인 종료 + 메뉴도 표시
    if (toolManager.currentTool === 'line' && toolManager.isToolBusy()) {
      toolManager.cancelCurrentTool();
    }

    // ── 그룹/컴포넌트 메뉴 상황별 표시 ──
    const selected = toolManager.selection.getSelectedFaces();
    const hasSelection = selected.length > 0;
    const canGroup = selected.length >= 2;
    let selectedGroupId: number | undefined;
    if (hasSelection) {
      selectedGroupId = toolManager.selection.getGroupId(selected[0]);
    }
    const isInGroup = selectedGroupId !== undefined;
    const isEditingGroup = toolManager.selection.isInGroupEditMode();

    // 그룹 메뉴 항목 가져오기
    const groupItems = ctxMenu.querySelectorAll('.ctx-group-item');
    const groupSep = ctxMenu.querySelector('.ctx-group-sep') as HTMLElement;

    // 각 항목별 표시 조건
    groupItems.forEach(item => {
      const el = item as HTMLElement;
      const action = el.dataset.action;
      let show = false;
      switch (action) {
        case 'group':          show = canGroup && !isInGroup; break;
        case 'ungroup':        show = isInGroup; break;
        case 'group-edit':     show = isInGroup && !isEditingGroup; break;
        case 'make-component': show = isInGroup; break;
        case 'group-lock':     show = isInGroup; break;
        case 'group-hide':     show = isInGroup; break;
      }
      el.style.display = show ? '' : 'none';
    });

    // 구분선: 그룹 관련 항목이 하나라도 보이면 표시
    const anyGroupVisible = Array.from(groupItems).some(
      el => (el as HTMLElement).style.display !== 'none'
    );
    if (groupSep) groupSep.style.display = anyGroupVisible ? '' : 'none';

    // ── 면 반전 항목 — 선택된 face가 있을 때만 표시 ──
    const faceItems = ctxMenu.querySelectorAll('.ctx-face-item');
    faceItems.forEach(item => {
      (item as HTMLElement).style.display = hasSelection ? '' : 'none';
    });

    // ── ADR-145 β-4 — Annulus 만들기 항목 가시성 ──
    // 가시성: exactly 2 face 선택 (Engine 4-validation 으로 Circle face /
    // coplanar / contained 최종 검증). UI 단순화 — Circle face 사전 검출은
    // bridge API 추가 필요하므로 deferred.
    const annulusItems = ctxMenu.querySelectorAll('.ctx-annulus-item');
    annulusItems.forEach(item => {
      (item as HTMLElement).style.display = selected.length === 2 ? '' : 'none';
    });

    // ── ADR-151 β-4 — Connected Inner Merge 항목 가시성 ──
    // 가시성: ≥2 face 선택 (1 container + ≥1 inner). Engine 가 container
    // 자동 식별 + component grouping + P7 manifold 검증. UI 단순화 —
    // container designation 은 first face (largest by area heuristic
    // deferred to caller; β-4 MVP 는 first selected 를 container 로 가정).
    const p7ResolverItems = ctxMenu.querySelectorAll('.ctx-p7-resolver-item');
    p7ResolverItems.forEach(item => {
      (item as HTMLElement).style.display = selected.length >= 2 ? '' : 'none';
    });

    // ── ADR-164 β-3 — Sticky last drawn plane reset 항목 가시성 ──
    // 가시성: _lastDrawnPlane 활성 시만. Selection 무관 (도형 그리기 전
    // 사용자가 sticky 해제 의도).
    const planeResetItems = ctxMenu.querySelectorAll('.ctx-plane-reset-item');
    const hasStickyPlane = typeof (toolManager as { getLastDrawnPlane?: () => unknown }).getLastDrawnPlane === 'function'
      && (toolManager as { getLastDrawnPlane: () => unknown }).getLastDrawnPlane() !== null;
    planeResetItems.forEach(item => {
      (item as HTMLElement).style.display = hasStickyPlane ? '' : 'none';
    });

    // ── ADR-166 β-3 — Plane lock unlock 항목 가시성 ──
    // 가시성: _planeLock 활성 시만. Strong cross-tool lock 의 명시
    // release path (Ctrl+Shift+P 와 동일 entry). Selection 무관.
    const planeLockItems = ctxMenu.querySelectorAll('.ctx-plane-lock-unlock-item');
    const hasPlaneLock = typeof (toolManager as { isPlaneLocked?: () => boolean }).isPlaneLocked === 'function'
      && (toolManager as { isPlaneLocked: () => boolean }).isPlaneLocked();
    planeLockItems.forEach(item => {
      (item as HTMLElement).style.display = hasPlaneLock ? '' : 'none';
    });

    // ── ADR-074 U-2 — Boolean Group A/B 항목 가시성 ──
    // Set A / Set B: 선택된 face 가 1개 이상일 때 표시 (사용자가
    //   현재 selection 을 group 으로 지정 가능).
    // Clear groups: 어떤 group tag 라도 있을 때 표시 (지울 게 있어야
    //   메뉴 항목이 의미 있음).
    const boolGroupItems = ctxMenu.querySelectorAll('.ctx-bool-group-item');
    boolGroupItems.forEach(item => {
      (item as HTMLElement).style.display = hasSelection ? '' : 'none';
    });
    const boolGroupClearItems = ctxMenu.querySelectorAll('.ctx-bool-group-clear');
    const sm = toolManager.selection as { hasAnyGroupTag?: () => boolean };
    const showClear = typeof sm.hasAnyGroupTag === 'function' && sm.hasAnyGroupTag();
    boolGroupClearItems.forEach(item => {
      (item as HTMLElement).style.display = showClear ? '' : 'none';
    });

    // ── Edge constraint (2엣지) 항목 ──
    const edgeItems = ctxMenu.querySelectorAll('.ctx-edge-item');
    const selectedEdges = toolManager.selection.getSelectedEdges().length;
    edgeItems.forEach(item => {
      (item as HTMLElement).style.display = selectedEdges === 2 ? '' : 'none';
    });

    // ── 1엣지 전용 항목 (길이/중점 분할) ──
    const edge1Items = ctxMenu.querySelectorAll('.ctx-edge1-item');
    edge1Items.forEach(item => {
      (item as HTMLElement).style.display = selectedEdges === 1 ? '' : 'none';
    });

    // ── 엣지 체인 전용 항목 (Revolve, 1개 이상) ──
    const chainItems = ctxMenu.querySelectorAll('.ctx-edge-chain-item');
    chainItems.forEach(item => {
      (item as HTMLElement).style.display = selectedEdges >= 1 ? '' : 'none';
    });

    // 화면 밖으로 나가지 않도록 위치 조정
    const menuW = 200, menuH = 400;
    const cx = Math.min(x, window.innerWidth - menuW);
    let cy: number;
    if (y + menuH > window.innerHeight) {
      cy = y - menuH;  // 클릭 위치 위로 펼침 (ZWCAD 스타일)
    } else {
      cy = y;
    }
    cy = Math.max(4, cy);
    ctxMenu.style.left = cx + 'px';
    ctxMenu.style.top = cy + 'px';
    ctxMenu.classList.add('visible');
  });

  // 메뉴 아이템 클릭
  ctxMenu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.ctx-item') as HTMLElement;
    if (!item) return;
    const action = item.dataset.action;
    ctxMenu.classList.remove('visible');

    switch (action) {
      case 'snap-override': return; // hover로 처리, 클릭 무시
      case 'undo': toolManager.executeAction('undo'); break;
      case 'redo': toolManager.executeAction('redo'); break;
      case 'delete': toolManager.executeAction('delete'); break;
      case 'flip-faces': toolManager.executeAction('flip-faces'); break;
      case 'merge-faces': toolManager.executeAction('merge-faces'); break;
      case 'merge-faces-geometric': toolManager.executeAction('merge-faces-geometric'); break;
      case 'merge-xia-coplanar': toolManager.executeAction('merge-xia-coplanar'); break;
      case 'merge-faces-force': toolManager.executeAction('merge-faces-force'); break;
      case 'merge-as-hole': toolManager.executeAction('merge-as-hole'); break;
      // ─ ADR-145 β-4 — Circle annulus 명시 promote (메타-원칙 #16 정합) ─
      // 사용자 워크플로우 (ADR-145 §2.1):
      //   1. DrawCircle × 2 (큰 + 작은, concentric)
      //   2. Ctrl+click 으로 두 face 선택
      //   3. 우클릭 → "Annulus 만들기"
      //   4. Engine 4-validation (active / Circle face / coplanar / contained)
      //   5. 통과 시 outer face 의 hole 로 inner 추가, inner face deactivate
      //
      // Inner/outer 판정 — Engine 이 InnerNotContained 반환 시 swap 후 retry.
      // 두 ordering 모두 실패 → Toast.error (Engine error message).
      case 'promote-circles-to-annulus': {
        const faces = toolManager.selection.getSelectedFaces();
        if (faces.length !== 2) {
          Toast.error('Annulus: 정확히 2개의 면을 선택해야 합니다');
          break;
        }
        const [faceA, faceB] = faces;
        // Try (A as outer, B as inner). If InnerNotContained, swap retry.
        const tryPromote = (outer: number, inner: number): string | null => {
          try {
            bridge.promoteCirclesToAnnulus(outer, inner);
            return null;
          } catch (err) {
            return err instanceof Error ? err.message : String(err);
          }
        };
        let err = tryPromote(faceA, faceB);
        if (err && err.includes('InnerNotContained')) {
          err = tryPromote(faceB, faceA);
        }
        if (err) {
          Toast.error(`Annulus 만들기 실패: ${err}`);
        } else {
          Toast.success('Annulus 생성 완료');
          toolManager.selection.clearSelection();
          toolManager.syncMesh();
        }
        break;
      }
      // ─ ADR-149 β-4 — T-junction Sweep 명시 trigger (메타-원칙 #16 정합) ─
      // 사용자 워크플로우 (ADR-149 §2):
      //   1. 우클릭 → "T-junction 정리"
      //   2. bridge.detectTJunctions() — 모든 T-junction 검출
      //   3. empty → Toast.info "T-junction 없음" + return
      //   4. 각 report 에 대해 bridge.healTJunction(report) 호출
      //      (각 healing 후 새 vertex 가 mesh 에 추가되므로 detection 재실행
      //      필요. β-4 MVP — single-pass detection + serial healing. multi-
      //      pass batch 는 β-4-extension 또는 별도 sub-step.)
      //   5. Toast.success "N개 정리" 또는 partial failure 시 mixed Toast
      case 'heal-t-junctions': {
        let reports;
        try {
          reports = bridge.detectTJunctions();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          Toast.error(`T-junction 검출 실패: ${msg}`);
          break;
        }
        if (reports.length === 0) {
          Toast.info('T-junction 없음 (mesh 정상)');
          break;
        }
        // β-4 MVP: serial heal — re-detect 필요한 경우 사용자가 재호출 가능.
        // Engine 의 split_edge 는 face boundary loop 를 갱신하므로 다른
        // reports 의 face_id / edge_id / vertex_id 가 stale 될 수 있음.
        // InvalidReport / VertexNotOnEdge 시 skip + 다음 report 진행.
        let healed = 0;
        let skipped = 0;
        const firstError: { msg: string } | null = null;
        for (const report of reports) {
          try {
            bridge.healTJunction(report);
            healed++;
          } catch (err) {
            skipped++;
            // First error 만 기록 (Toast 길이 제한)
            if (firstError === null) {
              const msg = err instanceof Error ? err.message : String(err);
              debugLog('T-junction skip:', msg);
            }
          }
        }
        // syncMesh + selection clear (healing 후 mesh state 변경)
        toolManager.selection.clearSelection();
        toolManager.syncMesh();

        if (healed > 0 && skipped === 0) {
          Toast.success(`T-junction ${healed}개 정리 완료`);
        } else if (healed > 0 && skipped > 0) {
          Toast.info(`T-junction ${healed}개 정리, ${skipped}개 skip (재시도 가능)`);
        } else {
          Toast.error(`T-junction 정리 실패 (${skipped}개 skip)`);
        }
        break;
      }
      // ─ ADR-150 β-4 — Coplanar Face Merge Sweep 명시 trigger (메타-원칙 #16 정합) ─
      // 사용자 워크플로우 (ADR-150 §2):
      //   1. 우클릭 → "🧹 Coplanar 면 일괄 자동 정리"
      //   2. bridge.sweepCoplanarPairs() — 모든 coplanar mergeable pair 검출
      //   3. empty → Toast.info "정리 대상 없음" + return
      //   4. bridge.mergeCoplanarPairBatch(pairs) — single batch call
      //      (cascade A-B → AB-C handling은 engine 책임)
      //   5. Toast 3-way (success / info (partial) / error)
      //
      // ADR-149 β-4 패턴 1:1 mirror — single batch call 이라 serial loop
      // 없음 (engine 의 cascade handling 위임).
      case 'heal-coplanar-pairs': {
        let pairs;
        try {
          pairs = bridge.sweepCoplanarPairs();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          Toast.error(`Coplanar 검출 실패: ${msg}`);
          break;
        }
        if (pairs.length === 0) {
          Toast.info('Coplanar 정리 대상 없음 (mesh 정상)');
          break;
        }
        try {
          const report = bridge.mergeCoplanarPairBatch(pairs);
          // syncMesh + selection clear (merge 후 mesh state 변경)
          toolManager.selection.clearSelection();
          toolManager.syncMesh();

          if (report.mergedCount > 0 && report.skippedCount === 0) {
            Toast.success(`Coplanar ${report.mergedCount}쌍 정리 완료`);
          } else if (report.mergedCount > 0 && report.skippedCount > 0) {
            Toast.info(`Coplanar ${report.mergedCount}쌍 정리, ${report.skippedCount}쌍 skip`);
          } else {
            Toast.error(`Coplanar 정리 실패 (${report.skippedCount}쌍 skip)`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          Toast.error(`Coplanar 정리 실패: ${msg}`);
        }
        break;
      }
      // ─ ADR-164 β-3 — Sticky last drawn plane reset (메타-원칙 #16 보완) ─
      // 사용자 워크플로우:
      //   1. Draw 도구로 도형 그림 → sticky 활성 (β-2)
      //   2. 의도 변경: 다른 평면으로 그리고 싶음
      //   3. 우클릭 → "📐 기본 평면으로" → clearLastDrawnPlane 호출
      //   4. 다음 도형은 view-mode default plane 으로 fallback
      case 'reset-last-drawn-plane': {
        const tm = toolManager as { clearLastDrawnPlane?: () => void };
        if (typeof tm.clearLastDrawnPlane === 'function') {
          tm.clearLastDrawnPlane();
          Toast.info('기본 평면으로 복귀 (sticky 해제)', 2000);
        }
        break;
      }
      // ─ ADR-166 β-3 — Plane lock 명시 release (Ctrl+Shift+P 와 동일 entry) ─
      // 사용자 워크플로우:
      //   1. Draw 도구 first_click → plane lock 자동 활성 (β-2)
      //   2. 후속 도구 (다른 Draw / 후속 click) 가 strong cross-tool lock
      //      유지 (priority #1)
      //   3. 의도 변경: 다른 평면으로 그리고 싶음
      //   4. 우클릭 → "🔓 평면 잠금 해제" → unlockPlane 호출
      //   5. 다음 first_click 이 새 plane 으로 lock 활성
      case 'unlock-plane-lock': {
        const tm = toolManager as { unlockPlane?: () => void; isPlaneLocked?: () => boolean };
        if (typeof tm.unlockPlane === 'function') {
          tm.unlockPlane();
          Toast.info('평면 잠금 해제 (다음 도형이 자유 평면 선택)', 2000);
        }
        break;
      }
      // ─ ADR-151 β-4 — Connected Stacked-inner Component-Merge Resolver (메타-원칙 #16 정합) ─
      // 사용자 워크플로우 (ADR-151 §2):
      //   1. 큰 face (container) + 작은 face들 (inners) 선택 (≥2개)
      //   2. 우클릭 → "🔗 Connected Inner Merge"
      //   3. β-4 MVP: first selected = container, 나머지 = inners
      //      (큰/작은 area 자동 판정은 future ADR — container designation UI)
      //   4. bridge.enforceP7Canonical(container, inners) — engine 가
      //      component grouping + ring-with-hole rebuild + P7 manifold 검증
      //   5. Toast 3-way (success / info (with violations) / error)
      //
      // ADR-149/150 β-4 패턴 1:1 mirror — single engine call. Engine
      // 가 transaction wrap + Undo single step.
      case 'enforce-p7-canonical': {
        const faces = toolManager.selection.getSelectedFaces();
        if (faces.length < 2) {
          Toast.error('Connected Inner Merge: container + ≥1 inner (총 ≥2 face) 선택 필요');
          break;
        }
        // β-4 MVP: first selected = container, 나머지 = inners
        const [container, ...inners] = faces;
        try {
          const result = bridge.enforceP7Canonical(container, inners);
          // syncMesh + selection clear (rebuild 후 mesh state 변경)
          toolManager.selection.clearSelection();
          toolManager.syncMesh();

          if (result.isValid) {
            Toast.success(`P7 canonical 정합: ${result.componentCount}개 component → ring-with-hole`);
          } else {
            // ADR-051 §2.5 deferred boundary — ≤1 violation 정상.
            Toast.info(`P7 canonical (${result.componentCount}개 component, ${result.violationCount}개 violation — ADR-051 §2.5 deferred boundary 가능)`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          Toast.error(`Connected Inner Merge 실패: ${msg}`);
        }
        break;
      }
      case 'mirror-x': toolManager.executeAction('mirror-x'); break;
      case 'mirror-y': toolManager.executeAction('mirror-y'); break;
      case 'mirror-z': toolManager.executeAction('mirror-z'); break;
      case 'revolve-x': toolManager.executeAction('revolve-x'); break;
      case 'revolve-y': toolManager.executeAction('revolve-y'); break;
      case 'revolve-z': toolManager.executeAction('revolve-z'); break;
      case 'fillet-edge': toolManager.executeAction('fillet-edge'); break;
      case 'chamfer-edge': toolManager.executeAction('chamfer-edge'); break;
      case 'array-linear': toolManager.executeAction('array-linear'); break;
      case 'array-radial': toolManager.executeAction('array-radial'); break;
      case 'thicken-faces': toolManager.executeAction('thicken-faces'); break;
      case 'assign-quick-color': toolManager.executeAction('assign-quick-color'); break;
      case 'convert-to-centerline': toolManager.executeAction('convert-to-centerline'); break;
      case 'convert-to-geometry': toolManager.executeAction('convert-to-geometry'); break;
      case 'bend-selection':  toolManager.executeAction('bend-selection'); break;
      case 'twist-selection': toolManager.executeAction('twist-selection'); break;
      case 'taper-selection': toolManager.executeAction('taper-selection'); break;
      case 'constrain-parallel':
      case 'constrain-perpendicular':
      case 'constrain-collinear':
      case 'constrain-edge-length':
      case 'split-edge-midpoint':
      case 'constrain-endpoint-distance':
        toolManager.executeAction(action);
        break;
      // ── ADR-074 U-2 — Boolean Group A/B selection actions ──
      // Direct SelectionManager calls (U-2-e=(b)) — bypasses
      // ToolManager.executeAction since this is pure selection-state
      // mutation, not an action that needs scene transaction wrapping.
      case 'set-group-a': {
        const faces = toolManager.selection.getSelectedFaces();
        const sm = toolManager.selection as {
          setGroupTag?: (faceIds: number[], group: 'A' | 'B') => void;
        };
        if (faces.length > 0 && typeof sm.setGroupTag === 'function') {
          sm.setGroupTag(faces, 'A');
          debugLog(`[BoolGroup] set Group A on ${faces.length} face(s)`);
        }
        break;
      }
      case 'set-group-b': {
        const faces = toolManager.selection.getSelectedFaces();
        const sm = toolManager.selection as {
          setGroupTag?: (faceIds: number[], group: 'A' | 'B') => void;
        };
        if (faces.length > 0 && typeof sm.setGroupTag === 'function') {
          sm.setGroupTag(faces, 'B');
          debugLog(`[BoolGroup] set Group B on ${faces.length} face(s)`);
        }
        break;
      }
      case 'clear-group-tags': {
        const sm = toolManager.selection as {
          clearGroupTags?: () => void;
        };
        if (typeof sm.clearGroupTags === 'function') {
          sm.clearGroupTags();
          debugLog('[BoolGroup] cleared all group tags');
        }
        break;
      }
      case 'select-all': toolManager.executeAction('select-all'); break;
      case 'select-same': toolManager.executeAction('select-same'); break;
      case 'deselect': toolManager.selection.clearSelection(); break;
      case 'toggle-selection-dims': toolManager.executeAction('toggle-selection-dims'); break;
      // 그룹 / 컴포넌트
      case 'group': toolManager.executeAction('group'); break;
      case 'ungroup': toolManager.executeAction('ungroup'); break;
      case 'group-edit': {
        const faces = toolManager.selection.getSelectedFaces();
        if (faces.length > 0) {
          const gid = toolManager.selection.getGroupId(faces[0]);
          if (gid !== undefined) toolManager.selection.enterGroupEdit(gid);
        }
        break;
      }
      case 'make-component': toolManager.executeAction('make-component'); break;
      case 'group-lock': {
        const faces = toolManager.selection.getSelectedFaces();
        if (faces.length > 0) {
          const gid = toolManager.selection.getGroupId(faces[0]);
          if (gid !== undefined) bridge.toggleGroupLock(gid);
        }
        break;
      }
      case 'group-hide': {
        const faces = toolManager.selection.getSelectedFaces();
        if (faces.length > 0) {
          const gid = toolManager.selection.getGroupId(faces[0]);
          if (gid !== undefined) {
            bridge.toggleGroupVisibility(gid);
            toolManager.syncMesh();
          }
        }
        break;
      }
      // 뷰
      case 'view-top': viewport.setViewMode('top'); break;
      case 'view-front': viewport.setViewMode('front'); break;
      case 'view-right': viewport.setViewMode('right'); break;
      case 'view-3d': viewport.setViewMode('3d'); break;
    }

    // 뷰 모드 UI 동기화
    if (action?.startsWith('view-')) {
      const mode = action.replace('view-', '') as ViewMode;
      viewModeBar?.querySelectorAll('.view-btn').forEach(b =>
        b.classList.toggle('active', (b as HTMLElement).dataset.view === mode)
      );
      const toolLabel = document.getElementById('tool-label');
      if (toolLabel) {
        const names: Record<string, string> = {
          '3d': '3D Perspective',
          top: 'Top (XY)', front: 'Front (XZ)',
          right: 'Right (YZ)',
        };
        toolLabel.textContent = names[mode] || mode;
      }
    }
  });

  // ═══ 스냅 재지정 서브메뉴 — hover로 열기 (CAD 스타일) ═══
  const snapSub = document.getElementById('snap-submenu');
  const snapTrigger = ctxMenu.querySelector('.ctx-submenu-trigger') as HTMLElement;

  if (snapTrigger && snapSub) {
    // hover → 서브메뉴 표시
    snapTrigger.addEventListener('mouseenter', () => {
      const rect = snapTrigger.getBoundingClientRect();
      let left = rect.right + 2;
      const subW = 210, subH = 480;
      if (left + subW > window.innerWidth) left = rect.left - subW - 2;
      let top: number;
      if (rect.bottom + subH > window.innerHeight) {
        top = rect.bottom - subH; // 위로 펼침 (ZWCAD 스타일)
      } else {
        top = rect.top;
      }
      top = Math.max(4, top);
      snapSub.style.left = left + 'px';
      snapSub.style.top = top + 'px';
      snapSub.classList.add('visible');
    });

    // 메인 메뉴의 다른 항목에 hover하면 서브메뉴 닫기
    ctxMenu.querySelectorAll('.ctx-item').forEach(item => {
      if (item === snapTrigger) return;
      item.addEventListener('mouseenter', () => {
        snapSub.classList.remove('visible');
      });
    });

    // 서브메뉴 밖으로 나가면 닫기 (메인메뉴/서브메뉴 둘 다 벗어났을 때)
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const startClose = () => {
      closeTimer = setTimeout(() => snapSub.classList.remove('visible'), 150);
    };
    const cancelClose = () => {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    };
    snapSub.addEventListener('mouseenter', cancelClose);
    snapSub.addEventListener('mouseleave', startClose);
    snapTrigger.addEventListener('mouseleave', startClose);
    snapTrigger.addEventListener('mouseenter', cancelClose);
  }

  // 메뉴 외부 클릭 시 닫기
  window.addEventListener('mousedown', (e) => {
    if (!ctxMenu.contains(e.target as Node) && !(snapSub && snapSub.contains(e.target as Node))) {
      ctxMenu.classList.remove('visible');
      snapSub?.classList.remove('visible');
    }
  });

  // ═══ 스냅 재지정 서브메뉴 클릭 ═══
  if (snapSub) {
    snapSub.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.snap-ov') as HTMLElement;
      if (!item) return;
      const snapType = item.dataset.snap;

      // 메뉴 닫기
      snapSub.classList.remove('visible');
      ctxMenu.classList.remove('visible');

      if (snapType === 'none') {
        snapManager.setOverride('none');
      } else if (snapType === 'settings') {
        openOsnapPanel?.();
      } else if (snapType) {
        debugLog('[OSNAP] Override snap:', snapType);
        snapManager.setOverride(snapType as SnapType);
      }
    });
  }
}
