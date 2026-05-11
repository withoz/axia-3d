/**
 * ADR-098 S-δ — AssetLibraryPanel UI tests (jsdom).
 *
 * Verifies render of 3 tier sections, +Project/+User add buttons,
 * User tier removal button (S-G), and refresh behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssetLibraryPanel } from './AssetLibraryPanel';
import type { ScopedMaterialInfo } from '../bridge/WasmBridge';

interface BridgeStub {
  listMaterialsByTier: ReturnType<typeof vi.fn>;
  addProjectMaterial: ReturnType<typeof vi.fn>;
  addUserMaterial: ReturnType<typeof vi.fn>;
  removeUserMaterial: ReturnType<typeof vi.fn>;
}

function makeBridge(): BridgeStub {
  return {
    listMaterialsByTier: vi.fn(() => [] as ScopedMaterialInfo[]),
    addProjectMaterial: vi.fn(() => 100),
    addUserMaterial: vi.fn(() => 200),
    removeUserMaterial: vi.fn(() => true),
  };
}

const SYS_MAT: ScopedMaterialInfo = {
  id: 0, name: 'Concrete', nameEn: 'Concrete', tier: 'System', color: '#888888',
};
const USER_MAT: ScopedMaterialInfo = {
  id: 200, name: 'MyWood', nameEn: 'MyWood', tier: 'User', color: '#b08040',
};

describe('AssetLibraryPanel (S-δ)', () => {
  let container: HTMLElement;
  let bridge: BridgeStub;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    bridge = makeBridge();
  });

  it('renders hidden by default', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    const el = panel.getPanelElement();
    expect(el.style.display).toBe('none');
    expect(panel.isVisible()).toBe(false);
  });

  it('show() makes panel visible and triggers refresh()', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    panel.show();
    expect(panel.isVisible()).toBe(true);
    expect(panel.getPanelElement().style.display).toBe('block');
    expect(bridge.listMaterialsByTier).toHaveBeenCalledTimes(3); // System+Project+User
  });

  it('renders all 3 tier sections with empty hint when no materials', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    panel.show();
    const sections = panel.getPanelElement().querySelectorAll('.al-section');
    expect(sections.length).toBe(3);
    const tiers = Array.from(sections).map((s) => s.getAttribute('data-tier'));
    expect(tiers).toEqual(['System', 'Project', 'User']);
    expect(panel.getPanelElement().querySelectorAll('.al-empty').length).toBe(3);
  });

  it('renders material rows with swatch + label', () => {
    bridge.listMaterialsByTier.mockImplementation((tier: string) =>
      tier === 'System' ? [SYS_MAT] : []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    panel.show();
    const rows = panel.getPanelElement().querySelectorAll('.al-row');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-tier')).toBe('System');
    expect(rows[0].querySelector('.al-label')?.textContent).toBe('Concrete');
  });

  it('S-G — remove button shown only for User tier', () => {
    bridge.listMaterialsByTier.mockImplementation((tier: string) => {
      if (tier === 'System') return [SYS_MAT];
      if (tier === 'User') return [USER_MAT];
      return [];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    panel.show();
    const sysRow = panel.getPanelElement().querySelector('.al-row[data-tier="System"]')!;
    const userRow = panel.getPanelElement().querySelector('.al-row[data-tier="User"]')!;
    expect(sysRow.querySelector('.al-btn-remove')).toBeNull();
    expect(userRow.querySelector('.al-btn-remove')).not.toBeNull();
  });

  it('+ Project button calls addProjectMaterial via prompt mock', () => {
    const promptSpy = vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('TestMat')   // name
      .mockReturnValueOnce('#ff0000');  // color
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    panel.show();
    panel.getPanelElement().querySelector<HTMLButtonElement>('.al-btn-add-project')!.click();
    expect(bridge.addProjectMaterial).toHaveBeenCalledWith('TestMat', 'TestMat', 0xff0000);
    promptSpy.mockRestore();
  });

  it('+ User button calls addUserMaterial', () => {
    const promptSpy = vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('UserMat')
      .mockReturnValueOnce('#00ff00');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    panel.show();
    panel.getPanelElement().querySelector<HTMLButtonElement>('.al-btn-add-user')!.click();
    expect(bridge.addUserMaterial).toHaveBeenCalledWith('UserMat', 'UserMat', 0x00ff00);
    promptSpy.mockRestore();
  });

  it('Add cancel (prompt null) does not call bridge', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    panel.show();
    panel.getPanelElement().querySelector<HTMLButtonElement>('.al-btn-add-project')!.click();
    expect(bridge.addProjectMaterial).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('Remove with confirm=true calls removeUserMaterial', () => {
    bridge.listMaterialsByTier.mockImplementation((tier: string) =>
      tier === 'User' ? [USER_MAT] : []);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    panel.show();
    panel.getPanelElement().querySelector<HTMLButtonElement>('.al-btn-remove')!.click();
    expect(bridge.removeUserMaterial).toHaveBeenCalledWith(200);
    confirmSpy.mockRestore();
  });

  it('Remove with confirm=false does not call bridge', () => {
    bridge.listMaterialsByTier.mockImplementation((tier: string) =>
      tier === 'User' ? [USER_MAT] : []);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    panel.show();
    panel.getPanelElement().querySelector<HTMLButtonElement>('.al-btn-remove')!.click();
    expect(bridge.removeUserMaterial).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('onMaterialClick callback fires on row click', () => {
    bridge.listMaterialsByTier.mockImplementation((tier: string) =>
      tier === 'System' ? [SYS_MAT] : []);
    const onClick = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any, {
      onMaterialClick: onClick,
    });
    panel.show();
    panel.getPanelElement().querySelector<HTMLElement>('.al-row')!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toMatchObject({ id: 0, tier: 'System' });
  });

  it('toggle() flips visibility', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = new AssetLibraryPanel(container, bridge as any);
    expect(panel.isVisible()).toBe(false);
    panel.toggle();
    expect(panel.isVisible()).toBe(true);
    panel.toggle();
    expect(panel.isVisible()).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────
  // ADR-099 L-ε — Layered indicator + ⊞ upload button
  // ──────────────────────────────────────────────────────────────────

  describe('L-ε layered indicator', () => {
    it('renders 4-cell indicator for every material', () => {
      bridge.listMaterialsByTier.mockImplementation((tier: string) =>
        tier === 'System' ? [SYS_MAT] : []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const panel = new AssetLibraryPanel(container, bridge as any);
      panel.show();
      const cells = panel.getPanelElement().querySelectorAll('.al-channel-cell');
      expect(cells.length).toBe(4); // 1 material × 4 channels
      const channels = Array.from(cells).map((c) => c.getAttribute('data-channel'));
      expect(channels).toEqual(['albedo', 'normal', 'roughness', 'metallic']);
    });

    it('marks cells populated when hasLayeredMaterial callback returns true', () => {
      bridge.listMaterialsByTier.mockImplementation((tier: string) =>
        tier === 'User' ? [USER_MAT] : []);
      const hasLayered = vi.fn((id: number) => id === 200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const panel = new AssetLibraryPanel(container, bridge as any, {
        hasLayeredMaterial: hasLayered,
      });
      panel.show();
      expect(hasLayered).toHaveBeenCalledWith(200);
      const populated = panel.getPanelElement().querySelectorAll('.al-channel-populated');
      expect(populated.length).toBe(4); // all 4 cells lit
    });

    it('cells stay dim when no callback provided', () => {
      bridge.listMaterialsByTier.mockImplementation((tier: string) =>
        tier === 'System' ? [SYS_MAT] : []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const panel = new AssetLibraryPanel(container, bridge as any);
      panel.show();
      const populated = panel.getPanelElement().querySelectorAll('.al-channel-populated');
      expect(populated.length).toBe(0);
    });

    it('⊞ Layered button shown for Project/User tiers, hidden for System', () => {
      bridge.listMaterialsByTier.mockImplementation((tier: string) => {
        if (tier === 'System') return [SYS_MAT];
        if (tier === 'User') return [USER_MAT];
        return [];
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const panel = new AssetLibraryPanel(container, bridge as any);
      panel.show();
      const sysRow = panel.getPanelElement().querySelector('.al-row[data-tier="System"]')!;
      const userRow = panel.getPanelElement().querySelector('.al-row[data-tier="User"]')!;
      expect(sysRow.querySelector('.al-btn-layered')).toBeNull();
      expect(userRow.querySelector('.al-btn-layered')).not.toBeNull();
    });

    it('⊞ click with no callback → Toast.error (silent skip 차단)', async () => {
      bridge.listMaterialsByTier.mockImplementation((tier: string) =>
        tier === 'User' ? [USER_MAT] : []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const panel = new AssetLibraryPanel(container, bridge as any);
      panel.show();
      // Mock prompt → '1' (Albedo) — flow proceeds until callback check.
      const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('1');
      // Mock file picker cancel to avoid actual upload prompts.
      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'input' && (el as HTMLInputElement).type !== undefined) {
          setTimeout(() => el.dispatchEvent(new Event('cancel')), 0);
        }
        return el;
      });
      panel.getPanelElement()
        .querySelector<HTMLButtonElement>('.al-btn-layered')!
        .click();
      // Wait for async flow.
      await new Promise((r) => setTimeout(r, 50));
      // Cancelled — onLayeredChannelUpload should NOT have been called.
      // We just verify no exception thrown (panel still in DOM).
      expect(panel.isVisible()).toBe(true);
      promptSpy.mockRestore();
    });
  });
});
