/**
 * Style Side Panel — Visual style presets and customization
 *
 * Extracted from main.ts (lines 1678-1944).
 * Manages 9 style presets with canvas thumbnails and real-time color/edge/grid controls.
 */

import { Viewport } from '../viewport/Viewport';

export interface StylePreset {
  name: string;
  bgMode: 'solid' | 'gradient2' | 'gradient3';
  bgSkyColor: string;
  bgMidColor?: string;
  bgGroundColor: string;
  frontColor: number;
  backColor: number;
  edgeColor: number;
}

export const STYLE_PRESETS: StylePreset[] = [
  { name: '건축 설계', bgMode: 'gradient2', bgSkyColor: '#8eaac4', bgGroundColor: '#d8dce2', frontColor: 0xe8e8e8, backColor: 0x8899bb, edgeColor: 0x333366 },
  { name: '밝은 하늘', bgMode: 'gradient2', bgSkyColor: '#87ceeb', bgGroundColor: '#d4e6c3', frontColor: 0xf5f5f5, backColor: 0xaabbcc, edgeColor: 0x444466 },
  { name: '클래식 흰색', bgMode: 'solid', bgSkyColor: '#ffffff', bgGroundColor: '#ffffff', frontColor: 0xf0f0f0, backColor: 0xc0c8d8, edgeColor: 0x333333 },
  { name: '다크 모드', bgMode: 'gradient2', bgSkyColor: '#0d0d1a', bgGroundColor: '#000000', frontColor: 0xcccccc, backColor: 0x667788, edgeColor: 0x222244 },
  { name: '블루프린트', bgMode: 'solid', bgSkyColor: '#1a2744', bgGroundColor: '#1a2744', frontColor: 0x6688bb, backColor: 0x445577, edgeColor: 0xaaccff },
  { name: '석양', bgMode: 'gradient3', bgSkyColor: '#1a0533', bgMidColor: '#cc4422', bgGroundColor: '#ffaa44', frontColor: 0xf0e0d0, backColor: 0x997766, edgeColor: 0x553322 },
  { name: '모노크롬', bgMode: 'gradient2', bgSkyColor: '#666666', bgGroundColor: '#222222', frontColor: 0xdddddd, backColor: 0x888888, edgeColor: 0x444444 },
  { name: '따뜻한 톤', bgMode: 'gradient2', bgSkyColor: '#5c4033', bgGroundColor: '#2a1810', frontColor: 0xf0dcc8, backColor: 0xaa9080, edgeColor: 0x443322 },
  { name: '네온', bgMode: 'solid', bgSkyColor: '#0a0a14', bgGroundColor: '#0a0a14', frontColor: 0x111122, backColor: 0x0a0a16, edgeColor: 0x00ffcc },
];

export interface StylePanelDeps {
  viewport: Viewport;
}

export function initStylePanel(deps: StylePanelDeps): void {
  const { viewport } = deps;

  const stylePanel = document.getElementById('style-panel');
  const styleBtn = document.getElementById('style-btn');
  const styleClose = document.getElementById('style-panel-close');

  let activePresetIdx = 0;

  const toggleStylePanel = () => {
    if (stylePanel) {
      stylePanel.classList.toggle('open');
      if (stylePanel.classList.contains('open')) {
        renderPresets();
        syncStyleUI();
      }
    }
  };

  styleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStylePanel();
  });
  styleClose?.addEventListener('click', () => stylePanel?.classList.remove('open'));

  // Escape to close
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Escape' && stylePanel?.classList.contains('open')) {
      stylePanel.classList.remove('open');
      e.stopPropagation();
    }
  });

  // ── Render preset thumbnails ──
  const renderPresets = () => {
    const container = document.getElementById('style-presets');
    if (!container) return;
    container.innerHTML = '';

    STYLE_PRESETS.forEach((p, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'sty-preset' + (i === activePresetIdx ? ' active' : '');

      const cvs = document.createElement('canvas');
      cvs.width = 80; cvs.height = 64;
      const ctx = cvs.getContext('2d')!;

      // Background
      if (p.bgMode === 'solid') {
        ctx.fillStyle = p.bgSkyColor;
        ctx.fillRect(0, 0, 80, 64);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, 64);
        grad.addColorStop(0, p.bgSkyColor);
        if (p.bgMode === 'gradient3' && p.bgMidColor) {
          grad.addColorStop(0.5, p.bgMidColor);
        }
        grad.addColorStop(1, p.bgGroundColor);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 80, 64);
      }

      // 3D box preview
      const fc = '#' + p.frontColor.toString(16).padStart(6, '0');
      const ec = '#' + p.edgeColor.toString(16).padStart(6, '0');

      // Front face
      ctx.fillStyle = fc;
      ctx.beginPath();
      ctx.moveTo(22, 44); ctx.lineTo(22, 20); ctx.lineTo(46, 12); ctx.lineTo(46, 36); ctx.closePath();
      ctx.fill();

      // Top face
      ctx.fillStyle = fc;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(22, 20); ctx.lineTo(46, 12); ctx.lineTo(62, 18); ctx.lineTo(38, 26); ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Right face
      const bc = '#' + p.backColor.toString(16).padStart(6, '0');
      ctx.fillStyle = bc;
      ctx.beginPath();
      ctx.moveTo(46, 12); ctx.lineTo(62, 18); ctx.lineTo(62, 42); ctx.lineTo(46, 36); ctx.closePath();
      ctx.fill();

      // Edges
      ctx.strokeStyle = ec;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(22, 44); ctx.lineTo(22, 20); ctx.lineTo(46, 12); ctx.lineTo(46, 36); ctx.lineTo(22, 44);
      ctx.moveTo(22, 20); ctx.lineTo(38, 26); ctx.lineTo(62, 18); ctx.lineTo(46, 12);
      ctx.moveTo(46, 36); ctx.lineTo(62, 42); ctx.lineTo(62, 18);
      ctx.moveTo(22, 44); ctx.lineTo(38, 50); ctx.lineTo(62, 42);
      ctx.stroke();

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 0.5;
      for (let x = 10; x < 75; x += 12) {
        ctx.beginPath(); ctx.moveTo(x, 58); ctx.lineTo(x + 6, 52); ctx.stroke();
      }

      wrap.appendChild(cvs);

      const label = document.createElement('div');
      label.className = 'sty-preset-name';
      label.textContent = p.name;
      wrap.appendChild(label);

      wrap.addEventListener('click', () => {
        activePresetIdx = i;
        viewport.applyStylePreset(p);
        renderPresets();
        syncStyleUI();
      });

      container.appendChild(wrap);
    });
  };

  // ── Sync UI controls to viewport state ──
  const syncStyleUI = () => {
    const s = viewport.getStyleSettings();
    const bgMode = document.getElementById('sty-bg-mode') as HTMLSelectElement;
    if (bgMode) bgMode.value = s.bgMode;

    const setStyColor = (id: string, hex: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = hex;
    };
    setStyColor('sty-bg-sky', s.bgSkyColor);
    setStyColor('sty-bg-mid', s.bgMidColor);
    setStyColor('sty-bg-ground', s.bgGroundColor);
    setStyColor('sty-face-front', '#' + s.frontColor.toString(16).padStart(6, '0'));
    setStyColor('sty-face-back', '#' + s.backColor.toString(16).padStart(6, '0'));
    setStyColor('sty-edge-color', '#' + s.edgeColor.toString(16).padStart(6, '0'));

    // Opacity
    const opSlider = document.getElementById('sty-face-opacity') as HTMLInputElement;
    if (opSlider) opSlider.value = String(Math.round(s.faceOpacity * 100));
    const opVal = document.getElementById('sty-face-opacity-val');
    if (opVal) opVal.textContent = Math.round(s.faceOpacity * 100) + '%';

    // Edges
    (document.getElementById('sty-edge-visible') as HTMLInputElement).checked = s.edgeVisible;
    (document.getElementById('sty-edge-profile') as HTMLInputElement).checked = s.profileEdge;

    // Environment
    (document.getElementById('sty-grid-visible') as HTMLInputElement).checked = s.gridVisible;
    (document.getElementById('sty-axis-visible') as HTMLInputElement).checked = s.axisVisible;

    // Mid color row visibility
    const midRow = document.getElementById('sty-bg-mid-row');
    const groundRow = document.getElementById('sty-bg-ground-row');
    if (midRow) midRow.style.display = s.bgMode === 'gradient3' ? 'flex' : 'none';
    if (groundRow) groundRow.style.display = s.bgMode === 'solid' ? 'none' : 'flex';
  };

  // ── Event bindings ──

  // Background mode
  document.getElementById('sty-bg-mode')?.addEventListener('change', (e) => {
    const mode = (e.target as HTMLSelectElement).value as 'solid' | 'gradient2' | 'gradient3';
    viewport.updateBackground(mode);
    syncStyleUI();
  });

  // Background colors
  const bindBgColor = (id: string, param: 'sky' | 'ground' | 'mid') => {
    document.getElementById(id)?.addEventListener('input', (e) => {
      const val = (e.target as HTMLInputElement).value;
      if (param === 'sky') viewport.updateBackground(undefined, val);
      else if (param === 'ground') viewport.updateBackground(undefined, undefined, val);
      else viewport.updateBackground(undefined, undefined, undefined, val);
    });
  };
  bindBgColor('sty-bg-sky', 'sky');
  bindBgColor('sty-bg-ground', 'ground');
  bindBgColor('sty-bg-mid', 'mid');

  // Face colors
  document.getElementById('sty-face-front')?.addEventListener('input', (e) => {
    const hex = parseInt((e.target as HTMLInputElement).value.replace('#', ''), 16);
    viewport.setFaceColors(hex, undefined);
  });
  document.getElementById('sty-face-back')?.addEventListener('input', (e) => {
    const hex = parseInt((e.target as HTMLInputElement).value.replace('#', ''), 16);
    viewport.setFaceColors(undefined, hex);
  });

  // Opacity
  document.getElementById('sty-face-opacity')?.addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value);
    viewport.setFaceOpacity(val / 100);
    const label = document.getElementById('sty-face-opacity-val');
    if (label) label.textContent = val + '%';
  });

  // Edge color
  document.getElementById('sty-edge-color')?.addEventListener('input', (e) => {
    const hex = parseInt((e.target as HTMLInputElement).value.replace('#', ''), 16);
    viewport.setEdgeStyle({ color: hex });
  });

  // Edge width — Line2 linewidth (CSS px)
  document.getElementById('sty-edge-width')?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    const label = document.getElementById('sty-edge-width-val');
    if (label) label.textContent = val;
    const w = parseFloat(val);
    if (Number.isFinite(w)) viewport.setEdgeStyle({ width: w });
  });

  // Edge visibility
  document.getElementById('sty-edge-visible')?.addEventListener('change', (e) => {
    viewport.setEdgeStyle({ visible: (e.target as HTMLInputElement).checked });
  });
  document.getElementById('sty-edge-profile')?.addEventListener('change', (e) => {
    viewport.setEdgeStyle({ profileEdge: (e.target as HTMLInputElement).checked });
  });

  // Grid / Axis
  document.getElementById('sty-grid-visible')?.addEventListener('change', (e) => {
    viewport.setGridVisible((e.target as HTMLInputElement).checked);
  });
  document.getElementById('sty-axis-visible')?.addEventListener('change', (e) => {
    viewport.setAxisVisible((e.target as HTMLInputElement).checked);
  });

  // Grid color
  document.getElementById('sty-grid-color')?.addEventListener('input', (e) => {
    const hex = parseInt((e.target as HTMLInputElement).value.replace('#', ''), 16);
    viewport.setGridColor(hex);
  });
}
