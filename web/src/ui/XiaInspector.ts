/**
 * XIA Inspector Panel — Point → Line → Face → Volume → XIA state machine
 *
 * Extracted from main.ts (section 12, lines 307-618).
 * Manages geometry state classification, material assignment, physical properties,
 * and the inspector panel UI with tab switching and keyboard shortcuts.
 */

import { WasmBridge } from '../bridge/WasmBridge';
import { Viewport } from '../viewport/Viewport';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { debugLog } from '../utils/debug';
import { Toast } from './Toast';
import { attemptMaterialRemovalDemote } from '../citizenship/MaterialRemovalDemote';

export interface XiaInspectorDeps {
  bridge: WasmBridge;
  viewport: Viewport;
  toolManager: ToolManager;
}

export async function initXiaInspector(deps: XiaInspectorDeps): Promise<void> {
  const { bridge, viewport, toolManager } = deps;

  const xiPanel = document.getElementById('xia-inspector');
  const xiBtn = document.getElementById('inspector-btn');
  const xiClose = document.getElementById('xi-close');

  // MaterialLibrary import (동적)
  const { getMaterialLibrary, GeometryState, GEOMETRY_STATES } = await import('../materials/MaterialLibrary');
  const matLib = getMaterialLibrary();
  matLib.setBridge(bridge); // Rust 엔진과 재질 동기화 연결

  let nextXiaNum = 1;
  let currentFaceIds: number[] = [];
  let currentVolumeMM3 = 0;

  // 재질 드롭다운 채우기
  const matSelect = document.getElementById('xi-material') as HTMLSelectElement | null;
  if (matSelect) {
    const allMats = matLib.getAll();
    for (const mat of allMats) {
      const opt = document.createElement('option');
      opt.value = mat.id;
      opt.textContent = `${mat.name} (${mat.nameEn})`;
      matSelect.appendChild(opt);
    }
  }

  const toggleInspector = () => {
    if (xiPanel) xiPanel.classList.toggle('open');
  };

  xiBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleInspector();
  });
  xiClose?.addEventListener('click', () => xiPanel?.classList.remove('open'));

  // 탭 전환
  xiPanel?.querySelectorAll('.xi-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      xiPanel.querySelectorAll('.xi-tab').forEach(t => t.classList.remove('active'));
      xiPanel.querySelectorAll('.xi-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = (tab as HTMLElement).dataset.tab;
      document.getElementById(`xi-tab-${target}`)?.classList.add('active');
    });
  });

  const formatNum = (n: number, decimals = 0): string => {
    if (decimals === 0) return Math.round(n).toLocaleString();
    return n.toFixed(decimals).replace(/\B(?=(\d{3})+\.)/g, ',');
  };

  // ── 기하 차원 인디케이터 업데이트 (Line → Face → Volume) ──
  //
  // Point/XIA는 의도적으로 배제 (ADR-002):
  //   - Point는 Drawing 도구의 중간 상태일 뿐, 독립 XIA가 아님
  //   - XIA는 차원 축이 아닌 Semantic 분류이므로 차원 바에 들어가면 범주 오류
  // HTML `data-state="line"` ↔ `GeometryState.Edge = 'edge'` 매핑 유지.
  // 빈 문자열("")을 넘기면 모든 단계 비활성화.
  const toStepName = (state: string): string => {
    if (state === 'edge') return 'line';
    return state;
  };
  const updateStateSteps = (state: string) => {
    const stepsEl = document.getElementById('xi-state-steps');
    if (!stepsEl) return;

    const order = ['line', 'face', 'volume'];
    const normalized = toStepName(state);
    const activeIdx = order.indexOf(normalized); // -1 = all off (선택 없음 또는 Point)

    stepsEl.querySelectorAll('.xi-step').forEach(step => {
      const s = (step as HTMLElement).dataset.state || '';
      const idx = order.indexOf(s);
      step.classList.remove('active', 'passed');
      if (activeIdx < 0) return; // 전체 비활성
      if (idx === activeIdx) step.classList.add('active');
      else if (idx < activeIdx) step.classList.add('passed');
    });

    stepsEl.querySelectorAll('.xi-step-line').forEach((line, i) => {
      if (activeIdx < 0) {
        line.classList.remove('passed');
      } else {
        line.classList.toggle('passed', i < activeIdx);
      }
    });
  };

  // 초기 상태: 아무 선택 없으니 전체 비활성화 (Point 강제 표시 제거)
  updateStateSteps('');

  // ── 물리 속성 패널 업데이트 ──
  const updatePhysicalPanel = (materialId: string | null) => {
    const hintEl = document.getElementById('xi-material-hint');
    const propsEl = document.getElementById('xi-material-props');
    const badgeEl = document.getElementById('xi-phys-badge');
    const assignBtn = document.getElementById('xi-assign-btn');

    if (!materialId || materialId === '') {
      // ADR-050 P-6 — 형태 (Shape) 상태: 재질 없음, form layer
      // (ADR-049 §4 Q3 — 사용자 facing 에서 재질 없는 단계엔 'XIA' 안 노출)
      if (hintEl) hintEl.style.display = '';
      if (propsEl) propsEl.style.display = 'none';
      if (badgeEl) { badgeEl.textContent = '형태 (Shape)'; badgeEl.style.background = 'rgba(156, 39, 176, 0.15)'; badgeEl.style.color = '#ce93d8'; }
      assignBtn?.classList.remove('assigned');
      return;
    }

    const mat = matLib.get(materialId);
    if (!mat) return;

    // ADR-050 P-6 — XIA (특성) 상태: 재질 있음, property layer
    // (ADR-049 §4 Q3 — 부재 정체성, primary material + face-level override)
    if (hintEl) hintEl.style.display = 'none';
    if (propsEl) propsEl.style.display = '';
    if (badgeEl) { badgeEl.textContent = 'XIA (특성)'; badgeEl.style.background = 'rgba(76, 175, 80, 0.15)'; badgeEl.style.color = '#81c784'; }
    assignBtn?.classList.add('assigned');

    // 물리 속성 채우기
    const densityEl = document.getElementById('xi-density') as HTMLInputElement;
    const thermalEl = document.getElementById('xi-thermal') as HTMLInputElement;
    if (densityEl) densityEl.value = mat.physical.density.toLocaleString();
    if (thermalEl) thermalEl.value = String(mat.physical.thermalConductivity);

    // 화재 등급
    xiPanel?.querySelectorAll('.xi-fire-btn').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.fire === mat.physical.fireRating);
    });

    // 질량/무게 계산
    const physics = matLib.computePhysics(currentVolumeMM3, materialId);
    const massEl = document.getElementById('xi-mass');
    const weightNEl = document.getElementById('xi-weight-n');
    if (physics) {
      if (massEl) massEl.textContent = formatNum(physics.mass, 1);
      if (weightNEl) weightNEl.textContent = formatNum(physics.weight, 1);
    }
  };

  // ── 재질 변경 → Viewport 색상 갱신 ──
  const refreshViewportColors = () => {
    viewport.refreshMaterialColors();
  };

  // MaterialLibrary 변경 이벤트 → Viewport 동기화
  matLib.onChange(refreshViewportColors);

  // ADR-091 D-δ — Material Removal → Shape 가역 강등 trigger.
  // Called from both entry points (dropdown "없음" + 재질 해제 버튼,
  // Lock-in D-F=c). Attempts to demote each owning Xia, then surfaces
  // a 5-second "되돌리기" Toast so the user can one-click undo per
  // Lock-in D-E=a.
  const triggerMaterialRemovalDemote = (faceIds: number[]) => {
    if (faceIds.length === 0) return;
    const result = attemptMaterialRemovalDemote(bridge, faceIds);
    if (result.demoted.length > 0) {
      const n = result.demoted.length;
      const msg = n === 1
        ? '재질 제거됨 — 형태로 강등'
        : `${n}개 객체 재질 제거됨 — 형태로 강등`;
      Toast.infoWithAction(msg, {
        label: '되돌리기',
        onClick: () => {
          bridge.undo();
          updateInspector(currentFaceIds);
        },
      }, 5000);
    }
    // Partial failures are surfaced separately — the demoted Xias are
    // still gone, but eligible-but-rejected ones (rare with current
    // gating) deserve a warning so the user understands the state.
    if (result.errors.length > 0) {
      Toast.warning(`재질 제거 시 ${result.errors.length}건 강등 실패 (나머지는 적용됨)`);
    }
  };

  // ── 재질 변경 이벤트 ──
  matSelect?.addEventListener('change', () => {
    const materialId = matSelect.value;
    const selectedNow = toolManager.selection.getSelectedFaces();
    const targetFaces = selectedNow.length > 0 ? selectedNow : currentFaceIds;
    debugLog('[Material] assign to faces:', targetFaces, 'material:', materialId);
    if (targetFaces.length > 0 && materialId) {
      matLib.assignToFaces(targetFaces, materialId);
    } else if (targetFaces.length > 0 && !materialId) {
      matLib.unassignFromFaces(targetFaces);
      // ADR-091 D-δ — material → "없음" 트리거 (D-F=c entry #1).
      triggerMaterialRemovalDemote(targetFaces);
    }
    currentFaceIds = targetFaces;
    updatePhysicalPanel(materialId || null);
    updateInspector(currentFaceIds);
  });

  // ── 재질 부여/해제 버튼 ──
  document.getElementById('xi-assign-btn')?.addEventListener('click', () => {
    if (!matSelect || currentFaceIds.length === 0) return;
    if (matLib.hasMaterial(currentFaceIds)) {
      matLib.unassignFromFaces(currentFaceIds);
      matSelect.value = '';
      updatePhysicalPanel(null);
      // ADR-091 D-δ — 재질 해제 버튼 트리거 (D-F=c entry #2).
      triggerMaterialRemovalDemote(currentFaceIds);
    } else if (matSelect.value) {
      matLib.assignToFaces(currentFaceIds, matSelect.value);
      updatePhysicalPanel(matSelect.value);
    }
    updateInspector(currentFaceIds);
  });

  // ── 엣지 선택용: 총 길이 계산 (edgeLines + edgeMap 조합) ──
  const computeEdgesTotalLength = (edgeIds: number[]): number => {
    const lines = bridge.getEdgeLines();
    const map = bridge.getEdgeMap();
    if (!lines || !map) return 0;
    const targetSet = new Set(edgeIds);
    let total = 0;
    for (let seg = 0; seg < map.length; seg++) {
      if (!targetSet.has(map[seg])) continue;
      const b = seg * 6;
      if (b + 5 >= lines.length) continue;
      const dx = lines[b + 3] - lines[b];
      const dy = lines[b + 4] - lines[b + 1];
      const dz = lines[b + 5] - lines[b + 2];
      total += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return total;
  };

  // ── Inspector 메인 업데이트 ──
  const updateInspector = (faceIds: number[]) => {
    currentFaceIds = faceIds;
    const edgeIds = toolManager.selection.getSelectedEdges();
    const emptyEl = document.getElementById('xi-empty');
    const contentEl = document.getElementById('xi-content');

    // 1) 아무것도 선택 안 됨 — 모든 상태 비활성 (Point 강제 표시 금지)
    if (faceIds.length === 0 && edgeIds.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      if (contentEl) contentEl.style.display = 'none';
      updateStateSteps('');
      return;
    }

    // 2) 엣지만 선택됨 → Line 상태
    if (faceIds.length === 0 && edgeIds.length > 0) {
      if (emptyEl) emptyEl.style.display = 'none';
      if (contentEl) contentEl.style.display = '';
      if (xiPanel && !xiPanel.classList.contains('open')) {
        xiPanel.classList.add('open');
      }
      updateStateSteps('line');

      // ID
      const idEl = document.getElementById('xi-id');
      if (idEl) idEl.textContent = `XIA-${String(nextXiaNum).padStart(4, '0')}`;

      // 상태 라벨 (Edge)
      const edgeState = GEOMETRY_STATES[GeometryState.Edge];
      const dotEl = document.getElementById('xi-solid-dot');
      const labelEl = document.getElementById('xi-solid-label');
      const subEl = document.getElementById('xi-solid-sub');
      const shapeEl = document.getElementById('xi-shape-type');
      if (dotEl) dotEl.className = 'xi-solid-dot edge';
      if (labelEl) labelEl.textContent = `${edgeState.icon} ${edgeState.labelEn}`;
      if (subEl) subEl.textContent = `${edgeIds.length}개 선분`;
      if (shapeEl) shapeEl.textContent = '□ 선';

      // 치수: 길이만 의미 있음 (L = 총 길이, W/H = 0)
      const totalLen = computeEdgesTotalLength(edgeIds);
      const lengthEl = document.getElementById('xi-length');
      const widthEl = document.getElementById('xi-width');
      const heightEl = document.getElementById('xi-height');
      const areaEl = document.getElementById('xi-area');
      if (lengthEl) lengthEl.textContent = formatNum(totalLen);
      if (widthEl) widthEl.textContent = '0';
      if (heightEl) heightEl.textContent = '0';
      if (areaEl) areaEl.textContent = '0';

      // 부피/무게 박스 숨김
      const volBox = document.getElementById('xi-volume')?.closest('.xi-computed-box') as HTMLElement | null;
      const weightBox = document.getElementById('xi-weight')?.closest('.xi-computed-box') as HTMLElement | null;
      if (volBox) volBox.style.display = 'none';
      if (weightBox) weightBox.style.display = 'none';

      // 물리 속성 섹션은 Edge에서 비활성화 (dim)
      const physSection = document.getElementById('xi-physical-section');
      if (physSection) {
        physSection.style.display = '';
        physSection.style.opacity = '0.35';
        physSection.style.pointerEvents = 'none';
      }

      currentVolumeMM3 = 0;

      // 이름: "선분 N개"처럼 자동 표시 (수동 편집 안 된 경우)
      const nameEl = document.getElementById('xi-name') as HTMLInputElement | null;
      if (nameEl && !nameEl.dataset.edited) {
        nameEl.value = `${edgeState.label} ${edgeIds.length}개`;
      }
      return;
    }

    // 3) Face 선택됨 — 기존 로직
    if (emptyEl) emptyEl.style.display = 'none';
    if (contentEl) contentEl.style.display = '';

    if (xiPanel && !xiPanel.classList.contains('open')) {
      xiPanel.classList.add('open');
    }

    // Rust에서 XIA 정보 가져오기
    const info = bridge.getXiaInfo(faceIds);

    // ID & Name
    const idEl = document.getElementById('xi-id');
    const nameEl = document.getElementById('xi-name') as HTMLInputElement;
    if (idEl) idEl.textContent = `XIA-${String(nextXiaNum).padStart(4, '0')}`;

    if (info && !info.empty) {
      // ── 기하 상태 판정 (Point → Line → Face → Volume → XIA) ──
      const geoState = matLib.determineState(
        { faceCount: info.faceCount || 0, edgeCount: info.edgeCount || 0, isSolid: info.isSolid || false, height: info.height || 0 },
        faceIds
      );
      const stateInfo = GEOMETRY_STATES[geoState];

      updateStateSteps(geoState);

      // 상태 표시
      const dotEl = document.getElementById('xi-solid-dot');
      const labelEl = document.getElementById('xi-solid-label');
      const subEl = document.getElementById('xi-solid-sub');
      const shapeEl = document.getElementById('xi-shape-type');

      if (dotEl) dotEl.className = 'xi-solid-dot ' + geoState;
      if (labelEl) labelEl.textContent = `${stateInfo.icon} ${stateInfo.labelEn}`;

      // Boundary extraction 결과 상세 표시
      // - Closed solid: "L×W×H (3D solid)"
      // - Has boundary: "Open: N boundary edges"
      // - Non-manifold: "Defect: N non-manifold edges"
      let subText = stateInfo.description;
      if (info.isSolid) {
        subText = `✓ Closed solid (${info.interiorEdges ?? 0} manifold edges)`;
      } else if ((info.boundaryEdges ?? 0) > 0) {
        subText = `⚠ Open — ${info.boundaryEdges} boundary edges`;
      } else if ((info.nonManifoldEdges ?? 0) > 0) {
        subText = `✗ Non-manifold — ${info.nonManifoldEdges} defect edges`;
      }
      if (subEl) subEl.textContent = subText;
      if (shapeEl) shapeEl.textContent = `\u25a1 ${info.shapeType || ''}`;

      // 기하학적 속성 — mm 단위
      const lengthEl = document.getElementById('xi-length');
      const widthEl = document.getElementById('xi-width');
      const heightEl = document.getElementById('xi-height');
      if (lengthEl) lengthEl.textContent = formatNum(info.length || 0);
      if (widthEl) widthEl.textContent = formatNum(info.width || 0);
      if (heightEl) heightEl.textContent = formatNum(info.height || 0);

      // 면적 mm² → m²
      const areaEl = document.getElementById('xi-area');
      const areaM2 = (info.surfaceArea || 0) / 1e6;
      if (areaEl) areaEl.textContent = formatNum(areaM2, 1);

      // 부피/무게: Volume 이상만 표시
      const volBox = document.getElementById('xi-volume')?.closest('.xi-computed-box') as HTMLElement | null;
      const weightBox = document.getElementById('xi-weight')?.closest('.xi-computed-box') as HTMLElement | null;

      if (geoState === GeometryState.Volume) {
        if (volBox) volBox.style.display = '';
        if (weightBox) weightBox.style.display = '';

        const volEl = document.getElementById('xi-volume');
        const volM3 = (info.volume || 0) / 1e9;
        if (volEl) volEl.textContent = formatNum(volM3, 1);

        currentVolumeMM3 = info.volume || 0;
      } else {
        if (volBox) volBox.style.display = 'none';
        if (weightBox) weightBox.style.display = 'none';
        currentVolumeMM3 = 0;
      }

      // 물리적 속성 섹션: Volume/Xia에서만 Material 드롭다운 활성화
      const physSection = document.getElementById('xi-physical-section');
      if (physSection) {
        if (geoState === GeometryState.Volume) {
          physSection.style.display = '';
          physSection.style.opacity = '1';
          physSection.style.pointerEvents = '';
        } else {
          physSection.style.display = '';
          physSection.style.opacity = '0.35';
          physSection.style.pointerEvents = 'none';
        }
      }

      // 재질 상태 반영
      const commonMat = matLib.getCommonMaterial(faceIds);
      if (matSelect) {
        matSelect.value = commonMat ? commonMat.id : '';
      }
      updatePhysicalPanel(commonMat ? commonMat.id : null);

      // 스냅 포인트
      const snapEl = document.getElementById('xi-snap-count');
      if (snapEl) snapEl.textContent = String(info.snapPoints || 0);

      // 이름 자동 설정
      if (nameEl && !nameEl.dataset.edited) {
        // Material is a property — no special "Xia" naming
        if (commonMat && commonMat.id) {
          nameEl.value = `${commonMat.name} ${info.shapeType || '객체'}`;
        } else {
          nameEl.value = `${stateInfo.label} ${info.shapeType || ''}`.trim();
        }
      }
    } else {
      const lengthEl = document.getElementById('xi-length');
      const widthEl = document.getElementById('xi-width');
      const heightEl = document.getElementById('xi-height');
      if (lengthEl) lengthEl.textContent = '-';
      if (widthEl) widthEl.textContent = '-';
      if (heightEl) heightEl.textContent = '-';
      updateStateSteps('face');
    }
  };

  // 이름 수동 편집 표시
  document.getElementById('xi-name')?.addEventListener('input', (e) => {
    (e.target as HTMLInputElement).dataset.edited = 'true';
  });

  // Selection 변경 시 Inspector 업데이트
  toolManager.selection.onChange((faces: number[]) => {
    updateInspector(faces);
    if (faces.length > 0) nextXiaNum++;
  });

  // 키보드 I → Inspector 토글
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'i' || e.key === 'I') toggleInspector();
    if (e.key === 'Escape' && xiPanel?.classList.contains('open')) xiPanel.classList.remove('open');
  });
}
