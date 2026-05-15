/**
 * BasePrimitiveTool — Common state machine and interaction logic for Sphere/Cylinder/Cone
 * Implements unified 2-click (Sphere) or 3-click (Cylinder/Cone) creation flow
 * Coordinates: Click #1 (Anchor) → Sizing1 (radius) → Click #2 (confirm radius) → Sizing2 (height, if needed) → Click #3 → complete
 */

import * as THREE from 'three';
import { ITool, ToolContext } from '../tools/ITool';
import { PrimitiveSession, PrimitiveType } from './PrimitiveSession';
import { PrimitivePreviewManager } from './PrimitivePreviewManager';
import { debugLog } from '../utils/debug';

export abstract class BasePrimitiveTool implements ITool {
  // ITool requirement
  abstract readonly name: string;

  protected ctx: ToolContext;
  protected session: PrimitiveSession;
  protected previewManager: PrimitivePreviewManager;

  // Drag tracking
  protected dragStartPos: THREE.Vector3 | null = null;
  protected lastMousePos: THREE.Vector2 | null = null;
  protected screenMousePos: { x: number; y: number } | null = null;

  // VCB input
  protected vcbActive: boolean = false;
  protected vcbBuffer: string = '';

  constructor(ctx: ToolContext, primitiveType: PrimitiveType) {
    this.ctx = ctx;
    this.session = new PrimitiveSession(primitiveType);
    this.previewManager = new PrimitivePreviewManager(ctx.viewport.scene, this.session);

    // Subscribe to param changes for preview updates
    this.session.onParamsChange = (params) => {
      this.previewManager.updatePreview(params, this.session.state);
    };

    this.session.onStateChange = (state) => {
      debugLog(`[${primitiveType}] state → ${state}`);

      // ═══ Debug: Before clearing VCB state ═══
      debugLog(
        `[${primitiveType}] [DEBUG-1] Before VCB clear: radius=${this.session.params.radius?.toFixed(2) ?? '?'}, height=${this.session.params.height?.toFixed(2) ?? '?'}`
      );

      // ═══ Clear VCB state when state changes to new sizing phase ═══
      this.vcbBuffer = '';
      this.vcbActive = false;
      this.session.inputLock = false;
      if (this.ctx.dimLabel) {
        this.ctx.dimLabel.clear();
      }

      // ═══ Debug: Before commit ═══
      debugLog(
        `[${primitiveType}] [DEBUG-2] After VCB clear: radius=${this.session.params.radius?.toFixed(2) ?? '?'}, height=${this.session.params.height?.toFixed(2) ?? '?'}`
      );

      if (state === 'done') {
        this.commit();
      }
    };
  }

  /**
   * Tool is busy if in any active state (not idle)
   */
  isBusy(): boolean {
    return this.session.state !== 'idle';
  }

  /**
   * Handle mouse down: Click #1, #2, #3
   * Implements ITool.onMouseDown(e, point) signature
   */
  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    const groundPos = point || this.ctx.getGroundPoint(e);
    if (!groundPos) return;

    switch (this.session.state) {
      case 'idle':
        // Click #1: Set anchor and move to Sizing1
        this.onClickAnchor(groundPos);
        break;

      case 'sizing1':
        // ═══ If VCB was active, apply it first before state change ═══
        if (this.vcbActive) {
          this.applyVCBInput();
          // applyVCBInput() already calls nextState(), so return
          return;
        }
        // Click #2: Confirm radius and move to next state
        if (this.session.requiresSizing2()) {
          this.session.nextState(); // → sizing2
        } else {
          this.session.nextState(); // → done (for sphere)
        }
        break;

      case 'sizing2':
        // ═══ If VCB was active, apply it first before state change ═══
        if (this.vcbActive) {
          this.applyVCBInput();
          // applyVCBInput() already calls nextState(), so return
          return;
        }
        // Click #3: Confirm height and move to done
        this.session.nextState(); // → done
        break;

      default:
        break;
    }
  }

  /**
   * Set anchor point (Click #1)
   * Subclass can override for face-based anchor (e.g., face normal as axis)
   */
  protected onClickAnchor(point: THREE.Vector3): void {
    const axis = this.getAxisAtPoint(point);
    this.session.setAnchor(point, axis);
    this.session.nextState(); // → sizing1

    debugLog(`[${this.name}] anchor set, waiting for radius...`);
  }

  /**
   * Get axis direction at anchor point
   * Default: world up. Override in subclass for face-based axis.
   */
  protected getAxisAtPoint(_point: THREE.Vector3): THREE.Vector3 {
    // ADR-103-δ (Z-up): world-up axis = +Z (industry CAD parity).
    return new THREE.Vector3(0, 0, 1);
  }

  /**
   * Handle mouse move: update sizing param based on distance
   * (but NOT during VCB input — inputLock prevents update)
   */
  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    const groundPos = point || this.ctx.getGroundPoint(e);
    if (!groundPos || !this.session.anchor) return;

    // ═══ Store screen mouse position for VCB display ═══
    this.screenMousePos = { x: e.clientX, y: e.clientY };

    // ═══ Do NOT update during VCB input (inputLock prevents mouse from overriding VCB) ═══
    if (this.session.inputLock) {
      return;
    }

    if (this.session.state === 'sizing1') {
      // Sizing1: calculate radius from distance to anchor
      const dist = groundPos.distanceTo(this.session.anchor);
      this.session.setParam('radius', dist);
    } else if (this.session.state === 'sizing2') {
      // Sizing2: calculate height along axis
      const vec = new THREE.Vector3().subVectors(groundPos, this.session.anchor);
      const height = vec.dot(this.session.axis);
      this.session.setParam('height', Math.max(0, height));
    }

    // Log for debugging
    const param = this.session.getActiveSizingParam();
    if (param) {
      const value = this.session.params[param] ?? 0;
      debugLog(`[${this.name}] ${param}: ${value.toFixed(2)}`);
    }
  }

  /**
   * Handle keyboard input
   */
  onKeyDown(e: KeyboardEvent): void {
    // Esc: Cancel
    if (e.key === 'Escape') {
      this.cancel();
      return;
    }

    // Enter: Apply VCB (if active) then confirm sizing and move to next
    if (e.key === 'Enter') {
      // ═══ If VCB is active, apply it first (like Tab) ═══
      if (this.vcbActive) {
        this.applyVCBInput();
        // applyVCBInput() already calls nextState(), so return
        e.preventDefault();
        return;
      }

      // Manual confirmation without VCB
      if (this.session.state === 'sizing1' && this.session.params.radius > 0) {
        if (this.session.requiresSizing2()) {
          this.session.nextState(); // → sizing2
        } else {
          this.session.nextState(); // → done
        }
      } else if (this.session.state === 'sizing2' && this.session.params.height > 0) {
        this.session.nextState(); // → done
      }
      return;
    }

    // Numeric VCB input
    if (/^[\d.]$/.test(e.key)) {
      this.vcbActive = true;
      this.vcbBuffer += e.key;
      this.session.inputLock = true;
      e.preventDefault();
      this.updateVCBDisplay();
    } else if (e.key === 'Backspace' && this.vcbActive) {
      this.vcbBuffer = this.vcbBuffer.slice(0, -1);
      e.preventDefault();
      this.updateVCBDisplay();
    } else if (e.key === 'Tab' && this.vcbActive) {
      // Tab: Apply VCB and confirm
      this.applyVCBInput();
      return;
    }
  }

  /**
   * Update VCB display in HUD with real-time dimension preview
   */
  private updateVCBDisplay(): void {
    const param = this.session.getActiveSizingParam();
    const paramLabel = param === 'radius' ? 'R' : 'H';
    const displayText = `${paramLabel}: ${this.vcbBuffer}`;

    // ═══ Show real-time dimension preview at mouse position ═══
    if (this.ctx.dimLabel && this.screenMousePos) {
      this.ctx.dimLabel.showAtScreen(
        this.screenMousePos.x,
        this.screenMousePos.y,
        displayText,
        '#4ac1ff'
      );
    }

    debugLog(`[${this.name}] VCB input ${paramLabel}: ${this.vcbBuffer}`);
  }

  /**
   * Apply VCB input: parse and set param
   */
  private applyVCBInput(): void {
    const parsedValue = parseFloat(this.vcbBuffer);
    if (!isNaN(parsedValue) && parsedValue > 0) {
      const param = this.session.getActiveSizingParam();
      if (param) {
        // ═══ CRITICAL: Unlock BEFORE setParam so value actually applies ═══
        // (setParam() checks inputLock and returns early if locked)
        this.session.inputLock = false;
        this.session.setParam(param, parsedValue);
        debugLog(`[${this.name}] Applied ${param}: ${parsedValue}`);
      }
    }

    // ═══ Clear VCB state completely ═══
    this.vcbBuffer = '';
    this.vcbActive = false;

    // Clear dimension label display (remove overlapping labels)
    if (this.ctx.dimLabel) {
      this.ctx.dimLabel.clear();
    }

    // Auto-confirm if this was Sizing1 or Sizing2
    // (nextState() triggers onStateChange)
    if (this.session.state === 'sizing1') {
      if (this.session.requiresSizing2()) {
        this.session.nextState(); // → sizing2
      } else {
        this.session.nextState(); // → done
      }
    } else if (this.session.state === 'sizing2') {
      this.session.nextState(); // → done
    }
  }

  /**
   * Called from applyVCBValue (external VCB panel)
   */
  applyVCBValue(value: number): void {
    const param = this.session.getActiveSizingParam();
    if (param && value > 0) {
      this.session.setParam(param, value);

      // Auto-confirm
      if (this.session.state === 'sizing1') {
        if (this.session.requiresSizing2()) {
          this.session.nextState();
        } else {
          this.session.nextState();
        }
      } else if (this.session.state === 'sizing2') {
        this.session.nextState();
      }
    }
  }

  /**
   * Cancel tool: undo and return to idle
   */
  protected cancel(): void {
    debugLog(`[${this.session.primitiveType}] cancelled`);
    this.ctx.bridge.undo();
    this.cleanup();
  }

  /**
   * Create primitive and add to scene
   * Subclass MUST override this
   */
  protected abstract commit(): void;

  /**
   * Post-commit: auto-group + auto-select the newly created primitive.
   * Call from subclass commit() after WASM creation + syncMesh().
   * @param seedFaceId — any face ID returned by the WASM create call
   * @param label — human-readable name for the group (e.g. "Sphere", "Cone")
   */
  protected autoGroupAndSelect(seedFaceId: number, label: string): void {
    try {
      // 1. Collect all connected faces from the seed
      const allFaces = this.ctx.bridge.getConnectedFaces(seedFaceId);
      if (!allFaces || allFaces.length === 0) {
        debugLog(`[${this.name}] autoGroup: no connected faces from seed ${seedFaceId}`);
        return;
      }

      // 2. Create group
      const groupId = this.ctx.bridge.createGroup(label, allFaces);
      if (groupId > 0) {
        debugLog(`[${this.name}] ✓ Group created: id=${groupId}, name="${label}", faces=${allFaces.length}`);
      }

      // 3. Auto-select the created faces
      this.ctx.selection.clearSelection();
      this.ctx.selection.selectFaces(allFaces);

      debugLog(`[${this.name}] ✓ Auto-selected ${allFaces.length} faces`);
    } catch (err) {
      console.error(`[${this.name}] autoGroupAndSelect failed:`, err);
    }
  }

  /**
   * Cleanup: dispose preview and reset session
   */
  cleanup(): void {
    this.previewManager.dispose();
    this.session.dispose();
    debugLog(`[${this.name}] cleanup`);
  }

  /**
   * Called when tool is deactivated
   */
  onDeactivate(): void {
    if (this.isBusy()) {
      this.cancel();
    } else {
      this.cleanup();
    }
  }

  /**
   * Called when tool is activated
   */
  onActivate(): void {
    this.session.reset();
    debugLog(`[${this.name}] activated, click to place anchor`);
  }
}
