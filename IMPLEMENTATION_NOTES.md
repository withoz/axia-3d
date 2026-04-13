# Implementation Notes — ToolManager Refactoring

## Critical Details to Preserve

### 1. ToolContext Updates

The `ToolContext` is passed to tools at initialization and contains references to:
- `viewport`, `bridge`, `snap`, `selection`, etc.
- Helper functions like `getSnappedPoint()`, `getGroundPoint()`
- **BUT**: `inferredAxis` and `axisLock` are dynamic properties!

To make them accessible to tools, they're patched onto the context object:

```typescript
// In ToolManager constructor
(this.toolContext as any).inferredAxis = this.inferredAxis;
(this.toolContext as any).axisLock = this.axisLock;
```

This is why tools can read them like `this.ctx.inferredAxis`.

### 2. Helper Methods on Tools

Some tools need access to ToolManager methods. These are also patched:

```typescript
(this.toolContext as any).getFaceId = (faceIndex) => this.getFaceId(faceIndex);
(this.toolContext as any).extractFaceBoundary = (faceId) => this.extractFaceBoundary(faceId);
(this.toolContext as any).get3DPoint = (e) => this.get3DPoint(e);
(this.toolContext as any).getAxisInferredPoint = (e, origin) => this.getAxisInferredPoint(e, origin);
(this.toolContext as any).updateAxisGuide = (origin, axis, endPt) => this.updateAxisGuide(origin, axis, endPt);
(this.toolContext as any).clearAxisGuide = () => this.clearAxisGuide();
```

This is necessary because:
- These methods depend on ToolManager state (`this.axisGuide`, ray casting, etc.)
- They're shared utilities used by multiple tools
- Extracting them to tools would duplicate code

### 3. Viewport and Snap Reference Updates

The `faceMap` and `edgeMap` are updated during `syncMesh()`:

```typescript
// In ToolManager.syncMesh()
this.faceMap = buffers.faceMap;
this.edgeMap = this.bridge.getEdgeMap();
```

But tools access them via `this.ctx.faceMap` and `this.ctx.edgeMap`. These are copied at initialization:

```typescript
faceMap: this.faceMap,
edgeMap: this.edgeMap,
```

**IMPORTANT**: Tools should NOT cache these values. They should always access via `this.ctx.faceMap` and `this.ctx.edgeMap` to get the latest values after `syncMesh()`.

### 4. SelectionManager Integration

SelectionManager is unchanged but now passed via ToolContext:

```typescript
this.selection = new SelectionManager(viewport.scene);
```

Tools call methods like:
- `this.ctx.selection.handleClick(faceId, shift, ctrl)`
- `this.ctx.selection.handleEdgeClick(edgeId, shift, ctrl)`
- `this.ctx.selection.setHover(faceId)`
- `this.ctx.selection.clearSelection()`
- `this.ctx.getSelectedFaces()` (which calls `this.selection.getSelectedFaces()`)

### 5. Snap System in Tools

Tools use snap for position validation:

```typescript
const snappedPt = this.ctx.getSnappedPoint(e, rawPt, true);
```

The third parameter (`consumeOverride = true`) indicates:
- `true` on mousedown (click) — consume one-shot snap override
- `false` on mousemove (preview) — don't consume, just show snap marker

This is critical for the snap override system to work.

### 6. Ghost Preview Pattern (Push/Pull and Offset)

Both PushPullTool and OffsetTool create ghost previews. The pattern is:

1. **Create ghost** on first mouse down:
   ```typescript
   this.createPPGhost(faceId, hitPoint);
   ```

2. **Extract face boundary** (common function):
   ```typescript
   this.ppFaceVerts = (this.ctx as any).extractFaceBoundary(faceId);
   ```

3. **Rebuild ghost geometry** on mouse move:
   ```typescript
   this.rebuildPPGhost(distance);
   ```

4. **Dispose on cleanup**:
   ```typescript
   this.removePPGhost();
   ```

Key points:
- Use `THREE.Group` as container for organization
- Set `renderOrder` to control z-order
- Always dispose geometry and materials explicitly
- Update on every mouse move for smooth feedback

### 7. Dimension Label Updates

Tools update dimension display during operations:

```typescript
this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
  { from: startPt, to: endPt, text: 'Label', color: '#ffd43b' }
]);
```

Pass a **camera** (not viewport) and array of `DimLine` objects.

Clear when done:
```typescript
this.ctx.dimLabel.clear();
```

### 8. Axis Inference in Line Drawing

The `getAxisInferredPoint()` returns:
```typescript
{ point: THREE.Vector3, axis: 'x' | 'y' | 'z' | 'free' }
```

This is used in Line drawing to:
1. Detect which axis the user is closest to
2. Return the point ON that axis (projected from mouse ray)
3. Provide visual feedback via `updateAxisGuide()`

The axis is also displayed in dimension labels:
```typescript
const axisNames: Record<string, string> = {
  x: 'X축', y: 'Y축(높이)', z: 'Z축', free: ''
};
```

### 9. VCB Integration

Tools implement `applyVCBValue(value, value2?)`:

```typescript
applyVCBValue(value: number, value2?: number): void {
  // value: primary input (length, radius, angle, scale, etc.)
  // value2: optional secondary input (height for rect, width, etc.)
}
```

The ToolManager calls this when user hits Enter in the VCB:

```typescript
const tool = this.tools.get(this._currentTool);
if (tool?.applyVCBValue) {
  tool.applyVCBValue(value, value2);
}
```

### 10. Tool State Machine Example (OffsetTool)

Offset uses three phases:
- **Phase 0**: Waiting for object selection
- **Phase 1**: Object selected, waiting for direction click
- **Phase 2**: Execute offset, return to Phase 0

Each phase is handled in `onMouseDown()`:

```typescript
if (this.offsetPhase === 0) {
  // Pick object, set phase = 1
} else if (this.offsetPhase === 1) {
  // Execute, set phase = 0
}
```

Reset in cleanup:
```typescript
private resetOffsetState(): void {
  this.offsetPhase = 0;
  this.offsetFaceId = -1;
  // ... clear other state
}
```

---

## Debugging Tips

### 1. Tool Not Responding to Clicks

Check:
- Is `onMouseDown()` implemented?
- Is `onActivate()` being called?
- Is the tool returning `true` from `isBusy()` when appropriate?

```typescript
// In ToolManager mouse handler
const tool = this.tools.get(this._currentTool);
if (tool?.onMouseDown) {
  console.log(`[DEBUG] Calling onMouseDown for ${this._currentTool}`);
  tool.onMouseDown(e, point);
}
```

### 2. Ghost Preview Not Showing

Check:
- Is ghost added to `this.ctx.viewport.scene`?
- Is `renderOrder` set correctly?
- Are materials disposed properly?
- Is `rebuildGhost()` called on mousemove?

### 3. Snap Not Working in Tool

Check:
- Is `getSnappedPoint(e, rawPt, true)` called on mousedown?
- Is `getSnappedPoint(e, rawPt, false)` called on mousemove (preview)?
- Is snap point being used instead of raw point?

```typescript
const rawPt = this.ctx.getGroundPoint(e);
const snapPt = this.ctx.getSnappedPoint(e, rawPt, true);
const pt = snapPt || rawPt; // Prefer snap
```

### 4. Dimension Label Missing

Check:
- Is `this.ctx.dimLabel.update()` called with correct camera?
- Is it cleared when tool deactivates?
- Is the `DimLine` array properly formatted?

```typescript
this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
  { from: v1, to: v2, text: 'Label', color: '#color' }
]);
```

### 5. Hover Highlights Not Working

Check:
- Is tool in the `HOVER_TOOLS` set?
- Is `isOperating` false (tool not busy)?
- Is `selection.setHover()` called on mousemove?

In ToolManager:
```typescript
if (!isOperating && ToolManagerRefactored.HOVER_TOOLS.has(this._currentTool)) {
  const hit = this.viewport.pick(e.clientX, e.clientY);
  if (hit && hit.faceIndex != null) {
    const fid = this.getFaceId(hit.faceIndex);
    this.selection.setHover(fid);
  }
}
```

---

## Performance Considerations

### 1. Avoid Re-computation

**Bad**:
```typescript
onMouseMove(e, point) {
  const faceBoundary = this.extractFaceBoundary(this.faceId); // Every frame!
}
```

**Good**:
```typescript
onMouseDown(e, point) {
  this.ppFaceVerts = (this.ctx as any).extractFaceBoundary(faceId);
}

onMouseMove(e, point) {
  this.rebuildGhost(distance); // Use cached ppFaceVerts
}
```

### 2. Dispose Geometry/Materials

Always dispose in cleanup:
```typescript
cleanup(): void {
  if (this.preview) {
    this.ctx.viewport.scene.remove(this.preview);
    this.preview.geometry.dispose();
    (this.preview.material as THREE.Material).dispose();
    this.preview = null;
  }
}
```

### 3. Limit Raycasting

Only cast rays when needed:
```typescript
// Good: Only on mousemove
onMouseMove(e, point) {
  const hit = this.ctx.viewport.pick(e.clientX, e.clientY);
  // ...
}

// Bad: Casting in every helper method
```

---

## Type Safety Notes

### Using `as any` Safely

Some properties are patched dynamically:
```typescript
(this.ctx as any).getFaceId = (faceIndex) => this.getFaceId(faceIndex);
```

In tools, cast when accessing:
```typescript
const faceId = (this.ctx as any).getFaceId(hit.faceIndex);
```

This is acceptable because:
- It's one-directional (ToolManager → Tools)
- Tools don't modify these properties
- It avoids making ToolContext interface bloated

### Avoid Overusing `as any`

**Bad**:
```typescript
const anything: any = this.ctx; // Don't do this!
```

**Good**:
```typescript
const faceId = (this.ctx as any).getFaceId(index); // Narrow cast
```

---

## Testing Patterns

### Mock ToolContext

```typescript
const mockContext: ToolContext = {
  viewport: mockViewport,
  bridge: mockBridge,
  snap: mockSnap,
  snapVisual: mockSnapVisual,
  selection: mockSelection,
  dimLabel: mockDimLabel,
  units: mockUnits,
  faceMap: new Uint32Array([1, 2, 3]),
  edgeMap: null,
  syncMesh: jest.fn(),
  getSnappedPoint: jest.fn(() => new THREE.Vector3()),
  getGroundPoint: jest.fn(() => new THREE.Vector3()),
  getSelectedFaces: jest.fn(() => [1, 2]),
  get inferredAxis() { return 'free'; },
  get axisLock() { return null; },
} as any;

const tool = new DrawLineTool(mockContext);
```

### Test State Transitions

```typescript
expect(tool.isBusy()).toBe(false);

const point = new THREE.Vector3(10, 0, 10);
tool.onMouseDown({} as MouseEvent, point);

expect(tool.isBusy()).toBe(true);
expect(mockContext.syncMesh).toHaveBeenCalled();
```

---

## Migration from Original ToolManager

If porting code from the original, watch for:

1. **State variables**: Move to tool class properties
2. **Event handlers**: Implement ITool methods instead
3. **Helper methods**: Use `(this.ctx as any)` to access ToolManager methods
4. **Shared state**: Access via `this.ctx` properties
5. **Cleanup**: Always implement cleanup in tool's `onDeactivate()` or `cleanup()`

Example:
```typescript
// Original ToolManager
private lineStart: THREE.Vector3 | null = null;
private linePreview: THREE.Line | null = null;

canvas.addEventListener('mousedown', (e) => {
  if (!this.lineStart) {
    this.lineStart = point;
  } else {
    // Draw line
    this.lineStart = null;
  }
});

// Refactored DrawLineTool
export class DrawLineTool implements ITool {
  private lineStart: THREE.Vector3 | null = null;
  private linePreview: THREE.Line | null = null;

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.lineStart) {
      this.lineStart = point?.clone() || null;
    } else {
      // Draw line
      this.lineStart = null;
    }
  }
}
```

---

## Final Checklist

Before deploying:

- [ ] All 10 tools respond to mouse events
- [ ] Ghost previews display smoothly
- [ ] Dimension labels show correct values
- [ ] Snap system works in all tools
- [ ] Axis inference works in line drawing
- [ ] VCB input applies to all tools
- [ ] Tool switching preserves selection (for transform tools)
- [ ] Hover highlights activate
- [ ] Escape key cancels operations
- [ ] Arrow keys lock axes
- [ ] Undo/Redo still work
- [ ] No memory leaks (geometries disposed)
- [ ] No console errors

---

## Questions or Edge Cases?

Refer to the original `ToolManager.ts` for any questionable logic. The refactoring preserves 100% of behavior — if you find a difference, check the original implementation.
