import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STYLE_PRESETS, initStylePanel, StylePanelDeps } from './StylePanel';

// Mock canvas context for jsdom
const mockCtx = {
  clearRect: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
  createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  stroke: vi.fn(), fill: vi.fn(), arc: vi.fn(),
  save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), scale: vi.fn(),
  setLineDash: vi.fn(), measureText: vi.fn().mockReturnValue({ width: 50 }),
  fillText: vi.fn(), strokeText: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
  fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '',
  textBaseline: '', globalAlpha: 1, lineCap: '', lineJoin: '',
};
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;

function createDOM(): void {
  document.body.innerHTML = `
    <div id="style-panel">
      <div id="style-panel-close">X</div>
      <div id="style-presets"></div>
      <div id="sty-controls">
        <input id="sty-front-color" type="color" value="#e8e8e8" />
        <input id="sty-back-color" type="color" value="#8899bb" />
        <input id="sty-edge-color" type="color" value="#333366" />
        <input id="sty-edge-visible" type="checkbox" checked />
        <input id="sty-profile-edge" type="checkbox" checked />
        <input id="sty-edge-profile" type="checkbox" checked />
        <input id="sty-face-opacity" type="range" min="0" max="1" step="0.05" value="1" />
        <input id="sty-bg-sky" type="color" value="#8eaac4" />
        <input id="sty-bg-ground" type="color" value="#d8dce2" />
        <select id="sty-bg-mode">
          <option value="solid">Solid</option>
          <option value="gradient2" selected>Gradient 2</option>
          <option value="gradient3">Gradient 3</option>
        </select>
        <input id="sty-grid-visible" type="checkbox" checked />
        <input id="sty-axis-visible" type="checkbox" checked />
      </div>
    </div>
    <div id="style-btn">Style</div>
  `;
}

function mockDeps(): StylePanelDeps {
  return {
    viewport: {
      setFaceColors: vi.fn(),
      setEdgeStyle: vi.fn(),
      setFaceOpacity: vi.fn(),
      updateBackground: vi.fn(),
      setGridVisible: vi.fn(),
      setAxisVisible: vi.fn(),
      setProfileEdge: vi.fn(),
      getStyleSettings: vi.fn().mockReturnValue({
        bgMode: 'gradient2',
        bgSkyColor: '#8eaac4',
        bgMidColor: '#b0c4d8',
        bgGroundColor: '#d8dce2',
        frontColor: 0xe8e8e8,
        backColor: 0x8899bb,
        edgeColor: 0x333366,
        edgeVisible: true,
        profileEdge: true,
        faceOpacity: 1.0,
        gridVisible: true,
        axisVisible: true,
      }),
    } as any,
  };
}

describe('StylePanel', () => {
  describe('STYLE_PRESETS', () => {
    it('has 11 presets (9 original + 2 architectural)', () => {
      expect(STYLE_PRESETS).toHaveLength(11);
    });

    it('includes architectural presets', () => {
      const names = STYLE_PRESETS.map(p => p.name);
      expect(names).toContain('건축 분위기');
      expect(names).toContain('야외 매스');
    });

    it('all presets have required properties', () => {
      for (const preset of STYLE_PRESETS) {
        expect(preset.name).toBeDefined();
        expect(preset.bgMode).toBeDefined();
        expect(preset.bgSkyColor).toBeDefined();
        expect(preset.bgGroundColor).toBeDefined();
        expect(typeof preset.frontColor).toBe('number');
        expect(typeof preset.backColor).toBe('number');
        expect(typeof preset.edgeColor).toBe('number');
      }
    });

    it('preset names are unique', () => {
      const names = STYLE_PRESETS.map(p => p.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('first preset is 건축 설계', () => {
      expect(STYLE_PRESETS[0].name).toBe('건축 설계');
    });

    it('dark mode preset exists', () => {
      const dark = STYLE_PRESETS.find(p => p.name === '다크 모드');
      expect(dark).toBeDefined();
      expect(dark!.bgSkyColor).toBe('#0d0d1a');
    });

    it('gradient3 preset has bgMidColor', () => {
      const sunset = STYLE_PRESETS.find(p => p.bgMode === 'gradient3');
      expect(sunset).toBeDefined();
      expect(sunset!.bgMidColor).toBeDefined();
    });
  });

  describe('initStylePanel', () => {
    let deps: ReturnType<typeof mockDeps>;

    beforeEach(() => {
      createDOM();
      deps = mockDeps();
    });

    it('does not throw when panel exists', () => {
      expect(() => initStylePanel(deps)).not.toThrow();
    });

    it('does not throw when panel is missing', () => {
      document.body.innerHTML = '';
      expect(() => initStylePanel(deps)).not.toThrow();
    });

    it('style button toggles panel open class', () => {
      initStylePanel(deps);
      const panel = document.getElementById('style-panel')!;
      const btn = document.getElementById('style-btn')!;

      btn.click();
      expect(panel.classList.contains('open')).toBe(true);

      btn.click();
      expect(panel.classList.contains('open')).toBe(false);
    });

    it('close button removes open class', () => {
      initStylePanel(deps);
      const panel = document.getElementById('style-panel')!;
      panel.classList.add('open');

      document.getElementById('style-panel-close')!.click();
      expect(panel.classList.contains('open')).toBe(false);
    });

    it('Escape closes panel', () => {
      initStylePanel(deps);
      const panel = document.getElementById('style-panel')!;
      panel.classList.add('open');

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(panel.classList.contains('open')).toBe(false);
    });
  });
});
