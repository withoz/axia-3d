/**
 * ScenesManager — 저장된 뷰(카메라 상태) 관리. SketchUp "Scenes" 대응.
 *
 * 기능 (MVP):
 *   · 현재 카메라 상태(position, target, zoom, view mode) + section 설정을
 *     "Scene"으로 저장
 *   · Scene 목록 UI — 이름 수정 / 삭제 / 클릭으로 복원
 *   · localStorage persistence (프로젝트 간 수명은 파일 포맷 저장으로 별도)
 *
 * 한계:
 *   · 씬이 저장하는 건 뷰 상태만 — 객체 hidden 상태나 style override는 미포함
 *   · 트랜지션 애니메이션 없음 (즉시 스냅)
 */

import * as THREE from 'three';
import type { Viewport } from '../viewport/Viewport';
import type { SectionPlane, SectionAxis } from '../viewport/SectionPlane';

export interface SceneSnapshot {
  id: string;
  name: string;
  camMode: 'perspective' | 'ortho';
  camPos: [number, number, number];
  camTarget: [number, number, number];
  orthoZoom: number;
  section: { axis: SectionAxis; position: number; flipped: boolean };
}

export class ScenesManager {
  private viewport: Viewport;
  private sectionPlane: SectionPlane | null;
  private scenes: SceneSnapshot[] = [];
  private panelEl: HTMLElement;
  private visible = false;

  constructor(container: HTMLElement, viewport: Viewport, sectionPlane: SectionPlane | null) {
    this.viewport = viewport;
    this.sectionPlane = sectionPlane;

    this.panelEl = document.createElement('div');
    this.panelEl.id = 'scenes-panel';
    this.panelEl.className = 'scenes-panel';
    this.panelEl.style.display = 'none';
    container.appendChild(this.panelEl);

    this.injectStyles();
    this.loadFromStorage();
    this.render();
  }

  show(): void { this.visible = true; this.panelEl.style.display = 'block'; this.render(); }
  hide(): void { this.visible = false; this.panelEl.style.display = 'none'; }
  toggle(): void { this.visible ? this.hide() : this.show(); }
  isVisible(): boolean { return this.visible; }

  // ───────────────────────────────────────────────────────────

  captureCurrent(name?: string): SceneSnapshot {
    const cam = this.viewport.activeCamera;
    const mode = (cam as THREE.OrthographicCamera).isOrthographicCamera ? 'ortho' : 'perspective';
    // Controls target — if OrbitControls present use its target, else fallback.
    // Pulling from viewport.controls.target (OrbitControls standard property).
    const ctl = (this.viewport as unknown as {
      controls?: { target?: THREE.Vector3 };
    }).controls;
    const target = ctl?.target ?? new THREE.Vector3(0, 0, 0);
    const orthoZoom = (cam as THREE.OrthographicCamera).zoom ?? 1;

    const section = this.sectionPlane?.getState() ?? {
      axis: 'off' as SectionAxis, position: 0, flipped: false,
    };

    const snap: SceneSnapshot = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name: name ?? `Scene ${this.scenes.length + 1}`,
      camMode: mode,
      camPos: [cam.position.x, cam.position.y, cam.position.z],
      camTarget: [target.x, target.y, target.z],
      orthoZoom,
      section,
    };
    this.scenes.push(snap);
    this.saveToStorage();
    this.render();
    return snap;
  }

  restore(id: string): void {
    const s = this.scenes.find(sc => sc.id === id);
    if (!s) return;
    const cam = this.viewport.activeCamera;
    cam.position.set(...s.camPos);
    const ctl = (this.viewport as unknown as {
      controls?: { target?: THREE.Vector3; update?: () => void };
    }).controls;
    if (ctl?.target) ctl.target.set(...s.camTarget);
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      (cam as THREE.OrthographicCamera).zoom = s.orthoZoom;
      (cam as THREE.OrthographicCamera).updateProjectionMatrix();
    }
    cam.lookAt(...s.camTarget);
    ctl?.update?.();

    if (this.sectionPlane) {
      this.sectionPlane.setAxis(s.section.axis);
      this.sectionPlane.setPosition(s.section.position);
      this.sectionPlane.setFlipped(s.section.flipped);
    }
  }

  rename(id: string, newName: string): void {
    const s = this.scenes.find(sc => sc.id === id);
    if (s) { s.name = newName; this.saveToStorage(); this.render(); }
  }

  remove(id: string): void {
    this.scenes = this.scenes.filter(s => s.id !== id);
    this.saveToStorage();
    this.render();
  }

  // ───────────────────────────────────────────────────────────

  private render(): void {
    this.panelEl.innerHTML = `
      <div class="sc-header">
        <span>🎬 Scenes (${this.scenes.length})</span>
        <div>
          <button class="sc-add" title="현재 뷰 저장">+ 추가</button>
          <button class="sc-close" title="닫기">×</button>
        </div>
      </div>
      <div class="sc-list">
        ${this.scenes.length === 0
          ? '<div class="sc-empty">저장된 Scene 없음. "+ 추가"로 현재 뷰 캡처.</div>'
          : this.scenes.map(s => `
              <div class="sc-item" data-id="${s.id}">
                <span class="sc-name" title="클릭하여 복원">${escape(s.name)}</span>
                <div class="sc-item-act">
                  <button class="sc-rename" title="이름 변경">✎</button>
                  <button class="sc-del" title="삭제">×</button>
                </div>
              </div>
            `).join('')}
      </div>
    `;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.panelEl.querySelector('.sc-close')?.addEventListener('click', () => this.hide());
    this.panelEl.querySelector('.sc-add')?.addEventListener('click', () => {
      const name = prompt('Scene 이름', `Scene ${this.scenes.length + 1}`);
      if (!name) return;
      this.captureCurrent(name);
    });
    this.panelEl.querySelectorAll('.sc-item').forEach(el => {
      const id = (el as HTMLElement).dataset.id!;
      el.querySelector('.sc-name')?.addEventListener('click', () => this.restore(id));
      el.querySelector('.sc-rename')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = this.scenes.find(s => s.id === id);
        if (!cur) return;
        const newName = prompt('새 이름', cur.name);
        if (newName) this.rename(id, newName);
      });
      el.querySelector('.sc-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('이 Scene을 삭제할까요?')) this.remove(id);
      });
    });
  }

  private saveToStorage(): void {
    try { localStorage.setItem('axia:scenes', JSON.stringify(this.scenes)); }
    catch { /* ignore */ }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem('axia:scenes');
      if (raw) this.scenes = JSON.parse(raw);
    } catch { this.scenes = []; }
  }

  private injectStyles(): void {
    if (document.getElementById('scenes-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'scenes-panel-styles';
    style.textContent = `
      .scenes-panel { position: fixed; right: 8px; top: 400px; width: 240px;
        background: rgba(24,24,32,.95); color: #ddd; border: 1px solid #444;
        border-radius: 6px; padding: 8px; font: 13px -apple-system, sans-serif; z-index: 1500; }
      .sc-header { display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #333; font-weight: 600; }
      .sc-add { background: #3a97ff; color: #fff; border: 0; padding: 3px 8px;
        border-radius: 3px; font-size: 11px; cursor: pointer; margin-right: 4px; }
      .sc-close { background: transparent; color: #888; border: 0; font-size: 16px; cursor: pointer; }
      .sc-list { max-height: 240px; overflow-y: auto; }
      .sc-empty { color: #777; font-size: 11px; padding: 10px; text-align: center; }
      .sc-item { display: flex; justify-content: space-between; align-items: center;
        padding: 4px 6px; border-bottom: 1px solid #2a2a30; }
      .sc-item:hover { background: rgba(58,151,255,.1); }
      .sc-name { cursor: pointer; flex: 1; font-size: 12px; }
      .sc-name:hover { color: #7cb8ff; }
      .sc-item-act button { background: transparent; color: #888; border: 0;
        padding: 2px 4px; cursor: pointer; font-size: 11px; }
      .sc-item-act button:hover { color: #fff; }
    `;
    document.head.appendChild(style);
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
