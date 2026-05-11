/**
 * OSNAP Settings Panel — Drafting snap mode configuration
 *
 * Extracted from main.ts (lines 1298-1417).
 * Manages snap mode checkboxes, master toggle, marker size slider, and preview.
 */

import { SnapManager, SnapType } from '../snap/SnapManager';
import { SnapVisual } from '../snap/SnapVisual';

export interface OsnapPanelDeps {
  snap: SnapManager;
  snapVisual: SnapVisual;
  /** Callback to update OSNAP status bar UI */
  updateOsnapUI: () => void;
}

export interface OsnapPanelAPI {
  /** Open the OSNAP settings panel */
  openOsnapPanel: () => void;
}

export function initOsnapPanel(deps: OsnapPanelDeps): OsnapPanelAPI {
  const { snap, snapVisual, updateOsnapUI } = deps;

  const osnapPanel = document.getElementById('osnap-panel');
  if (!osnapPanel) return { openOsnapPanel: () => {} };

  const masterCheck = document.getElementById('osnap-master') as HTMLInputElement;
  const modeChecks = osnapPanel.querySelectorAll<HTMLInputElement>('input[data-mode]');

  // Sync HTML checked state to JS on app start
  modeChecks.forEach(cb => {
    const mode = cb.dataset.mode;
    if (mode) snap.setMode(mode as SnapType, cb.checked);
  });

  // Open panel
  const openOsnapPanel = () => {
    if (masterCheck) masterCheck.checked = snap.enabled;
    modeChecks.forEach(cb => {
      const mode = cb.dataset.mode;
      if (mode) cb.checked = snap.isActive(mode as SnapType);
    });
    // Remove DraggablePanelManager's state-hidden (has !important)
    osnapPanel.classList.remove('state-hidden');
    osnapPanel.classList.add('visible');
  };

  // Close panel
  const closeOsnapPanel = () => {
    osnapPanel.classList.remove('visible');
    osnapPanel.classList.add('state-hidden');
  };

  // Apply settings immediately (CAD style)
  const applySnapSettings = () => {
    snap.enabled = masterCheck?.checked ?? true;
    modeChecks.forEach(cb => {
      const mode = cb.dataset.mode;
      if (mode) snap.setMode(mode as SnapType, cb.checked);
    });
    const slider = document.getElementById('osnap-size-slider') as HTMLInputElement;
    if (slider) {
      snapVisual.setMarkerSize(parseInt(slider.value));
    }
    updateOsnapUI();
  };

  // Master checkbox
  if (masterCheck) {
    masterCheck.addEventListener('change', applySnapSettings);
  }

  // Mode checkboxes
  modeChecks.forEach(cb => {
    cb.addEventListener('change', applySnapSettings);
  });

  // OK button
  document.getElementById('osnap-ok')?.addEventListener('click', () => {
    applySnapSettings();
    closeOsnapPanel();
  });

  // Cancel / Close
  document.getElementById('osnap-cancel')?.addEventListener('click', closeOsnapPanel);
  document.getElementById('osnap-panel-close')?.addEventListener('click', closeOsnapPanel);

  // Select all
  document.getElementById('osnap-select-all')?.addEventListener('click', () => {
    modeChecks.forEach(cb => cb.checked = true);
    applySnapSettings();
  });

  // Clear all
  document.getElementById('osnap-clear-all')?.addEventListener('click', () => {
    modeChecks.forEach(cb => cb.checked = false);
    applySnapSettings();
  });

  // ── Marker size slider + preview ──
  const sizeSlider = document.getElementById('osnap-size-slider') as HTMLInputElement;
  const sizePreview = document.getElementById('osnap-size-preview') as HTMLCanvasElement;

  const drawSizePreview = (halfSize: number) => {
    if (!sizePreview) return;
    const ctx = sizePreview.getContext('2d')!;
    const w = sizePreview.width, h = sizePreview.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    // Red square (endpoint marker preview)
    const cx = w / 2, cy = h / 2;
    ctx.strokeStyle = '#FF3333';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - halfSize, cy - halfSize, halfSize * 2, halfSize * 2);
  };

  if (sizeSlider) {
    drawSizePreview(parseInt(sizeSlider.value));
    sizeSlider.addEventListener('input', () => {
      drawSizePreview(parseInt(sizeSlider.value));
    });
  }

  // Sync slider when panel opens
  const openOsnapPanelWithSize = () => {
    openOsnapPanel();
    if (sizeSlider) {
      sizeSlider.value = String(snapVisual?.getMarkerSize() ?? 8);
      drawSizePreview(parseInt(sizeSlider.value));
    }
  };

  // ESC to close
  osnapPanel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOsnapPanel();
  });

  // Status bar double-click to open
  const osnapToggle = document.getElementById('osnap-toggle');
  osnapToggle?.addEventListener('dblclick', openOsnapPanelWithSize);

  return { openOsnapPanel: openOsnapPanelWithSize };
}
