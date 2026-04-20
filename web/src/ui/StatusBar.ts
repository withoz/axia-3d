/**
 * StatusBar — 좌표 표시 + F-키 토글/액션 바 동기화
 *
 * 구성요소:
 *   - .sb-coords : 커서 월드 좌표 (AutoCAD 스타일, monospace)
 *   - .sb-fkey   : F1~F7 아이콘 버튼 (클릭 = 키보드 단축키와 동일 동작)
 *
 * 좌표 업데이트:
 *   - pointermove 이벤트를 캔버스에 리스너로 등록
 *   - RAF throttle — 1프레임당 1회만 DOM 업데이트 (성능)
 *   - Canvas 밖으로 나가면 마지막 값 유지 (회색 처리)
 */

import * as THREE from 'three';
import { Viewport } from '../viewport/Viewport';
import { UnitSystem } from '../units/UnitSystem';
import { toggleShortcutHelp } from './ShortcutHelpModal';
import { Toast } from './Toast';

export interface StatusBarDeps {
  viewport: Viewport;
  units: UnitSystem;
  /** Snap manager — if a snap is active, highlight coords and show snap type */
  snap: {
    enabled: boolean;
    toggle(): boolean;
    readonly lastSnap: { type: string; position: THREE.Vector3 } | null;
  };
  /** Open the settings panel (단위/정밀도 포함) */
  openSettings?: () => void;
}

export class StatusBar {
  private deps: StatusBarDeps;
  private coordsEl: HTMLElement | null;
  private metaEl: HTMLElement | null;
  private snapEl: HTMLElement | null;

  private lastWorldPos: THREE.Vector3 | null = null;
  private rafPending = false;
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private raycaster = new THREE.Raycaster();
  private _v2 = new THREE.Vector2();
  private _intersect = new THREE.Vector3();

  constructor(deps: StatusBarDeps) {
    this.deps = deps;
    this.coordsEl = document.getElementById('sb-coords');
    this.metaEl = document.getElementById('sb-meta');
    this.snapEl = document.getElementById('sb-snap');
    this.setupCoordsTracking();
    this.setupFkeyButtons();
    this.setupCbTools();
    this.updateMeta();
    // UnitSystem 변경 구독 — 단위/정밀도 변경 시 자동 반영
    this.deps.units.onChange?.(() => this.updateMeta());
  }

  // ═══════════════════════════════════════════════════
  //  Coords tracking
  // ═══════════════════════════════════════════════════

  private setupCoordsTracking(): void {
    const canvas = this.deps.viewport.renderer.domElement;
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerleave', () => this.onPointerLeave());
  }

  private onPointerMove(e: PointerEvent): void {
    // 1) 먼저 피킹으로 표면 위 좌표 시도
    let world: THREE.Vector3 | null = null;
    try {
      const hit = this.deps.viewport.pick(e.clientX, e.clientY);
      if (hit?.point) {
        world = hit.point.clone();
      }
    } catch { /* 빈 씬일 때 pick 실패 — 무시 */ }

    // 2) 아무 면도 없으면 ground plane(Y=0)에 투영
    if (!world) {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      this._v2.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(this._v2, this.deps.viewport.activeCamera as THREE.PerspectiveCamera);
      const hit = this.raycaster.ray.intersectPlane(this.plane, this._intersect);
      if (hit) world = this._intersect.clone();
    }

    if (!world) return;
    this.lastWorldPos = world;
    this.scheduleRender();
  }

  private onPointerLeave(): void {
    // 좌표 회색 처리 — 마지막 값은 유지
    if (this.coordsEl) this.coordsEl.style.opacity = '0.4';
  }

  private scheduleRender(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.renderCoords();
    });
  }

  private renderCoords(): void {
    if (!this.coordsEl || !this.lastWorldPos) return;
    const p = this.lastWorldPos;
    const fmt = (v: number) => {
      // -0.0000 방지
      const n = Math.abs(v) < 1e-7 ? 0 : v;
      return this.deps.units.format(n, /* showUnit */ false);
    };
    const snap = this.deps.snap.lastSnap ?? null;
    this.coordsEl.style.opacity = '1';
    // 스냅 prefix는 별도 span (고정폭 공간이 있어 coords 위치 불변)
    if (this.snapEl) {
      this.snapEl.textContent = snap ? `●${snap.type}` : '';
    }
    if (snap) {
      const sp = snap.position;
      this.coordsEl.classList.add('snapped');
      this.coordsEl.textContent = `${fmt(sp.x)}, ${fmt(sp.y)}, ${fmt(sp.z)}`;
    } else {
      this.coordsEl.classList.remove('snapped');
      this.coordsEl.textContent = `${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}`;
    }
  }

  // ═══════════════════════════════════════════════════
  //  F-key buttons
  // ═══════════════════════════════════════════════════

  private setupFkeyButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('.sb-fkey').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this.handleAction(action);
      });
    });
  }

  private handleAction(action: string | undefined): void {
    switch (action) {
      case 'help':
        toggleShortcutHelp();
        break;
      case 'rename': {
        const input = document.getElementById('xi-name') as HTMLInputElement | null;
        if (input && input.offsetParent !== null) {
          input.focus();
          input.select();
        } else {
          Toast.info('XIA가 선택되지 않았습니다');
        }
        break;
      }
      case 'osnap': {
        const on = this.deps.snap.toggle();
        this.setToggle('sb-fkey-osnap', on);
        Toast.info(`OSNAP ${on ? 'ON' : 'OFF'}`);
        // 레거시 상태바 표시 동기화
        const legacy = document.getElementById('stat-osnap');
        if (legacy) {
          legacy.textContent = on ? 'ON' : 'OFF';
          legacy.style.color = on ? '#44ff88' : '#ff4444';
        }
        break;
      }
      case 'grid': {
        const s = this.deps.viewport.getStyleSettings();
        const next = !s.gridVisible;
        this.deps.viewport.setGridVisible(next);
        this.setToggle('sb-fkey-grid', next);
        Toast.info(`그리드 ${next ? '표시' : '숨김'}`);
        break;
      }
      case 'home':
        this.deps.viewport.resetCamera();
        Toast.info('뷰 원점 복귀');
        break;
      case 'edge': {
        const s = this.deps.viewport.getStyleSettings();
        const next = !s.edgeVisible;
        this.deps.viewport.setEdgeStyle({ visible: next });
        this.setToggle('sb-fkey-edge', next);
        Toast.info(`엣지 ${next ? '표시' : '숨김'}`);
        break;
      }
      case 'axis': {
        const s = this.deps.viewport.getStyleSettings();
        const next = !s.axisVisible;
        this.deps.viewport.setAxisVisible(next);
        this.setToggle('sb-fkey-axis', next);
        Toast.info(`축 ${next ? '표시' : '숨김'}`);
        break;
      }
    }
  }

  /** 외부 호출용 — 키보드 단축키로 토글된 경우 상태바도 동기화 */
  setToggle(btnId: string, on: boolean): void {
    const el = document.getElementById(btnId);
    if (!el) return;
    el.classList.toggle('on', on);
  }

  /** XIA 선택 상태 변경 시 호출 — F2 버튼 활성/비활성 */
  setRenameEnabled(enabled: boolean): void {
    const btn = document.querySelector<HTMLElement>('.sb-fkey[data-action="rename"]');
    if (!btn) return;
    btn.classList.toggle('enabled', enabled);
  }

  /** 유닛/정밀도 변경 시 호출 */
  updateMeta(): void {
    if (!this.metaEl) return;
    // UnitSystem 인스턴스에서 현재 단위 라벨 + 정밀도 읽기
    // (직접 속성 접근 — API 추가 없이 공개 게터 활용)
    const anyUnits = this.deps.units as { config?: { label: string }; precision?: number };
    const unit = anyUnits.config?.label ?? 'mm';
    const prec = anyUnits.precision ?? 4;
    this.metaEl.textContent = `· ${unit} · ${prec}`;
    this.updateUnitButton();
  }

  // ═══════════════════════════════════════════════════
  //  Commandbar right-side tools (AutoCAD 스타일 유틸 아이콘)
  // ═══════════════════════════════════════════════════

  private setupCbTools(): void {
    // 단위/정밀도 버튼 → Settings 패널
    const unitBtn = document.getElementById('cb-unit-btn');
    unitBtn?.addEventListener('click', () => {
      if (this.deps.openSettings) this.deps.openSettings();
      else Toast.info('설정 패널을 열 수 없습니다');
    });

    // 설정
    const settingsBtn = document.getElementById('cb-settings');
    settingsBtn?.addEventListener('click', () => {
      if (this.deps.openSettings) this.deps.openSettings();
    });

    // 전체 화면
    const fsBtn = document.getElementById('cb-fullscreen');
    fsBtn?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {
          Toast.warning('전체화면을 지원하지 않습니다');
        });
      } else {
        document.exitFullscreen?.();
      }
    });

    // 메뉴 — 햄버거: 상단 메뉴바 첫 항목 포커스 (File 드롭다운 열기)
    const menuBtn = document.getElementById('cb-menu');
    menuBtn?.addEventListener('click', () => {
      const firstMenu = document.querySelector<HTMLElement>('.menu-item[data-menu="file"]');
      if (firstMenu) firstMenu.click();
    });
  }

  /** 단위/정밀도 변경 시 호출 — 우측 유틸 버튼의 라벨 갱신 */
  updateUnitButton(): void {
    const anyUnits = this.deps.units as { config?: { label: string }; precision?: number };
    const unit = anyUnits.config?.label ?? 'mm';
    const prec = anyUnits.precision ?? 4;
    const valEl = document.getElementById('cb-unit-val');
    const lblEl = document.getElementById('cb-unit-lbl');
    if (valEl) valEl.textContent = (0).toFixed(prec);
    if (lblEl) lblEl.textContent = unit;
  }

  /** 초기 상태를 viewport로부터 읽어와 토글 버튼에 반영 */
  syncFromViewport(): void {
    const s = this.deps.viewport.getStyleSettings();
    this.setToggle('sb-fkey-grid', s.gridVisible);
    this.setToggle('sb-fkey-edge', s.edgeVisible);
    this.setToggle('sb-fkey-axis', !!s.axisVisible);
    this.setToggle('sb-fkey-osnap', this.deps.snap.enabled);
  }
}
