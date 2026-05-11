/**
 * MergeActions — extracted from ToolManagerRefactored.ts for the
 * 2026-04-26 (C) refactor pass. Each handler takes a small context
 * object so the actions don't reach into the ToolManager internals.
 *
 * Behaviour-preserving: the bodies are 1:1 copies of the previous
 * inline `else if` branches, only `this.bridge` / `this.selection` /
 * `this.syncMesh` rewritten as `ctx.*`. No tests changed.
 *
 * Covered actions:
 *   merge-faces            (Edge-pair OR multi-face, with material
 *                           respect option, geometric auto-fallback,
 *                           pre-analysis)
 *   merge-faces-geometric  (greedy pairwise, polygon-level)
 *   merge-faces-force      (ADR-008 Axiom 9 — non-coplanar via soft
 *                           edges, preserves ADR-007 planarity)
 *   merge-xia-coplanar     (XIA-scoped batch merge)
 *   merge-as-hole          (B1 escape hatch for legacy geometry)
 */

import * as THREE from 'three';
import { WasmBridge } from '../../bridge/WasmBridge';
import { SelectionManager } from '../SelectionManager';
import { Toast } from '../../ui/Toast';
import { debugLog } from '../../utils/debug';
import { getMergeTolerance, getRespectMaterial, groupFacesByMaterial } from '../MergeSettings';
import { getMaterialLibrary } from '../../materials/MaterialLibrary';

export interface MergeActionContext {
  bridge: WasmBridge;
  selection: SelectionManager;
  syncMesh: () => void;
  /** ToolManager helper that walks the DCEL outer loop of `faceId` and
   *  returns its boundary vertices in 3D. Re-exposed via this context
   *  so actions don't reach back into the ToolManager. */
  extractFaceBoundary: (faceId: number) => THREE.Vector3[];
}

export function mergeFaces(ctx: MergeActionContext): void {
  const edges = ctx.selection.getSelectedEdges();
  const faces = ctx.selection.getSelectedFaces();
  const tol = getMergeTolerance();

  if (edges.length === 1 && faces.length === 0) {
    const edgeId = edges[0];
    const result = ctx.bridge.mergeFacesByEdge(edgeId, tol);
    if (result >= 0) {
      ctx.syncMesh();
      ctx.selection.clearSelection();
      const tolNote = tol !== 0.5 ? ` (tol ${tol}°)` : '';
      Toast.info(`엣지 양옆 면 통합 완료${tolNote}`, 2000);
      debugLog('[Action] merge-faces (edge):', result, 'tol=', tol);
    } else {
      const err = ctx.bridge.lastError();
      Toast.warning(
        err ||
        `해당 엣지 양옆의 두 면이 같은 평면이 아니거나 (현재 tol ${tol}°), 경계가 모호합니다 (공유 엣지 1개 필요)`,
        3500,
      );
    }
    return;
  }

  if (faces.length < 2) {
    Toast.warning('통합하려면 2개 이상의 면 또는 1개의 엣지를 선택하세요', 3000);
    return;
  }

  let workingFaces = faces;
  if (getRespectMaterial()) {
    const lib = getMaterialLibrary();
    const groups = groupFacesByMaterial(faces, (id: number) => lib.getMaterialForFace(id)?.id);
    let bestMat = '';
    let bestSize = 0;
    for (const [mat, ids] of groups) {
      if (ids.length > bestSize) { bestMat = mat; bestSize = ids.length; }
    }
    if (bestSize < 2) {
      Toast.warning('재질 경계 존중 모드: 같은 재질 면이 2개 이상 필요합니다', 3000);
      return;
    }
    workingFaces = groups.get(bestMat)!;
    if (groups.size > 1) {
      debugLog('[Action] merge-faces: respect-material filtered', faces.length, '→', workingFaces.length, 'mat=', bestMat);
    }
  }

  const analysis = ctx.bridge.analyzeMergeCandidates(workingFaces, tol);
  debugLog('[Action] merge-faces pre-analysis:', analysis, 'tol=', tol, 'faces=', workingFaces.length);
  if (analysis.mergeable === 0) {
    if (analysis.total === 0 && workingFaces.length === 2) {
      debugLog('[Action] merge-faces: no shared DCEL edge → trying geometric merge');
      const geoTol = Math.max(tol, 2.0);
      const result = ctx.bridge.mergeCoplanarFacesGeometric(
        workingFaces[0], workingFaces[1], geoTol,
      );
      if (result >= 0) {
        ctx.syncMesh();
        ctx.selection.clearSelection();
        Toast.info(`기하 병합으로 통합 완료 (snap 드리프트 보정 · tol ${geoTol}°/mm)`, 2800);
        debugLog('[Action] merge-faces → geometric fallback: success', result);
        return;
      }
      debugLog('[Action] geometric fallback also failed:', ctx.bridge.lastError());
    }

    const lines: string[] = ['통합할 수 있는 면이 없습니다.'];
    if (analysis.total === 0) {
      lines.push('• 선택한 면들이 엣지를 공유하지 않습니다');
      lines.push('  (엣지가 공유되려면 snap으로 정확히 정점 매칭 필요)');
      lines.push('  → "🧲 기하 병합" 컨텍스트 메뉴로 폴리곤 재구성 시도 가능');
    }
    if (analysis.nonCoplanar > 0) {
      const tolHint = tol === 0.5 ? ' (mergetol 2 명령으로 허용치 확장 가능)' : '';
      lines.push(`• ${analysis.nonCoplanar}쌍이 평면 불일치${tolHint}`);
      lines.push('  → "강제 통합"(ADR-008 Axiom 9) 컨텍스트 메뉴로 내부 엣지만 숨기고 비평면 상태로 결합 가능');
    }
    if (analysis.ambiguous > 0) {
      lines.push(`• ${analysis.ambiguous}쌍이 C-slit 형태 (hole 필요 — 미지원)`);
    }
    const err = ctx.bridge.lastError();
    Toast.warning(err || lines.join('\n'), 4500);
    return;
  }

  const merged = ctx.bridge.tryMergeAdjacentFaces(workingFaces, tol);
  if (merged > 0) {
    ctx.syncMesh();
    ctx.selection.clearSelection();
    const skipped = analysis.nonCoplanar + analysis.ambiguous;
    const skipNote = skipped > 0 ? ` (${skipped}쌍 건너뜀)` : '';
    const tolNote = tol !== 0.5 ? ` · tol ${tol}°` : '';
    const matNote = getRespectMaterial() ? ' · 재질별' : '';
    Toast.info(
      `${merged}회 통합 — ${workingFaces.length}개 면이 ${workingFaces.length - merged}개로 합쳐짐${skipNote}${tolNote}${matNote}`,
      2800,
    );
    debugLog('[Action] merge-faces (faces):', merged, 'tol=', tol);
  } else {
    const err = ctx.bridge.lastError();
    const hint =
      '통합할 수 있는 면이 없습니다.\n• 엣지를 공유하는 coplanar 면이 있어야 합니다\n• 두 면이 한 엣지만 공유해야 합니다 (C-slit 형태 불가)';
    Toast.warning(err || hint, 3500);
  }
}

export function mergeFacesGeometric(ctx: MergeActionContext): void {
  const faces = ctx.selection.getSelectedFaces();
  debugLog('[merge-faces-geometric] selected faces:', faces);
  if (faces.length < 2) {
    Toast.warning('기하 병합은 2개 이상의 면을 선택해야 합니다. 현재: ' + faces.length + '개', 3500);
    return;
  }
  const tol = Math.max(getMergeTolerance(), 2.0);
  let remaining = [...faces];
  let mergedCount = 0;
  let lastError = '';

  let iterations = 0;
  while (remaining.length >= 2 && iterations < 50) {
    iterations++;
    const seed = remaining[0];
    let merged = false;
    for (let i = 1; i < remaining.length; i++) {
      const other = remaining[i];
      debugLog(`[merge-faces-geometric] try ${seed} + ${other} tol=${tol}`);
      const result = ctx.bridge.mergeCoplanarFacesGeometric(seed, other, tol);
      if (result >= 0) {
        mergedCount++;
        remaining.splice(i, 1);
        remaining[0] = result;
        merged = true;
        break;
      } else {
        lastError = ctx.bridge.lastError() || lastError;
      }
    }
    if (!merged) break;
  }

  if (mergedCount > 0) {
    ctx.syncMesh();
    ctx.selection.clearSelection();
    Toast.info(`기하 병합 ${mergedCount}회 완료`, 2500);
    debugLog('[Action] merge-faces-geometric: success', mergedCount);
  } else {
    Toast.warning(
      lastError || '기하 병합 실패 — 두 면이 같은 평면 & 경계가 겹치는지 확인 (tol ' + tol + '°/mm)',
      4000,
    );
    debugLog('[Action] merge-faces-geometric: all attempts failed', lastError);
  }
}

export function mergeFacesForce(ctx: MergeActionContext): void {
  const faces = ctx.selection.getSelectedFaces();
  if (faces.length < 2) {
    Toast.warning('강제 통합은 2개 이상의 면을 선택해야 합니다', 3000);
    return;
  }
  const softened = ctx.bridge.softenInternalEdges(faces);
  if (softened > 0) {
    ctx.syncMesh();
    Toast.info(`${faces.length}개 면을 하나의 폴리곤 서피스로 결합 (${softened}개 내부 엣지 숨김)`, 3000);
    debugLog('[Action] merge-faces-force:', softened);
  } else {
    Toast.warning('강제 통합 실패 — 선택된 면들이 엣지를 공유하지 않습니다. 인접한 면을 함께 선택해주세요.', 3500);
  }
}

export function mergeXiaCoplanar(ctx: MergeActionContext): void {
  const selectedFaces = ctx.selection.getSelectedFaces();
  let xiaId = -1;
  if (selectedFaces.length > 0) {
    xiaId = ctx.bridge.getXiaForFace(selectedFaces[0]);
  }
  if (xiaId < 0 || xiaId === 0xffffffff) {
    Toast.warning('선택된 면이 속한 XIA를 찾을 수 없습니다. 먼저 XIA의 면을 하나 선택하세요.', 3000);
    return;
  }
  const xiaFaceIds = ctx.bridge.getXiaFaceIds(xiaId);
  if (xiaFaceIds.length < 2) {
    Toast.info('이 XIA에는 병합할 면이 2개 이상 없습니다', 2500);
    return;
  }
  const tol = getMergeTolerance();
  const analysis = ctx.bridge.analyzeMergeCandidates(xiaFaceIds, tol);
  debugLog('[Action] merge-xia-coplanar pre-analysis:', analysis, 'xia=', xiaId, 'tol=', tol);
  if (analysis.mergeable === 0) {
    Toast.info(
      `XIA ${xiaId} — 병합 가능한 인접 coplanar 면이 없습니다` +
      (analysis.nonCoplanar > 0 ? ` (평면 불일치 ${analysis.nonCoplanar}쌍)` : ''),
      3000,
    );
    return;
  }
  const merged = ctx.bridge.tryMergeAdjacentFaces(xiaFaceIds, tol);
  if (merged > 0) {
    ctx.syncMesh();
    ctx.selection.clearSelection();
    Toast.info(
      `XIA ${xiaId} — ${merged}회 통합, ${xiaFaceIds.length}개 면 → ${xiaFaceIds.length - merged}개`,
      3000,
    );
  } else {
    Toast.warning(ctx.bridge.lastError() || '통합 실패', 3000);
  }
}

export function mergeAsHole(ctx: MergeActionContext): void {
  const sel = ctx.selection.getSelectedFaces();
  if (sel.length !== 2) {
    Toast.warning(
      '정확히 2개의 면을 선택하세요 (바깥쪽 + 안쪽) · 참고: 새로 그린 내부 RECT는 자동으로 구멍이 됩니다',
      3500,
    );
    return;
  }
  const tol = getMergeTolerance();
  const v0 = ctx.extractFaceBoundary(sel[0]);
  const v1 = ctx.extractFaceBoundary(sel[1]);
  if (v0.length < 3 || v1.length < 3) {
    Toast.warning('면 경계 추출 실패', 2500);
    return;
  }
  const polyArea = (verts: THREE.Vector3[]): number => {
    let area = new THREE.Vector3();
    const p0 = verts[0];
    for (let i = 1; i < verts.length - 1; i++) {
      const a = new THREE.Vector3().subVectors(verts[i], p0);
      const b = new THREE.Vector3().subVectors(verts[i + 1], p0);
      area.add(a.cross(b));
    }
    return area.length() * 0.5;
  };
  const a0 = polyArea(v0);
  const a1 = polyArea(v1);
  const [outer, inner] = a0 >= a1 ? [sel[0], sel[1]] : [sel[1], sel[0]];
  const result = ctx.bridge.mergeCoplanarContaining(outer, inner, tol);
  if (result >= 0) {
    ctx.syncMesh();
    ctx.selection.clearSelection();
    Toast.info('내부 면을 구멍으로 병합 완료', 2500);
  } else {
    Toast.warning(
      ctx.bridge.lastError() ||
      '병합 실패 — 두 면이 같은 평면이고 하나가 다른 하나에 완전히 포함돼야 합니다',
      4000,
    );
  }
}
