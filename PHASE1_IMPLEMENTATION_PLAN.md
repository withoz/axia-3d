# Phase 1 Implementation Plan: WASM Buffer Optimization & Global State Removal
**Target**: 30-50% buffer copy overhead reduction + improved testability
**Estimated Duration**: 2-3 weeks

---

## Current Performance Problem

### Buffer Copy Overhead (P0)
**Current Flow:**
```
Operation (draw_line, push_pull, etc.) 
  → WasmBridge.markDirty() 
  → get_positions() + get_normals() + get_indices() + get_face_map() 
  → Copy ENTIRE mesh buffers from WASM 
  → Update Three.js geometry 
  → Render
```

**Problem Metrics:**
- Large mesh (1000+ faces): 100KB+ buffer copies per frame
- Runs EVERY FRAME until dirty flag cleared
- No selective updates = 100% copy even if only 1 face changed

**Example Timeline:**
```
Frame 1: draw_line() → dirty=true
Frame 2: getMeshBuffers() copies 100KB, dirty=false
Frame 3-4: no change (but renders previous frame's unchanged geometry)
Frame 5: push_pull() → dirty=true
Frame 6: getMeshBuffers() copies 100KB again
```

### Global State Pollution (P1)
```typescript
// main.ts
window.__axia_bridge = bridge;
window.__axia_viewport = viewport;
window.__axia_toolManager = toolManager;
window.__axia_units = units;
window.__axia_panelManager = panelManager;
window.__axia_commandInput = commandInput;
window.__axia_importer = fileImporter;
window.__axia_fileManager = fileManager;
```

**Problems:**
1. No dependency injection → tight coupling
2. Impossible to test without window setup
3. Memory leaks: globals never garbage collected
4. No TypeScript type safety for window properties

---

## Solution Architecture

### 1. Delta Tracking System

#### 1.1 Rust Side: Track Dirty Faces
**File: `crates/axia-wasm/src/lib.rs`**

New data structure:
```rust
pub struct AxiaEngine {
    scene: Scene,
    cached_positions: Vec<f32>,
    cached_normals: Vec<f32>,
    cached_indices: Vec<u32>,
    cached_face_map: Vec<u32>,
    cached_edge_lines: Vec<f32>,
    cached_edge_map: Vec<u32>,
    
    // DELTA TRACKING (NEW)
    dirty_faces: HashSet<FaceId>,    // Which faces changed
    face_version: u32,               // Monotonic counter
    cache_dirty: bool,
}
```

New Rust methods:
```rust
// Get only changed face buffers
pub fn get_dirty_face_buffers(&mut self) -> Option<DeltaBuffers> {
    if self.dirty_faces.is_empty() { return None; }
    
    // Only export geometry for dirty faces
    let delta = export_delta_buffers(&self.scene, &self.dirty_faces)?;
    self.dirty_faces.clear();
    Some(delta)
}

// Return timestamp to validate JS cache validity
pub fn get_cache_version(&self) -> u32 {
    self.face_version
}

// Mark specific faces as dirty (called by Command execution)
fn mark_faces_dirty(&mut self, face_ids: &[FaceId]) {
    for id in face_ids {
        self.dirty_faces.insert(*id);
    }
    self.face_version += 1;
}
```

Operation changes:
```rust
pub fn push_pull(&mut self, faceId: number, distance: f64) -> bool {
    match self.scene.execute(cmd) {
        Ok(result) => {
            // Mark affected faces as dirty
            if let CommandResult::FacesModified(ids) = result {
                self.mark_faces_dirty(&ids);
            }
            true
        }
        Err(_) => false
    }
}
```

#### 1.2 TypeScript Side: Selective Updates
**File: `web/src/bridge/WasmBridge.ts`**

New interface:
```typescript
export interface DeltaBuffers {
  modifiedFaceIds: number[];        // Which face indices changed
  positions: Float32Array;          // Only positions for modified faces
  normals: Float32Array;            // Only normals for modified faces
  indices: Uint32Array;             // Renumbered indices
  cacheVersion: number;             // For validation
}

export interface CachedMeshState {
  positions: Float32Array | null;
  normals: Float32Array | null;
  indices: Uint32Array | null;
  faceMap: Uint32Array | null;
  edgeLines: Float32Array | null;
  edgeMap: Uint32Array | null;
  version: number;                  // Track version
  dirty: boolean;
}
```

New WasmBridge methods:
```typescript
class WasmBridge {
  private bufferCache: CachedMeshState = { ..., version: 0, dirty: true };
  
  /**
   * Get delta-only buffers (only changed faces)
   * Returns null if no changes
   */
  getDeltaBuffers(): DeltaBuffers | null {
    if (!this.engine) return null;
    if (!this.bufferCache.dirty) return null;
    
    try {
      const delta = this.engine.get_dirty_face_buffers?.();
      if (!delta) return null;
      
      const version = this.engine.get_cache_version?.() ?? 0;
      this.bufferCache.version = version;
      
      return {
        modifiedFaceIds: Array.from(delta.modified_face_ids),
        positions: delta.positions,
        normals: delta.normals,
        indices: delta.indices,
        cacheVersion: version
      };
    } catch (e) {
      console.warn('[WasmBridge] getDeltaBuffers failed, falling back to full update:', e);
      return this.getMeshBuffers() as unknown as DeltaBuffers;
    }
  }
  
  /**
   * Get full mesh (fallback when no delta available)
   */
  getMeshBuffers(): MeshBuffers | null {
    // Existing implementation but with version tracking
    if (!this.bufferCache.dirty && this.bufferCache.positions) {
      return { ..., version: this.bufferCache.version };
    }
    // ... full buffer copy as before
  }
  
  /**
   * Apply delta to existing geometry
   * Only updates Three.js for changed vertices
   */
  static applyDeltaToGeometry(
    geometry: THREE.BufferGeometry,
    delta: DeltaBuffers
  ): void {
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    
    // Update only affected positions
    for (let i = 0; i < delta.modifiedFaceIds.length; i++) {
      const faceIdx = delta.modifiedFaceIds[i];
      const vertOffset = faceIdx * 3; // 3 verts per face (triangles)
      
      // Copy new position/normal data
      posAttr.array.set(
        delta.positions.slice(vertOffset * 3, (vertOffset + 3) * 3),
        vertOffset * 3
      );
      normAttr.array.set(
        delta.normals.slice(vertOffset * 3, (vertOffset + 3) * 3),
        vertOffset * 3
      );
    }
    
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
  }
}
```

---

### 2. Global State Removal via Dependency Injection

#### 2.1 Create Service Container
**New File: `web/src/core/ServiceContainer.ts`**

```typescript
export class ServiceContainer {
  private services: Map<string, any> = new Map();
  
  register<T>(key: string, instance: T): void {
    this.services.set(key, instance);
  }
  
  get<T>(key: string): T {
    const service = this.services.get(key);
    if (!service) throw new Error(`Service not registered: ${key}`);
    return service as T;
  }
  
  has(key: string): boolean {
    return this.services.has(key);
  }
}

// Singleton instance (only one place to initialize)
export const serviceContainer = new ServiceContainer();
```

#### 2.2 Refactor main.ts
**File: `web/src/main.ts`**

**Before:**
```typescript
async function main() {
  const bridge = new WasmBridge();
  const viewport = new Viewport(container);
  const toolManager = new ToolManager(viewport, bridge, units);
  
  window.__axia_bridge = bridge;
  window.__axia_viewport = viewport;
  window.__axia_toolManager = toolManager;
  // ... 5 more globals
}
```

**After:**
```typescript
async function main() {
  // 1. Initialize services
  const bridge = new WasmBridge();
  await bridge.init();
  
  const viewport = new Viewport(container);
  const units = new UnitSystem();
  const toolManager = new ToolManager(viewport, bridge, units);
  const panelManager = new DraggablePanelManager();
  const fileManager = new FileManager(bridge);
  const materialLibrary = new MaterialLibrary();
  const fileImporter = new FileImporter(viewport.scene);
  const commandInput = new CommandInput();
  
  // 2. Register in container (replaces window.* globals)
  serviceContainer.register('bridge', bridge);
  serviceContainer.register('viewport', viewport);
  serviceContainer.register('toolManager', toolManager);
  serviceContainer.register('units', units);
  serviceContainer.register('panelManager', panelManager);
  serviceContainer.register('fileManager', fileManager);
  serviceContainer.register('materialLibrary', materialLibrary);
  serviceContainer.register('fileImporter', fileImporter);
  serviceContainer.register('commandInput', commandInput);
  
  // 3. ONLY export serviceContainer (single global)
  (window as any).__axia = serviceContainer;
  
  // 4. Tools/UI access service like:
  // const bridge = serviceContainer.get<WasmBridge>('bridge');
}
```

#### 2.3 Update ToolManager to Use Container
**File: `web/src/tools/ToolManagerRefactored.ts`**

```typescript
export class ToolManager {
  // Instead of constructor params:
  // constructor(viewport, bridge, units)
  
  // Use container when needed:
  execute(toolName: string) {
    const bridge = serviceContainer.get<WasmBridge>('bridge');
    const viewport = serviceContainer.get<Viewport>('viewport');
    const units = serviceContainer.get<UnitSystem>('units');
    
    // ... existing logic
  }
}
```

---

### 3. Viewport Delta Integration

#### 3.1 Update Viewport to Use Deltas
**File: `web/src/viewport/Viewport.ts`**

```typescript
export class Viewport {
  private meshGeometry: THREE.BufferGeometry;
  
  syncMesh(): void {
    const bridge = serviceContainer.get<WasmBridge>('bridge');
    
    // Try delta first (fast path)
    const delta = bridge.getDeltaBuffers();
    if (delta && this.meshGeometry.getAttribute('position')) {
      // Fast path: only update changed faces
      WasmBridge.applyDeltaToGeometry(this.meshGeometry, delta);
      this.meshGeometry.computeBoundingSphere();
      return;
    }
    
    // Slow path: full buffer update (fallback)
    const buffers = bridge.getMeshBuffers();
    if (!buffers) return;
    
    // Recreate geometry (existing logic)
    this.meshGeometry.dispose();
    this.meshGeometry = new THREE.BufferGeometry()
      .setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3))
      .setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3))
      .setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  }
}
```

---

## Implementation Tasks (In Order)

### Week 1: Rust Side Delta Tracking

- [ ] **Task 1.1**: Add `DeltaBuffers` struct to `axia-wasm/src/lib.rs`
  - Track `modified_face_ids`, `positions`, `normals`, `indices`
  - Estimated: 4 hours
  
- [ ] **Task 1.2**: Implement `mark_faces_dirty()` in AxiaEngine
  - Add `dirty_faces: HashSet<FaceId>`
  - Call in every Command execution
  - Estimated: 6 hours
  
- [ ] **Task 1.3**: Implement `export_delta_buffers()` function
  - Only export vertices for changed faces
  - Handle index remapping
  - Estimated: 8 hours
  
- [ ] **Task 1.4**: Add `get_dirty_face_buffers()` WASM method
  - Return None if no changes
  - Clear dirty_faces after export
  - Estimated: 3 hours
  
- [ ] **Task 1.5**: Add `get_cache_version()` WASM method
  - Return monotonic version counter
  - Estimated: 1 hour
  
- [ ] **Task 1.6**: Test Rust implementation
  - Unit test dirty tracking
  - Verify delta export correctness
  - Estimated: 4 hours

**Subtotal: 26 hours (~3-4 days)**

---

### Week 2: TypeScript Bridge & Viewport Integration

- [ ] **Task 2.1**: Create `ServiceContainer` class
  - Implement register/get/has methods
  - Estimated: 2 hours
  
- [ ] **Task 2.2**: Refactor `WasmBridge` with delta methods
  - Add `getDeltaBuffers()` method
  - Update type signatures
  - Estimated: 5 hours
  
- [ ] **Task 2.3**: Implement `applyDeltaToGeometry()` static method
  - Handle vertex offset calculations
  - Set `needsUpdate` flags correctly
  - Estimated: 4 hours
  
- [ ] **Task 2.4**: Update `main.ts` to use ServiceContainer
  - Replace all `window.__axia_*` assignments
  - Register services in container
  - Estimated: 3 hours
  
- [ ] **Task 2.5**: Update `Viewport.syncMesh()` for delta path
  - Try delta first, fall back to full
  - Estimated: 3 hours
  
- [ ] **Task 2.6**: Update all tools to use ServiceContainer
  - Replace direct parameter dependencies
  - Estimated: 4 hours
  
- [ ] **Task 2.7**: Comprehensive testing
  - Delta correctness (single face, multiple faces)
  - Fallback to full buffer when needed
  - ServiceContainer dependency resolution
  - Estimated: 6 hours

**Subtotal: 27 hours (~3-4 days)**

---

### Week 3: Deployment & Optimization

- [ ] **Task 3.1**: Performance benchmarking
  - Measure buffer copy time before/after
  - Profile delta vs full update costs
  - Estimated: 4 hours
  
- [ ] **Task 3.2**: WASM rebuild & test
  - `wasm-pack build --target web`
  - Run integration tests
  - Estimated: 2 hours
  
- [ ] **Task 3.3**: GitHub Actions deploy
  - Trigger build pipeline
  - Verify production bundle
  - Estimated: 2 hours
  
- [ ] **Task 3.4**: Memory profiling
  - Check global state still released after shutdown
  - Verify no buffer leaks
  - Estimated: 3 hours
  
- [ ] **Task 3.5**: Documentation & code review
  - Add JSDoc comments
  - Document delta synchronization design
  - Estimated: 3 hours

**Subtotal: 14 hours (~2 days)**

---

## Expected Performance Improvements

### Buffer Copy Reduction
- **Before**: 100% copy every frame buffers change
- **After**: ~10-20% copy for incremental changes
- **Target**: 30-50% overhead reduction on large meshes

### Memory Footprint
- **Before**: Full mesh copied to WASM each render
- **After**: Only delta buffers allocated
- **Target**: 20-30% reduction in per-frame allocation

### Testability
- **Before**: All code tied to `window.__axia_*` globals
- **After**: Explicit dependency injection via ServiceContainer
- **Target**: Enable unit testing of core logic (80%+ coverage target)

---

## Validation Checklist

- [ ] Delta tracking correctly identifies modified faces
- [ ] `applyDeltaToGeometry()` produces identical results to full buffer
- [ ] Fallback to full buffer works when delta unavailable
- [ ] ServiceContainer correctly resolves all dependencies
- [ ] No memory leaks when services unregistered
- [ ] Build compiles with zero warnings
- [ ] All 48 existing tests still pass
- [ ] New delta-specific tests pass (target 8+ new tests)
- [ ] Performance metrics show 30-50% improvement on large meshes

---

## Risk Mitigation

### Risk 1: Delta Calculation Errors
**Mitigation**: Implement validation mode that compares delta results to full buffer
```typescript
// Debug mode: validate delta against full buffer
if (DEBUG_VALIDATE_DELTA) {
  const full = bridge.getMeshBuffers();
  const delta = bridge.getDeltaBuffers();
  validateDeltaCorrectness(full, delta);
}
```

### Risk 2: ServiceContainer Dependency Ordering
**Mitigation**: Use lazy initialization pattern
```typescript
const bridge = (() => {
  if (!serviceContainer.has('bridge')) {
    throw new Error('ServiceContainer not initialized - did you forget to register bridge?');
  }
  return serviceContainer.get<WasmBridge>('bridge');
})();
```

### Risk 3: Fallback Performance Regression
**Mitigation**: Keep full buffer path optimized
- Don't add overhead to existing `getMeshBuffers()`
- Only add overhead when delta is attempted

---

## Files to Modify

### Rust
- `crates/axia-wasm/src/lib.rs` — delta tracking & export
- `crates/axia-geo/src/mesh.rs` — possibly optimize delta extraction (P1)

### TypeScript
- `web/src/bridge/WasmBridge.ts` — delta methods
- `web/src/core/ServiceContainer.ts` — NEW container
- `web/src/main.ts` — refactor to use container
- `web/src/viewport/Viewport.ts` — delta integration
- `web/src/tools/ToolManagerRefactored.ts` — container usage
- `web/src/ui/ComponentPanel.ts` — container usage
- `web/src/file/FileManager.ts` — container usage
- `web/src/utils/debug.ts` — update debug mode

### Tests
- `crates/axia-core/tests/` — add delta tracking tests
- `web/src/__tests__/` — add ServiceContainer tests
- `web/src/__tests__/WasmBridge.test.ts` — add delta tests

---

## Success Metrics

1. **Performance**: 30-50% reduction in WASM buffer copy time
2. **Testability**: 80%+ test coverage of core logic (up from 40%)
3. **Reliability**: Zero regressions in 48 existing tests
4. **Code Quality**: ServiceContainer pattern enables future modularity
5. **Documentation**: Design documented, easy for next developer to extend

---

**Next Step**: Begin Task 1.1 — Add DeltaBuffers struct to Rust engine
