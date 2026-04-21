/**
 * ShortcutHelpModal — F1 도움말 치트시트
 *
 * 앱의 모든 키보드 단축키를 테이블로 정리해 모달로 표시.
 * ESC 또는 배경 클릭으로 닫히며, 다시 F1을 누르면 토글.
 */

const MODAL_ID = 'shortcut-help-modal';

interface ShortcutRow {
  key: string;
  description: string;
}

interface ShortcutSection {
  title: string;
  rows: ShortcutRow[];
}

const SECTIONS: ShortcutSection[] = [
  {
    title: '도구',
    rows: [
      { key: 'V', description: 'Select (선택)' },
      { key: 'L', description: 'Line (선)' },
      { key: 'R', description: 'Rect (사각형)' },
      { key: 'C', description: 'Circle (원)' },
      { key: 'A', description: 'Arc (호)' },
      { key: 'G', description: 'Polygon (다각형)' },
      { key: 'P', description: 'Push/Pull' },
      { key: 'H', description: 'Sphere (구)' },
      { key: 'Y', description: 'Cylinder (원통)' },
      { key: 'N', description: 'Cone (원뿔)' },
      { key: 'M', description: 'Move (이동)' },
      { key: 'Q', description: 'Rotate (회전)' },
      { key: 'O', description: 'Offset' },
      { key: 'E', description: 'Erase (지우기)' },
      { key: 'X', description: 'Split' },
      { key: 'U', description: 'Measure Tool (2점 거리 / 3점 각도)' },
      { key: 'Space', description: 'Select 도구로 복귀' },
    ],
  },
  {
    title: '편집',
    rows: [
      { key: 'Ctrl+Z', description: 'Undo (되돌리기)' },
      { key: 'Ctrl+Y', description: 'Redo (다시 실행)' },
      { key: 'Ctrl+A', description: 'Select All (전체 선택)' },
      { key: 'Ctrl+S', description: '프로젝트 저장' },
      { key: 'Ctrl+O', description: '프로젝트 열기' },
      { key: 'Ctrl+G', description: '그룹 만들기' },
      { key: 'Ctrl+Shift+G', description: '그룹 해제' },
      { key: 'Ctrl+M', description: '재질 패널' },
      { key: 'Delete', description: '삭제' },
      { key: 'Esc', description: '취소 / 선택 해제' },
      { key: 'F2', description: '선택 XIA 이름 변경' },
      { key: 'Shift+N', description: 'Face Reverse (면 뒤집기)' },
    ],
  },
  {
    title: '보기 / 화면',
    rows: [
      { key: 'F1', description: '이 도움말' },
      { key: 'F3', description: 'OSNAP 토글' },
      { key: 'F4', description: '그리드 표시/숨김' },
      { key: 'F5', description: '뷰 원점 복귀 (카메라 리셋)' },
      { key: 'F6', description: '엣지 표시/숨김' },
      { key: 'F7', description: '축 표시/숨김' },
      { key: '`', description: '그리드 표시/숨김 (대체)' },
      { key: 'T / B', description: 'Top / Bottom 뷰' },
      { key: 'F / K', description: 'Front / Back 뷰' },
      { key: 'Num 0', description: '3D 투시 뷰' },
    ],
  },
  {
    title: '스냅 / 축',
    rows: [
      { key: 'Tab', description: 'Tentative snap 순환' },
      { key: 'K', description: 'Inference Lock (스냅 고정)' },
      { key: '→', description: 'X축 고정' },
      { key: '↑', description: 'Y축 고정' },
      { key: '←', description: 'Z축 고정' },
      { key: '↓', description: '축 고정 해제' },
      { key: 'Alt+E', description: 'Endpoint 스냅 토글' },
      { key: 'Alt+M', description: 'Midpoint 스냅 토글' },
      { key: 'Alt+I', description: 'Intersection 스냅 토글' },
      { key: 'Alt+C', description: 'Center 스냅 토글' },
      { key: 'Alt+P', description: 'Perpendicular 스냅 토글' },
      { key: 'Alt+L', description: 'Parallel 스냅 토글' },
      { key: 'Alt+F', description: 'OnFace 스냅 토글' },
      { key: 'Alt+G', description: 'Grid 스냅 토글' },
      { key: 'Alt+N', description: 'Nearest 스냅 토글' },
    ],
  },
  {
    title: '패널',
    rows: [
      { key: 'I', description: 'XIA Inspector' },
      { key: 'O', description: 'Outliner (컴포넌트 패널)' },
      { key: 'J', description: 'Constraint 패널' },
      { key: 'Shift+H', description: '작업 기록 패널 (Parametric History)' },
    ],
  },
  {
    title: '스케치 / 선택',
    rows: [
      { key: 'Alt+엣지 클릭', description: '폴리라인 체인 자동 선택 (Loop Select)' },
      { key: '메뉴 → ✏️', description: 'Sketch 모드 시작 (XZ 바닥 / XY 정면 / YZ 측면 / 선택 면)' },
      { key: '메뉴 → 스케치 종료', description: '닫힌 프로필 자동 감지 → 높이 prompt → Push/Pull' },
      { key: '🎨 Quick Color', description: '우클릭 → 색상 지정 (선택 면에 즉석 커스텀 material)' },
    ],
  },
];

function buildModalHtml(): string {
  const columns = SECTIONS.map(sec => `
    <div class="sh-section">
      <h3>${sec.title}</h3>
      <table>
        ${sec.rows.map(r => `
          <tr>
            <td class="sh-key"><kbd>${r.key}</kbd></td>
            <td class="sh-desc">${r.description}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `).join('');

  return `
    <div class="sh-modal-overlay">
      <div class="sh-modal">
        <div class="sh-header">
          <h2>AXiA 3D 키보드 단축키</h2>
          <button class="sh-close" aria-label="Close">✕</button>
        </div>
        <div class="sh-grid">${columns}</div>
        <div class="sh-footer">F1로 다시 열기 · Esc로 닫기</div>
      </div>
    </div>
  `;
}

function injectStyleOnce(): void {
  if (document.getElementById('sh-modal-style')) return;
  const style = document.createElement('style');
  style.id = 'sh-modal-style';
  style.textContent = `
    .sh-modal-overlay {
      position: fixed; inset: 0; z-index: 100000;
      background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .sh-modal {
      background: #1e1e1e; color: #ddd; border: 1px solid #444; border-radius: 8px;
      max-width: 1100px; max-height: 86vh; overflow: auto;
      padding: 20px 24px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    .sh-header { display: flex; justify-content: space-between; align-items: center;
      padding-bottom: 8px; border-bottom: 1px solid #333; margin-bottom: 12px; }
    .sh-header h2 { margin: 0; font-size: 16px; color: #fff; font-weight: 600; }
    .sh-close { background: transparent; color: #aaa; border: none; font-size: 18px;
      cursor: pointer; padding: 4px 10px; border-radius: 4px; }
    .sh-close:hover { background: #333; color: #fff; }
    .sh-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px 30px; }
    .sh-section h3 { margin: 0 0 6px; font-size: 12px; color: #7fc7ff; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px; }
    .sh-section table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .sh-section td { padding: 3px 6px 3px 0; vertical-align: middle; }
    .sh-key { width: 90px; text-align: left; white-space: nowrap; }
    .sh-key kbd { background: #2a2a2a; border: 1px solid #4a4a4a; border-radius: 3px;
      padding: 1px 6px; font-family: 'Consolas', monospace; font-size: 11px; color: #fff; }
    .sh-desc { color: #bbb; }
    .sh-footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid #333;
      font-size: 11px; color: #888; text-align: center; }
  `;
  document.head.appendChild(style);
}

/** F1에서 호출 — 모달 열림/닫힘 토글. */
export function toggleShortcutHelp(): void {
  const existing = document.getElementById(MODAL_ID);
  if (existing) {
    existing.remove();
    return;
  }
  injectStyleOnce();
  const container = document.createElement('div');
  container.id = MODAL_ID;
  container.innerHTML = buildModalHtml();

  const overlay = container.querySelector('.sh-modal-overlay') as HTMLElement;
  const closeBtn = container.querySelector('.sh-close') as HTMLElement;

  const close = () => container.remove();
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  document.body.appendChild(container);
}

/** 모달이 열려 있으면 닫고 true 반환 (ESC 핸들러에서 사용). */
export function closeShortcutHelpIfOpen(): boolean {
  const existing = document.getElementById(MODAL_ID);
  if (existing) {
    existing.remove();
    return true;
  }
  return false;
}
