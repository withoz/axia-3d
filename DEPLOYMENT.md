# AXiA 3D — Deployment Report

**Date**: 2026-04-12  
**Version**: 0.1.0  
**Build ID**: `index-B-SZNBgs.js` (20:29 UTC)

## Deployed Features

### Smooth Surface Rendering
- **Area-weighted normal averaging**: Faces with shared vertices are smoothed if normal angle < 30°
- **Visual result**: Cylinders and curved surfaces render smoothly instead of faceted
- **Implementation**: `Viewport.ts` lines 706-769 (`smoothNormals()` method)

### Smooth Group Selection
- **Detection**: BFS traversal of face adjacency graph
- **Criteria**: Faces are adjacent via logical edges (quantized position matching)
- **Angle threshold**: 30.1° between face normals
- **Visual result**: Clicking curved surface selects entire surface (e.g., all cylinder sides)
- **Implementation**: `SelectionManager.ts` lines 845-954 (`findSmoothGroup()` method)

### Smooth Group Push-Pull
- **Mode**: Automatic detection of curved surfaces during push-pull operation
- **Behavior**: Each face in smooth group extrudes by same distance along its own normal
- **Visual result**: Radial extrusion pattern (gear-like appearance for cylinders)
- **Implementation**: `PushPullTool.ts` lines 24-26, 79-127 (smooth group detection and multi-face push-pull)

### Unified Edge Rendering Threshold
- **Threshold**: 30° angle between face normals
- **Effect**: Smooth surfaces render without internal edges; hard edges visible
- **Implementation**: `lib.rs` line 68 (`export_edge_lines_with_map(30.0)`)

## Build Artifacts

### Deployment Size
- Total: **2.0 MB** (down from 13 MB after cleanup)
- HTML: 77 KB
- Main JS: 839 KB
- WASM binary: 1.1 MB
- Libraries: 5.2 KB

### Files
```
dist/
├── index.html                           (entry point)
└── assets/
    ├── index-B-SZNBgs.js               (main application)
    ├── axia_wasm_bg-_kt2sami.wasm      (Rust engine)
    └── MaterialLibrary-Dgd2NuIo.js     (material definitions)
```

## Known Issues (Not Yet Fixed)

### Gap-Filling After Curved Surface Push-Pull
- **Issue**: After push-pulling a curved surface, gaps appear between extruded segments
- **Cause**: Individual face extrusion creates separate volumes without connecting walls
- **Expected fix**: Rust-side post-processing to create connecting faces between adjacent extruded segments
- **Status**: Deferred to next iteration

## Testing Notes

1. **Cylinder Rendering**: Smooth (no facets), correct shading
2. **Curved Surface Selection**: Entire side surface selects as one group
3. **Push-Pull Operation**: 
   - First click: Select cylinder side → shows blue preview
   - Mouse move: Shows dimensional label with distance
   - Second click: All side faces extrude with radial effect
   - Result: Gear-like pattern (gaps visible, center hollow)

## How to Deploy

For local testing:
```bash
cd web
npx vite preview
# Opens http://localhost:4173
```

For production hosting:
- Serve the `dist/` folder as static files
- All resources are self-contained
- No server-side processing needed

## Version Control

- **Magic byte**: `AXIA` (for file serialization)
- **Format version**: 1
- **Backward compatible**: Yes (legacy format fallback enabled)

## Next Steps

1. **Gap-filling algorithm**:
   - Detect adjacent extruded face pairs
   - Create connecting wall faces between them
   - Close center hole by filling interior

2. **Testing**: Verify push-pull on various curved shapes (sphere segments, cones, etc.)

3. **Potential optimizations**:
   - Cache smooth group calculations
   - Optimize BFS traversal for large face counts
   - Consider material/texture support for curved surfaces

---

**Deployment completed**: 2026-04-12 20:35 UTC  
**Artifacts cleaned**: Removed 43 old JS files + 11 old WASM variants  
**Ready for production**: Yes
