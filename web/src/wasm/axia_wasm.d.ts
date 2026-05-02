/* tslint:disable */
/* eslint-disable */

export class AxiaEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add a distance constraint between two vertices.
     */
    addDistanceConstraint(v_a: number, v_b: number, distance: number): number;
    /**
     * Add a parallel/perpendicular/collinear constraint between two edges.
     * `edgeA_v_a/b` and `edgeB_v_a/b` are vertex IDs.
     * `kind`: "parallel" | "perpendicular" | "collinear"
     * Returns the new constraint ID (>=1) on success, 0 on failure.
     */
    addEdgeConstraint(kind: string, edge_a_v_a: number, edge_a_v_b: number, edge_b_v_a: number, edge_b_v_b: number): number;
    /**
     * 그룹에 face 추가
     */
    add_faces_to_group(group_id: number, face_ids: Uint32Array): boolean;
    /**
     * 모든 XIA ID 목록 (정렬됨).
     * MCP `list_xias` capability 의 backbone (ADR-041 P26.1, ADR-042).
     */
    allXiaIds(): Uint32Array;
    /**
     * Dry-run analysis of merge candidates — does NOT mutate the mesh.
     *
     * For each pair of faces in the selection that shares an edge, checks:
     *   - shared edge count (must be 1)
     *   - coplanarity (strict tolerance)
     *
     * Returns JSON:
     *   {
     *     "total": N,                 // pairs sharing any edge
     *     "mergeable": M,             // pairs passing both checks
     *     "nonCoplanar": K,           // pairs sharing 1 edge but not coplanar
     *     "ambiguous": L,             // pairs sharing >1 edge
     *     "estMergesAfterCascade": E  // upper bound of final merge count
     *   }
     *
     * `estMergesAfterCascade` approximates how many merges would happen if
     * the user proceeded with `tryMergeAdjacentFaces` — each merge can enable
     * new adjacencies so the exact count is not known without running it.
     * The upper bound = min(mergeable, face_count - 1).
     */
    analyzeMergeCandidates(face_ids: Uint32Array): string;
    /**
     * Tolerance 지정 merge analysis (B1).
     */
    analyzeMergeCandidatesTol(face_ids: Uint32Array, angle_tol_deg: number): string;
    /**
     * Apply or preview an orphan-recovery plan. Wrapped in a single undo
     * frame on apply; preview rolls back to the exact prior snapshot.
     *
     * `plan_json` — `RecoveryPlan` serialised as JSON.
     * `dry_run`   — true = preview (always rolls back); false = apply.
     *
     * Returns `RecoveryResult` serialised as JSON.
     */
    applyOrphanRecovery(plan_json: string, dry_run: boolean): string;
    /**
     * Linear array — create `count` translated copies of the given
     * faces, each shifted by `offset · k` for k = 1..=count. Returns
     * the new FaceIds in copy-major, source-order.
     */
    arrayLinearFaces(face_ids: Uint32Array, count: number, dx: number, dy: number, dz: number): Uint32Array;
    /**
     * Radial array — rotate `count` copies of the given faces around
     * an axis. Copy `k` is rotated by `total_angle_rad · k / count`
     * about (axis_origin, axis_dir). Returns new FaceIds copy-major.
     */
    arrayRadialFaces(face_ids: Uint32Array, count: number, ox: number, oy: number, oz: number, ax: number, ay: number, az: number, total_angle_rad: number): Uint32Array;
    /**
     * 면에 재질 부여 (material_id_raw = MaterialId의 raw u32 값)
     */
    assign_material(face_ids_raw: Uint32Array, material_id_raw: number): boolean;
    /**
     * New variant: merge failure falls back to SOFT edge (hidden, topology
     * preserved) instead of destroying the adjacent faces. Recommended
     * default for interactive Erase tool.
     */
    batchEraseEdgesSoftFallback(face_ids: Uint32Array, edge_ids: Uint32Array, angle_tol_deg: number, cascade_only: boolean): Int32Array;
    /**
     * Atomic "erase with auto-merge" — primary delete path for the Erase tool.
     *
     * For each edge in `edge_ids`:
     *   1. First try `merge_faces_by_edge_with_tolerance`. If it succeeds the
     *      edge and the two coplanar faces collapse to a single face.
     *   2. If merge fails (non-coplanar, C-slit, etc.) cascade-delete the
     *      edge plus every face touching it.
     *
     * After edge processing, any faces listed in `face_ids` that still exist
     * are removed outright.
     *
     * **Everything runs inside a single undo transaction** so the user
     * presses Ctrl+Z once to restore the original geometry, regardless of
     * how many edges and faces were touched.
     *
     * When `cascade_only == true`, the merge step is skipped entirely —
     * every edge goes straight to cascade-delete. This backs the Shift
     * modifier in the Erase tool.
     *
     * Returns a packed `[merged, cascaded_faces, cascaded_edges]` triple
     * (one i32 each) for the tool to surface in its Toast feedback. All
     * values are >= 0 on success.
     * Batch erase edges (and optional faces).
     *
     * For each edge:
     *   1. cascade_only=true → force hard delete (faces destroyed).
     *   2. else try `merge_faces_by_edge_with_tolerance`:
     *      a) Success → two faces become one.
     *      b) Failure (non-coplanar / non-manifold / material mismatch):
     *         · soft_on_fail=true → mark the edge SOFT (rendering-hidden);
     *           topology intact, two faces read as one surface.
     *         · soft_on_fail=false → cascade-delete faces (legacy behaviour).
     *
     * Returns `[merged, cascaded_faces, cascaded_edges, softened]`.
     * (Older callers that expect length 3 still work since Vec<i32> is
     * returned — JS just reads indices it needs.)
     */
    batchEraseEdgesWithMerge(face_ids: Uint32Array, edge_ids: Uint32Array, angle_tol_deg: number, cascade_only: boolean): Int32Array;
    /**
     * Batch delete faces and edges in a single undo transaction.
     * Called from JS delete action — undo restores everything at once.
     */
    batch_delete(face_ids: Uint32Array, edge_ids: Uint32Array): boolean;
    /**
     * Bend a vertex set around `bend_axis` with angle ramping from 0
     * (at `t=0` along `bend_dir`) to `angle_deg` (at `t=length_limit`).
     * Verts with negative `t` (behind `origin`) are left untouched.
     */
    bendVerts(vert_ids: Uint32Array, ax_x: number, ax_y: number, ax_z: number, dir_x: number, dir_y: number, dir_z: number, ox: number, oy: number, oz: number, angle_deg: number, length_limit: number): boolean;
    /**
     * Boolean 연산 수행
     * faces_a, faces_b: face ID 배열 (u32)
     * op: "union" | "subtract" | "intersect"
     * 반환: JSON 문자열 (결과 정보)
     */
    boolean_op(faces_a: Uint32Array, faces_b: Uint32Array, op: string): string;
    can_redo(): boolean;
    can_undo(): boolean;
    /**
     * Read-only classifier. Returns JSON-serialised `OrphanReport`.
     * See ADR-009 for category definitions (C1 / C2 / C3).
     */
    classifyOrphans(): string;
    /**
     * Clear any analytic curve from an edge (revert to straight line).
     */
    clearEdgeCurve(edge_id: number): boolean;
    /**
     * Clear any analytic surface from a face (revert to polygon).
     */
    clearFaceSurface(face_id: number): boolean;
    /**
     * Collect all edges in the polyline chain containing `edge_id`.
     * Walks through degree-2 vertices and stops at junctions/dead-ends.
     * Empty Vec on invalid / inactive edge.
     */
    collectEdgeChain(edge_id_raw: number): Uint32Array;
    /**
     * 태양 방향으로 ground(y=0)에 투영된 shadow polygon triangle buffer 반환.
     * TS Viewport는 이 buffer를 BufferGeometry에 직접 세팅해 dark translucent
     * mesh로 렌더. 매 syncMesh마다 재계산 (mesh 변경 시 shadow도 즉시 반영).
     *
     * sun_dir 컴포넌트: x, y, z. 라이트 진행 방향이며 y는 음수여야 함
     * (태양이 아래로 비춤). 정규화는 caller가 미리 해도 Rust가 해도 OK —
     * 내부에서 사용 전 normalize 호출.
     *
     * 9 f32 = 1 triangle, 각 vertex는 (x, 0, z).
     */
    computeGroundProjectedShadows(sun_x: number, sun_y: number, sun_z: number): Float32Array;
    /**
     * Count of constraints (active + inactive).
     */
    constraintCount(): number;
    /**
     * Phase H5 — 자유 엣지 개수만 카운트 (dry-run, mesh 불변).
     * UI에서 "N개 자유 엣지 발견 — Face Synthesis 실행?" 안내에 사용.
     *
     * Centerline 엣지는 제외 — 얘네는 "free" 상태로 있는 게 정상이므로
     * Finish→Extrude 트리거에 영향 주지 않아야 함.
     */
    countFreeEdges(): number;
    /**
     * Create an axis-aligned box primitive (6-face closed solid).
     * Returns the bottom face ID for Push/Pull operations.
     */
    create_box(cx: number, cy: number, cz: number, width: number, height: number, depth: number): number;
    /**
     * Create a cone primitive.
     * Returns the base face ID for Push/Pull operations.
     */
    create_cone(cx: number, cy: number, cz: number, radius: number, height: number, segments: number): number;
    /**
     * Create a cylinder primitive.
     * Returns the base face ID for Push/Pull operations.
     */
    create_cylinder(cx: number, cy: number, cz: number, radius: number, height: number, segments: number): number;
    /**
     * 선택된 face들을 그룹으로 생성
     * 반환: group ID (성공) 또는 0 (실패)
     */
    create_group(name: string, face_ids: Uint32Array): number;
    /**
     * Create a sphere primitive (UV sphere).
     * Returns a face ID from the sphere for Push/Pull operations.
     */
    create_sphere(cx: number, cy: number, cz: number, radius: number, u_segments: number, v_segments: number): number;
    /**
     * Delete an edge plus all faces sharing it. Returns the cascaded face count
     * (>= 0 on success, -1 on failure). TS wraps this to inform the user how
     * many faces were removed as a side effect.
     */
    deleteEdgeCascade(edge_id_raw: number): number;
    /**
     * Delete an edge (and its half-edges) from the mesh.
     * Also removes any faces that reference this edge (SketchUp-style cascade).
     *
     * Legacy signature returning just bool — calls the cascaded_count version.
     * New code should prefer `delete_edge_cascade` which reports how many faces
     * were removed so the UI can show a toast.
     */
    delete_edge(edge_id_raw: number): boolean;
    /**
     * Force-delete a face from the mesh.
     *
     * Wrapped in an undo transaction (Bug #1 fix, 2026-04-17) — previously
     * this op mutated the mesh without recording a snapshot, causing Ctrl+Z
     * to skip past the deletion to an earlier command.
     */
    delete_face(face_id_raw: number): boolean;
    /**
     * 그룹 해제
     */
    delete_group(group_id: number): boolean;
    /**
     * ADR-032 P17 — Draw a tessellated arc and attach analytic Arc curves
     * to each segment edge in one atomic op.
     *
     * Encapsulates the DrawArc tool's full promotion path: tessellate +
     * drawLine ×N + setEdgeArcCurve ×N, all in a single transaction.
     * Returns 0.0 on success, -1.0 on any error.
     */
    drawArcWithCurve(cx: number, cy: number, cz: number, radius: number, nx: number, ny: number, nz: number, ux: number, uy: number, uz: number, start_angle: number, end_angle: number, segments: number): number;
    /**
     * ADR-032 P17 — Atomic B-spline drawing with curve promotion.
     * Like Bezier; same curve metadata replicated on each segment edge.
     */
    drawBSplineWithCurve(control_pts_flat: Float64Array, knots: Float64Array, degree: number): number;
    /**
     * ADR-032 P17 — Atomic Bezier drawing with analytic curve promotion.
     *
     * `control_pts_flat`: 3·(n+1) floats. `segments`: tessellation count.
     * All N segment edges receive the SAME Bezier curve metadata (the full
     * curve), since Bezier doesn't sub-divide naturally per-segment without
     * re-parameterization. View-time tessellation uses the full curve.
     *
     * Returns 0 on success, -1 on error.
     */
    drawBezierWithCurve(control_pts_flat: Float64Array, segments: number): number;
    /**
     * Draw a centerline (reference axis). Unlike drawLine, bypasses
     * intersection-split / face synthesis / loop detection. Creates one
     * edge tagged Centerline; crossing other edges does not split them.
     * Returns the new edge raw id, or -1 on failure.
     */
    drawCenterline(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number;
    /**
     * ADR-012 §3 BatchCommand — N 개 연속 line 을 단일 WASM crossing 에 묶는다.
     * `points`: 평탄화된 [x0,y0,z0,x1,y1,z1,…] 배열 (3 의 배수). N point ⇒
     * (N-1) 개 line.
     * 반환: 마지막으로 만들어진 segment 의 결과 — 0 (success) 또는 -1.
     * 호출자: DrawArcTool / DrawFreehandTool / DrawBezierTool — 이전엔 N
     * 회 crossing 했지만 이제 1 회. 단일 트랜잭션 (Ctrl+Z 1회로 전체 되돌림).
     */
    drawPolyline(points: Float64Array): number;
    draw_circle(cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, radius: number, segments: number): number;
    draw_line(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, nx: number, ny: number, nz: number): number;
    draw_rect(cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, ux: number, uy: number, uz: number, width: number, height: number): number;
    /**
     * 엣지 가시성 임계 각도(도) 조회. StylePanel 슬라이더 초기화에 사용.
     */
    edgeAngleThreshold(): number;
    /**
     * Get an edge's semantic class as u32 (0=Geometry, 1=Centerline).
     * Returns 0 for missing/inactive edges (safe default).
     */
    edgeClass(edge_id_raw: number): number;
    /**
     * Check whether an edge has an analytic curve attached.
     * Returns: 0 = none/straight, 1 = Line, 2 = Circle, 3 = Arc,
     * 4 = Bezier, 5 = BSpline, 6 = NURBS. -1 if edge_id invalid.
     */
    edgeCurveKind(edge_id: number): number;
    /**
     * ADR-016 §2 — true ⇔ this edge is on the hole boundary of any active face.
     * JS hover layer uses this to show an explicit-op hint instead of the
     * generic cascade-red preview.
     */
    edgeIsHoleBoundary(edge_id_raw: number): boolean;
    /**
     * edgeLength returns the straight-line distance between an edge's
     * two endpoints. Zero on missing / degenerate edge.
     */
    edgeLength(edge_id_raw: number): number;
    /**
     * ADR-040 Stage 2 — analytic ray-to-edge distance.
     *
     * For an edge with `Edge.curve = Some(AnalyticCurve)`, returns the
     * perpendicular distance (mm) from the cursor ray line to the
     * closest point on the analytic curve, plus the closest point.
     *
     * Return shape: `Float64Array([distance, px, py, pz, t_on_curve])`
     * — 5 elements. On failure (no curve / edge invalid / Newton diverges),
     * returns an empty array. Caller (TS) treats empty as "fall back to
     * polyline BVH" per P25.4.
     *
     * `ray_dir` MUST be unit length. Caller is responsible for
     * normalisation. (Avoids per-call sqrt at the boundary.)
     */
    edgeRayDistance(edge_id: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Float64Array;
    /**
     * ADR-016 §2 (Path B) — Erase + Re-synthesize.
     *
     * 사용자 정책: "바운더리가 깨지면 새 boundary 찾아서 새 면 생성".
     * fast-path (`merge_faces_by_edge`) 가 거부하는 hole boundary edge 등
     * 비정형 케이스 처리. 인접 face soft-remove → edge 제거 → free-edge
     * re-resolver 실행.
     *
     * Returns JSON `{ ok, removedFaces, newFaces, cleanedEdges, cleanedVerts, error? }`.
     * 트랜잭션 1 개 (Ctrl+Z 한 번에 원복).
     */
    eraseEdgeResynthesize(edge_id_raw: number, cleanup_dangling: boolean): string;
    /**
     * ADR-007 Phase 5 — 엄격 export: invariant 위반 시 빈 배열 반환 + lastError 설정.
     * 파일 저장 대화창 등에서 데이터 무결성이 중요한 경우 사용.
     */
    exportSnapshotStrict(): Uint8Array;
    /**
     * 프로젝트 데이터를 바이너리 스냅샷으로 내보내기 (versioned format with magic bytes)
     */
    export_snapshot(): Uint8Array;
    /**
     * Measure helpers — pure queries, no state mutation.
     *
     * faceArea returns the planar area of a single face (fan-triangulated
     * cross-product magnitude / 2). Returns 0 on error / missing face.
     */
    faceArea(face_id_raw: number): number;
    /**
     * Face 가 분석적 surface (Plane/Cylinder/Sphere/Cone/Torus/NURBS) 를
     * 가지고 있는지 여부.
     *
     * ADR-038 P23.4 — Three.js Viewport.smoothNormals 가 analytic evaluate
     * 결과를 덮어쓰지 않도록 식별 메타데이터. `true` 인 face 의 vertex
     * normal 은 Rust 의 `surface.normal(u, v)` 로 계산된 정확한 값을
     * 유지해야 함.
     *
     * `face_id` 가 무효 / inactive 면 `false`.
     */
    faceHasAnalyticSurface(face_id_raw: number): boolean;
    /**
     * Number of inner hole loops on a face. 0 = simple face.
     * Returns u32::MAX when the face is missing or inactive.
     */
    faceInnerLoopCount(face_id_raw: number): number;
    /**
     * Surface kind: 0 = none, 1 = Plane, 2 = Cylinder, 3 = Sphere,
     * 4 = Cone, 5 = Torus, 6 = BezierPatch, 7 = BSplineSurface,
     * 8 = NURBSSurface, -1 = invalid face id.
     */
    faceSurfaceKind(face_id: number): number;
    face_count(): number;
    /**
     * face 집합의 중심점 반환 [x, y, z]
     */
    faces_centroid(face_ids: Uint32Array): Float64Array;
    /**
     * Round off a single edge into a cylindrical arc of the given
     * radius, sampled with `segments` quads. Returns the count of new
     * fillet strip quads on success (>= 2), or -1 on failure with
     * `lastError()` populated.
     */
    filletEdge(edge_id_raw: number, radius: number, segments: number): number;
    /**
     * Diagnose non-manifold edges (ADR-007 I5) without modifying the
     * scene. Returns JSON: `{count, edges:[{edge, faceCount}, …]}`.
     * Useful for the UI's "씬 무결성 검사" command.
     */
    findNonManifoldEdges(): string;
    /**
     * 주어진 world 좌표 (x,y,z) 에 가장 가까운 활성 vertex 의 VertId 반환.
     * `tol` 거리 안에 vertex 가 없으면 -1.
     *
     * Move tool 의 vertex pick 경로 — 사용자가 endpoint snap 위에서 클릭한
     * 위치를 VertId 로 변환하여 단일 정점 이동을 가능하게 한다.
     */
    findVertexIdAt(x: number, y: number, z: number, tol: number): number;
    /**
     * **User-triggered Face Reverse** (SketchUp "Reverse Faces").
     *
     * Flips orientation of the given faces. Locked (inside grouped/component)
     * faces are silently skipped. Wrapped in a single undo transaction so the
     * whole batch restores with one Ctrl+Z.
     *
     * Returns the count of faces actually flipped.
     */
    flipFaces(face_ids: Uint32Array): number;
    getAutoIntersectOnDraw(): boolean;
    /**
     * Get the current cache version (monotonic counter).
     * Used by JavaScript to validate delta buffer freshness.
     */
    getCacheVersion(): number;
    /**
     * Get centerline edge segments for separate rendering (dashed/thin/dimmer).
     * Flat [x0,y0,z0, x1,y1,z1, ...] — pair per segment.
     * Not cached — centerlines are typically fewer and changes infrequently,
     * but if perf becomes an issue we can cache like getEdgeLines.
     */
    getCenterlineLines(): Float32Array;
    /**
     * Export incremental geometry updates for dirty faces.
     *
     * Two modes:
     * - **topology_changed = true**: Topology was modified (draw/push_pull/delete/boolean).
     *   Returns a DeltaBuffers with topology_changed=true and empty data.
     *   JS must do a full rebuild via getMeshBuffers().
     *
     * - **topology_changed = false**: Only vertex positions changed (translate/rotate/scale).
     *   Returns the new positions/normals for dirty faces with their offsets
     *   into the full buffer, so JS can patch in-place.
     *
     * Returns None if nothing changed since last export.
     * Clears dirty_faces and topology_changed after export.
     */
    getDirtyFaceBuffers(): DeltaBuffers | undefined;
    /**
     * Get dirty face count (for debugging)
     */
    getDirtyFaceCount(): number;
    /**
     * Edge의 두 끝점 VertId를 반환 ([v_small, v_large]).
     * 실패 시 빈 벡터.
     */
    getEdgeEndpoints(edge_id_raw: number): Uint32Array;
    /**
     * Edge visibility angle threshold (도) — Rust 의 SSOT.
     *
     * ADR-038 P23.3 — Three.js Viewport.smoothNormals 가 hardcode 30° 대신
     * 본 값을 사용해야 hard/soft edge 판정이 두 layer 에서 일치.
     *
     * 현재 값: `axia_geo::tolerances::EDGE_VISIBILITY_ANGLE_DEG = 20.1`
     */
    getEdgeVisibilityAngleDeg(): number;
    getFaceMapLen(): number;
    getFaceMapPtr(): number;
    /**
     * Return the outer-loop vertex IDs of a face in walk order.
     * Empty vec on error (face missing, degenerate, etc.).
     */
    getFaceVertices(face_id_raw: number): Uint32Array;
    /**
     * ADR-007 Rev 2 — 모든 active face 의 분류를 비트 array (Uint8) 로
     * 일괄 반환. 인덱스는 mesh buffer 의 face_map 슬롯과 1:1 매핑이
     * 아니라 raw FaceId 와 1:1. 호출자(Viewport.syncMesh)는 face_map
     * 으로 lookup 하면 됨.
     *
     * 반환: 활성 face 마다 1 = Wall, 0 = Sheet.
     * 길이 = max active FaceId raw + 1 (편의상 sparse vec).
     */
    getFaceVolumeFlags(): Uint8Array;
    getIndicesLen(): number;
    getIndicesPtr(): number;
    /**
     * Per-`getMeshBuffers` skip diagnostics — JSON. Counts faces dropped at
     * each silent-skip path inside `Mesh::export_buffers`. Use to debug
     * "face is active in mesh but invisible in render" symptoms.
     */
    getLastExportSkipStats(): string;
    /**
     * ADR-047 R-track — non-manifold edge endpoints for rendering overlay.
     *
     * Returns `Float32Array` of `[x0,y0,z0, x1,y1,z1, ...]` line segments
     * (2 endpoints × 3 coords per non-manifold edge). The renderer uses
     * this to draw a highlight outline on edges shared by ≥3 active
     * faces — these are ADR-021 P7 stacked-inner artifacts; without
     * the highlight users mistake the overlapping faces for "missing
     * face / wireframe only" (z-fight visual confusion).
     */
    getNonManifoldEdgeSegments(): Float32Array;
    getNormalsLen(): number;
    getNormalsPtr(): number;
    /**
     * Get vertex positions in f64 precision (CAD-grade).
     * Same layout as get_positions() but Float64Array — no f32 truncation.
     * Use for dimension display, snap matching, and precision-sensitive operations.
     */
    getPositionsF64(): Float64Array;
    getPositionsLen(): number;
    /**
     * ADR-013 §4 zero-copy view — returns raw pointer + length so JS can
     * build a `Float32Array(memory.buffer, ptr, len)` without copying.
     * Caller MUST refresh after any WASM allocation (memory may grow).
     * 길이/포인터 둘 다 필요하므로 별도 함수 2개로 노출.
     */
    getPositionsPtr(): number;
    /**
     * Get unique vertex positions in f64 precision for snap system.
     * Returns flat [x0,y0,z0, x1,y1,z1, ...] as Float64Array.
     * Snap system should use these instead of the f32 render buffers.
     */
    getSnapVerticesF64(): Float64Array;
    /**
     * Vertex 위치를 [x, y, z]로 반환. 실패 시 빈 벡터.
     */
    getVertexPos(vert_id_raw: number): Float64Array;
    /**
     * 주어진 XIA가 소유한 모든 face ID 반환 (B3 — 그룹 병합용).
     * 빈 배열이면 해당 XIA가 없거나 비어 있음.
     */
    getXiaFaceIds(xia_id: number): Uint32Array;
    /**
     * 씬에 존재하는 모든 XIA ID를 반환. 디버깅/열거용.
     */
    getXiaIds(): Uint32Array;
    /**
     * 특정 XIA ID에 대한 요약 JSON.
     * `get_xia_info`는 face ID를 받지만, 이 함수는 **XIA ID를 직접 받는다**.
     * 내부적으로 해당 XIA의 모든 face_ids를 수집해 `get_xia_info`와 동일한 JSON을 반환.
     *
     * XIA가 없으면 `{"empty":true}` 반환.
     */
    getXiaStats(xia_id: number): string;
    /**
     * 전체 그룹 트리 JSON 반환
     */
    get_all_groups(): string;
    /**
     * 전체 재질 목록 JSON 반환 (format! 기반, serde_json 불필요)
     */
    get_all_materials(): string;
    /**
     * DCEL 위상(topology) 기반으로 seedFace에 연결된 모든 face를 BFS 탐색.
     * half-edge의 radial partner(next_rad)를 통해 edge를 공유하는 인접 face를 찾습니다.
     * 좌표 비교 없이 순수 위상 구조만 사용 → 다른 Volume의 face가 섞이지 않음.
     */
    get_connected_faces(seed_face_raw: number): Uint32Array;
    /**
     * Get hard edge line segments for wireframe rendering.
     * Returns flat [x0,y0,z0, x1,y1,z1, ...] — use with THREE.LineSegments.
     * Coplanar edges (angle ≤ 15°) are automatically hidden.
     * Centerline edges are excluded — call getCenterlineLines() separately.
     */
    get_edge_lines(): Float32Array;
    /**
     * Edge line segment index → EdgeId raw value mapping.
     * segment[i]의 EdgeId = edge_map[i]
     */
    get_edge_map(): Uint32Array;
    /**
     * Get the FaceId for each triangle (one u32 per triangle).
     * Use: face_map[triangleIndex] → FaceId for push_pull.
     */
    get_face_map(): Uint32Array;
    /**
     * 면의 재질 ID 조회 (없으면 0 반환, 0 = 기본 재질)
     */
    get_face_material(face_id_raw: number): number;
    get_face_normal(face_id_raw: number): Float64Array;
    /**
     * 그룹의 모든 face ID 반환 (재귀적)
     */
    get_group_faces(group_id: number): Uint32Array;
    /**
     * face가 속한 그룹 ID 조회 (없으면 0 반환)
     */
    get_group_for_face(face_id_raw: number): number;
    /**
     * 그룹 정보 JSON 반환
     */
    get_group_info(group_id: number): string;
    get_indices(): Uint32Array;
    get_normals(): Float32Array;
    get_positions(): Float32Array;
    get_stats(): string;
    /**
     * Returns the first face ID owned by the given XIA ID.
     * draw_rect/draw_circle return XIA IDs; push_pull expects face IDs.
     * Returns u32::MAX on failure.
     */
    get_xia_face(xia_id: number): number;
    /**
     * face가 속한 XIA의 ID 반환 (O(1) 역인덱스)
     * 없으면 u32::MAX 반환
     */
    get_xia_for_face(face_id_raw: number): number;
    /**
     * ⚠️ **파라미터는 FACE IDs** (XIA IDs 아님). XIA Inspector가 선택된 면들의
     * 집계 속성을 계산하기 위한 함수. 이름의 "xia"는 "XIA 관점의 속성"이라는 뜻.
     *
     * - 입력: 선택된 face ID 배열
     * - 출력 JSON: { isSolid, bbox{minX..maxZ}, length, width, height,
     *   surfaceArea, volume, faceCount, vertCount, edgeCount, snapPoints, shapeType }
     *
     * 특정 XIA 하나의 정보가 필요하면 먼저 `get_xia_face(xia_id)`로 대표 face를 얻은
     * 뒤 그 XIA의 모든 face_ids를 수집해 이 함수에 전달하거나, 새 `get_xia_stats` 사용.
     */
    get_xia_info(face_ids_raw: Uint32Array): string;
    /**
     * 그룹 수
     */
    group_count(): number;
    /**
     * DXF 파일 바이트를 파싱하여 DCEL 메시로 가져오기
     * 반환: JSON 문자열 (통계 정보)
     */
    import_dxf(data: Uint8Array): string;
    /**
     * 바이너리 스냅샷으로부터 프로젝트 복원 (supports versioned and legacy formats)
     */
    import_snapshot(data: Uint8Array): boolean;
    /**
     * ADR-030 Phase C — Compute intersections between two edges' analytic
     * curves. Returns a flat Float64Array `[x0, y0, z0, t1_0, t2_0, angle_0,
     * x1, y1, z1, t1_1, t2_1, angle_1, ...]` — 6 floats per intersection.
     *
     * If either edge has no curve attached, the edge is treated as a straight
     * line between its two endpoints.
     */
    intersectEdges(edge_id_a: number, edge_id_b: number, tol: number): Float64Array;
    /**
     * "Intersect with Model" — SketchUp 스타일 수동 교차선 생성.
     * 선택된 face 들과 나머지 active face 사이의 3D 교차선을 edge 로 변환.
     * inside/outside 판정 없이 모든 sub-face 유지.
     *
     * 반환: 성공 시 {"ok":true,"faceCount":N,"totalFaces":M}
     *       실패 시 {"ok":false,"error":"..."}
     */
    intersectWithModel(face_ids: Uint32Array): string;
    /**
     * 마지막 verify_face_invariants 결과를 요약 JSON으로 반환.
     * UI에서 "정합성 검사" 버튼에 바인딩.
     * ADR-007 Rev 2 — face 가 닫힌 볼륨의 일원(Wall)인지 stand-alone
     * sheet 인지 판정. 렌더러가 sheet 는 양면, wall 은 single-sided
     * 로 표시하는데 사용.
     */
    isFaceInVolume(face_id_raw: number): boolean;
    /**
     * face가 잠긴 그룹에 속하는지 확인
     */
    is_face_locked(face_id_raw: number): boolean;
    /**
     * 최근 실패한 연산의 에러 메시지를 반환. 실패 이력이 없으면 빈 문자열.
     * TypeScript Bridge가 연산 반환값이 false일 때 이 값을 Toast로 표시.
     */
    lastError(): string;
    /**
     * Diagnostic — first merge failure reason from the most recent
     * `batchEraseEdgesWithMerge` call. Empty string if no failure or no
     * call yet. Intended for the debug-mode Toast in the Erase tool.
     */
    lastMergeFailureReason(): string;
    /**
     * List all constraints as JSON.
     * Format: [{id, kind, active, refs:[...], value}, ...]
     */
    listConstraints(): string;
    /**
     * Loft N cross-sections into a continuous surface. `sections_flat` is
     * a flat f64 array containing every point of every section as xyz
     * triples; `section_size` says how many POINTS (not floats) are in
     * each section. All sections must be the same size.
     *
     * `closed_sections` treats each section as a closed ring (the last
     * point wraps to the first).
     *
     * Returns the new FaceIds in section-major, point-minor order.
     * Single undo transaction.
     */
    loftSections(sections_flat: Float64Array, section_size: number, closed_sections: boolean): Uint32Array;
    /**
     * 그룹을 컴포넌트로 변환
     */
    make_component(group_id: number, name: string): number;
    /**
     * **Level 3**: max residual across all active constraints at current state.
     * For monitoring / UI status without mutating the mesh.
     */
    maxConstraintResidual(): number;
    /**
     * Phase F — 비인접 coplanar 포함 병합 (ADR-006 C1).
     * outer_face 안에 inner_face가 완전히 들어 있으면 inner를 hole로 합침.
     * Returns new face ID, or -1 on failure (lastError set).
     */
    mergeCoplanarContaining(outer_face_raw: number, inner_face_raw: number, angle_tol_deg: number): number;
    /**
     * 2026-04-24 — Geometric merge of two coplanar adjacent faces even when
     * they don't share an exact DCEL edge (different-sized boundaries).
     * Used by the "두 면 기하 병합" menu action when user selects 2 faces.
     */
    mergeCoplanarFacesGeometric(f1_raw: number, f2_raw: number, angle_tol_deg: number): number;
    /**
     * Merge the two coplanar faces sharing the given edge into a single face.
     *
     * - Success: returns the new merged FaceId (>= 0).
     * - Failure: returns -1 and sets lastError (e.g. "not coplanar",
     *   "shares multiple edges", "edge not shared by exactly 2 faces").
     *
     * Wrapped in a single undo transaction.
     */
    mergeFacesByEdge(edge_id_raw: number): number;
    /**
     * Tolerance 지정 단일 엣지 병합 (B1).
     * `angle_tol_deg` — 허용 각도 (°). 기본 0.5° (strict). 관대하게는 2~5°.
     */
    mergeFacesByEdgeTol(edge_id_raw: number, angle_tol_deg: number): number;
    /**
     * Analyse the whole active mesh for solid-closure status.
     * Returns JSON: {face_count, interior_edge_count, boundary_edge_count,
     *                non_manifold_edge_count, is_closed_solid}.
     * Used by the Solidify action to report before/after state to the user.
     */
    meshManifoldInfo(): string;
    /**
     * meshVolume returns the signed enclosed volume of the whole mesh.
     * Exact for closed solids; indicative only for open shells.
     */
    meshVolume(): number;
    /**
     * Mirror the given faces across a plane. Returns the new FaceIds
     * in the same order as the input (empty vec on failure, with
     * `lastError()` set). Single undo transaction wraps the whole batch.
     */
    mirrorFaces(face_ids: Uint32Array, ox: number, oy: number, oz: number, nx: number, ny: number, nz: number): Uint32Array;
    constructor();
    /**
     * Phase H — Import Normalizer 실행 (ADR-007 Barrier).
     *
     * 외부 파일에서 들어온 mesh 데이터를 AXiA 네이티브 규칙에 맞춰 정리.
     * 반환: JSON 리포트 {degenerateRemoved, windingFlipped, normalsRecomputed,
     *                    isolatedVertsRemoved, remainingViolations}
     *
     * `options_json`: {remove_degenerate, normalize_winding, recompute_normals,
     *                  remove_isolated_verts, degenerate_tolerance}
     *                 — 생략/빈문자면 기본값 사용.
     */
    normalizeForImport(options_json: string): string;
    /**
     * ADR-027 Phase G3 — NURBS Boolean (UI integration, 2026-05-XX).
     *
     * Performs a parameter-space Boolean operation between two
     * `BSplineSurface` faces. Both faces must carry an attached
     * `Edge.surface = Some(BSplineSurface)` (kind = 7) — fails with
     * `kind:"unsupported_surface"` otherwise.
     *
     * Returns JSON describing the resulting trim loops:
     * ```json
     * {
     *   "kind": "ok",
     *   "op": "union" | "subtract" | "intersect",
     *   "intersection_chains": <int>,
     *   "trim_a_count": <int>,
     *   "trim_b_count": <int>,
     *   "warning_open_chains_skipped": <bool>,
     *   "tangent_contact": <bool>,
     *   "is_disjoint": <bool>
     * }
     * ```
     * On failure: `{"kind":"error","reason":"<short_id>","detail":"..."}`.
     *
     * MVP — caller (TS) consumes the JSON for Toast feedback. Mesh-level
     * trim application is deferred to follow-up (would require per-face
     * trim_loops storage on `AnalyticSurface::BSplineSurface`, which
     * currently lives only on `NURBSSurface`).
     */
    nurbsBoolean(face_a: number, face_b: number, op: string): string;
    /**
     * Edge(line)를 평행하게 offset하여 새 edge 생성 (선만 복사, 면은 만들지 않음)
     * plane_normal: 참조 평면 법선 (Y-up = 0,1,0)
     */
    offset_edge(edge_id_raw: number, dist: number, pnx: number, pny: number, pnz: number): string;
    /**
     * Offset: face의 경계를 dist만큼 안쪽(+)/바깥쪽(-)으로 오프셋
     * 반환: JSON 결과 { ok, innerFace, stripFaces, ... }
     */
    offset_face(face_id_raw: number, dist: number): string;
    /**
     * Orient all faces for consistent normals.
     * Returns number of faces flipped.
     */
    orient_faces(): number;
    /**
     * Test if a 3D point lies within a face's boundary.
     *
     * Returns true if the point is on the face's plane and inside its edges.
     * Useful for determining if a draw operation should trigger face split.
     */
    pointInFace(face_id_raw: number, x: number, y: number, z: number): boolean;
    /**
     * Dry-run: "if I erase this edge right now, would it merge two coplanar
     * faces (good outcome) or cascade-delete (destructive)?"
     *
     * Returns:
     *   • `[f1, f2]` — the two adjacent faces that would merge into one
     *   • `[]`      — merge would fail; erase would soft-hide or cascade
     *
     * Decision tree mirrors `batch_erase_edges_impl`:
     *   1. Edge must exist + shared by exactly 2 active faces.
     *   2. Faces coplanar at `angle_tol_deg`.
     *   3a. If exactly 1 outer-loop edge shared → standard merge will succeed.
     *   3b. Else (C-slit / no DCEL edge) → require `would_geometric_merge_succeed`
     *       at the same `angle_tol_deg`. This excludes cases where coplanarity
     *       passes but no collinear overlap exists, preventing false-positive
     *       cyan tints (the user clicks expecting merge → SOFT fallback).
     *
     * JS side calls this twice (user_tol → max(user_tol·4, 2°)) to mirror the
     * real path's geometric fallback tolerance widening.
     *
     * Pure inspection — no state mutation, safe to call on every mousemove.
     */
    previewEdgeEraseMerge(edge_id_raw: number, angle_tol_deg: number): Uint32Array;
    /**
     * Push/Pull a face along its normal.
     * dist > 0 = extrude outward (face kept)
     * dist < 0 = recess inward  (face removed)
     */
    push_pull(face_id_raw: number, dist: number): boolean;
    /**
     * Push/Pull a smooth group seamlessly (no gaps, wall faces connect adjacent surfaces)
     *
     * # Parameters
     * - face_ids: Uint32Array of face IDs (wasm-bindgen converts JS Uint32Array → Vec<u32>)
     * - dist: distance to offset (positive = outward)
     *
     * # Returns
     * true if successful
     *
     * # Behavior
     * - NaN/0 distance → no-op, returns true.
     * - Empty group → no-op, returns true.
     * - All faces coplanar → falls back to per-face regular push_pull
     *   (prevents degenerate walls when smooth group contains only split sub-faces).
     */
    push_pull_smooth_group_seamless(face_ids: Uint32Array, dist: number): boolean;
    redo(): boolean;
    /**
     * Remove a constraint by ID. Returns true on success.
     */
    removeConstraint(id: number): boolean;
    /**
     * 그룹에서 face 제거
     */
    remove_faces_from_group(group_id: number, face_ids: Uint32Array): boolean;
    /**
     * 면에서 재질 제거 → XIA가 Volume으로 복귀
     */
    remove_material(face_ids_raw: Uint32Array): boolean;
    /**
     * 그룹 이름 변경
     */
    rename_group(group_id: number, new_name: string): boolean;
    /**
     * Repair non-manifold edges (ADR-007 I5) — XIA-aware where possible,
     * geometric fallback otherwise. Returns JSON report:
     * `{ok, edgesExamined, edgesRepaired, edgesSkipped, facesDetached, vertsCreated}`.
     */
    repairNonManifoldEdges(): string;
    /**
     * Re-solve all active constraints. Returns number of constraints that
     * actually moved geometry.
     */
    resolveAllConstraints(): number;
    /**
     * **Level 3**: iterative XPBD-style solver. Returns a JSON result
     * `{converged, iterations, finalResidual, initialResidual, overConstrained}`.
     * Wraps in a single undo transaction if anything moved.
     */
    resolveConstraintsIterative(max_iter: number, tolerance: number): string;
    /**
     * ADR-021 P7 + ADR-025 P11 — user-triggered "Resynthesize Faces".
     *
     * Sweeps free orphan edges in the mesh for closed simple cycles and
     * synthesizes a face for each. Returns number of new faces created.
     * Use after multi-step edits where face synthesis missed a cycle
     * (e.g. drew RECT → drew other shapes → original face's boundary now
     * looks closed but engine didn't reconnect it).
     *
     * Call site triggers a topology-change so the next syncMesh rebuilds
     * everything (face buffers, edge wireframe, snap cache).
     */
    resynthesizeOrphanFaces(): number;
    /**
     * Revolve a 2D profile (flat array of [x,y,z, x,y,z, …]) around the
     * axis `(origin, dir)` into a surface of revolution. Returns the new
     * FaceIds in profile-major, ring-minor order, or an empty vec on
     * failure (with `lastError` set).
     *
     * Profile vertex order matters — see `operations::revolve` docs.
     * Single undo transaction wraps the whole spin.
     */
    revolveProfile(profile_flat: Float64Array, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, segments: number): Uint32Array;
    /**
     * 지정 정점을 center/axis 기준으로 회전.
     */
    rotateVerts(vert_ids: Uint32Array, cx: number, cy: number, cz: number, ax: number, ay: number, az: number, angle_deg: number): boolean;
    /**
     * 선택된 face들의 정점을 회전
     * cx,cy,cz: 회전 중심, ax,ay,az: 회전축, angle_deg: 각도 (도)
     */
    rotate_faces(face_ids: Uint32Array, cx: number, cy: number, cz: number, ax: number, ay: number, az: number, angle_deg: number): boolean;
    /**
     * 지정 정점을 center 기준으로 스케일. (sx,sy,sz)로 비균일 지원.
     */
    scaleVerts(vert_ids: Uint32Array, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): boolean;
    /**
     * 선택된 face들의 정점을 스케일
     * cx,cy,cz: 스케일 중심, sx,sy,sz: 축별 배율
     */
    scale_faces(face_ids: Uint32Array, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): boolean;
    /**
     * 씬의 high-level 요약 JSON. AI / MCP first-look query 에 적합.
     * 형식:
     * ```json
     * { "xia_count": 3, "face_count": 12, "edge_count": 24,
     *   "free_edge_count": 0, "constraint_count": 0,
     *   "engine_version": "0.1.0", "schema_version": "1.0.0" }
     * ```
     */
    sceneSummary(): string;
    /**
     * Phase 2 — auto_intersect_on_draw 토글. 기본 true.
     */
    setAutoIntersectOnDraw(enabled: boolean): void;
    /**
     * Toggle active flag of a constraint.
     */
    setConstraintActive(id: number, active: boolean): boolean;
    /**
     * 엣지 가시성 임계 각도(도) 설정. 범위 [1.0, 89.0]로 clamp.
     * 변경 시 edge cache 무효화 → 다음 getEdgeLines 호출에 반영.
     * 작은 값: 모든 panel 경계가 보임 (건축/기계 CAD 선호).
     * 큰 값: 부드러운 곡면 유지 (캐릭터 모델 선호).
     */
    setEdgeAngleThreshold(deg: number): void;
    /**
     * Set an analytic Arc curve on an existing edge.
     *
     * Arguments encode the Arc variant of `AnalyticCurve`:
     * - center: cx, cy, cz
     * - radius
     * - normal: nx, ny, nz (must be unit-length, axis of Arc plane)
     * - basis_u: ux, uy, uz (unit, in-plane, defines θ=0 direction)
     * - start_angle, end_angle (radians)
     *
     * Returns true if successful (edge exists), false otherwise.
     */
    setEdgeArcCurve(edge_id: number, cx: number, cy: number, cz: number, radius: number, nx: number, ny: number, nz: number, ux: number, uy: number, uz: number, start_angle: number, end_angle: number): boolean;
    /**
     * ADR-029 Phase B — Set a B-spline curve on an existing edge.
     *
     * `control_pts_flat`: flat array of n+1 control points (3·(n+1) floats).
     * `knots`: m+1 knot values (m = n + degree + 1), non-decreasing.
     * `degree`: spline degree (≥ 1).
     * Returns true if successful and knot vector is valid.
     */
    setEdgeBSplineCurve(edge_id: number, control_pts_flat: Float64Array, knots: Float64Array, degree: number): boolean;
    /**
     * ADR-029 Phase B — Set a Bezier curve on an existing edge.
     *
     * `control_pts_flat` is a flat Float64Array `[x0,y0,z0, x1,y1,z1, ...]`
     * of n+1 control points (n = degree). Need ≥ 2 points (degree ≥ 1).
     * Returns true if successful.
     */
    setEdgeBezierCurve(edge_id: number, control_pts_flat: Float64Array): boolean;
    /**
     * Set an analytic Circle curve on an existing edge.
     * Similar arg layout to `setEdgeArcCurve` but no angle range
     * (full 2π implied).
     */
    setEdgeCircleCurve(edge_id: number, cx: number, cy: number, cz: number, radius: number, nx: number, ny: number, nz: number, ux: number, uy: number, uz: number): boolean;
    /**
     * Change an edge's semantic class. Rejects Geometry→Centerline if the
     * edge bounds an active face (would orphan the face).
     * Returns true on success.
     */
    setEdgeClass(edge_id_raw: number, class_raw: number): boolean;
    /**
     * ADR-030 Phase C — Set a NURBS curve on an existing edge.
     *
     * Args:
     * - `control_pts_flat`: 3·(n+1) floats `[x0,y0,z0, x1,y1,z1, ...]`
     * - `weights`: n+1 strictly-positive weights
     * - `knots`: n + degree + 2 = `(n+1) + degree + 1` non-decreasing values
     * - `degree`: spline degree (≥ 1)
     *
     * Returns true on success.
     */
    setEdgeNurbsCurve(edge_id: number, control_pts_flat: Float64Array, weights: Float64Array, knots: Float64Array, degree: number): boolean;
    /**
     * Set a Cone surface on an existing face.
     */
    setFaceSurfaceCone(face_id: number, ax: number, ay: number, az: number, dx: number, dy: number, dz: number, half_angle: number, rx: number, ry: number, rz: number, u_min: number, u_max: number, v_min: number, v_max: number): boolean;
    /**
     * Set a Cylinder surface on an existing face.
     */
    setFaceSurfaceCylinder(face_id: number, ox: number, oy: number, oz: number, ax: number, ay: number, az: number, radius: number, rx: number, ry: number, rz: number, u_min: number, u_max: number, v_min: number, v_max: number): boolean;
    /**
     * Set a Plane surface on an existing face.
     * Args: origin (3), normal (3), basis_u (3), u_range (2), v_range (2).
     */
    setFaceSurfacePlane(face_id: number, ox: number, oy: number, oz: number, nx: number, ny: number, nz: number, ux: number, uy: number, uz: number, u_min: number, u_max: number, v_min: number, v_max: number): boolean;
    /**
     * Set a Sphere surface on an existing face.
     */
    setFaceSurfaceSphere(face_id: number, cx: number, cy: number, cz: number, radius: number, u_min: number, u_max: number, v_min: number, v_max: number): boolean;
    /**
     * Set a Torus surface on an existing face.
     */
    setFaceSurfaceTorus(face_id: number, cx: number, cy: number, cz: number, ax: number, ay: number, az: number, rx: number, ry: number, rz: number, major_radius: number, minor_radius: number, u_min: number, u_max: number, v_min: number, v_max: number): boolean;
    /**
     * 중첩 그룹 설정
     */
    set_group_parent(child_id: number, parent_id: number): boolean;
    /**
     * Sheet 2D Boolean (Tier 4 B-5).
     * 두 coplanar Sheet face에 대해 union/subtract/intersect 수행.
     * op: "union" | "subtract" | "intersect"
     * 반환: JSON `{ok, resultFace}` 또는 `{ok:false, error}`
     */
    sheetBoolean(a: number, b: number, op: string): string;
    /**
     * Slice (Plane Cut) — split a closed Wall volume into two volumes.
     *
     * Inputs:
     *   `face_ids`     — face IDs of a single closed volume (one XIA).
     *   `origin_x/y/z` — point on the cutting plane (mm).
     *   `normal_x/y/z` — plane normal (any non-zero length, will be normalized).
     *
     * Returns: JSON `{ok, newXia, aboveCount, belowCount}` or `{ok:false, error}`.
     * On success the original XIA keeps the above half; the below half is
     * returned as a new XIA id.
     */
    sliceVolumeByPlane(face_ids: Uint32Array, origin_x: number, origin_y: number, origin_z: number, normal_x: number, normal_y: number, normal_z: number): string;
    /**
     * Phase D (ADR-008 Axiom 9 row 3): forced polygon-mesh merge.
     *
     * For 2+ faces the user selected and explicitly asked to "merge" even
     * though they are not coplanar, we don't actually fuse them into a
     * single polygon (that would require non-planar face regions, which
     * violates ADR-007's Invariant 3). Instead we identify every edge
     * interior to the selection — edges whose radial loop contains two or
     * more of the selected faces — and mark those edges SOFT. The faces
     * stay distinct topologically, but the renderer hides the internal
     * seams so the selection reads as one continuous smooth surface.
     *
     * Returns the number of edges softened. Wrapped in a single undo
     * transaction. If fewer than two selected faces share any edge, the
     * return value is 0 (caller can surface a Toast).
     */
    softenInternalEdges(face_ids: Uint32Array): number;
    /**
     * Edge를 지정 위치에서 split하여 새 vertex를 생성하고 edge를 2개로 나눈다.
     * 반환: 성공 시 새 vertex id (>=0), 실패 시 -1.
     * position이 엣지 선분 밖이면 가까운 쪽으로 clamp.
     * 내부적으로 mesh.split_edge를 호출하고 단일 undo 트랜잭션으로 감쌈.
     */
    splitEdge(edge_id_raw: number, px: number, py: number, pz: number): number;
    /**
     * Split a face by drawing a line segment across it.
     *
     * Both endpoints should be on the face's boundary (on an edge or at a vertex).
     * Creates two new faces from the original face.
     *
     * # Parameters
     * - face_id_raw: the face to split
     * - x0, y0, z0: line start point
     * - x1, y1, z1: line end point
     *
     * # Returns
     * JSON string with split result info, or empty string on failure.
     */
    splitFaceByLine(face_id_raw: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): string;
    /**
     * Apply one level of Catmull-Clark subdivision to the whole mesh.
     * Returns the count of new quads on success, or -1 on failure.
     * Wrapped in a single undo transaction so one Ctrl+Z restores the
     * original topology.
     */
    subdivideCatmullClark(): number;
    /**
     * Sweep a 2D profile along a 3D path, producing one ring of vertices
     * per path point and stitching them with `loft`. `profile_flat` is
     * K points (xyz triples) in a local XY plane; `path_flat` is M points
     * (xyz triples) in world space. `closed_profile` treats the profile
     * as a closed ring. Returns new FaceIds; empty on failure.
     */
    sweepProfileAlongPath(profile_flat: Float64Array, path_flat: Float64Array, closed_profile: boolean): Uint32Array;
    /**
     * Phase H5 — 자유 엣지 → Face Synthesis (사용자 수동 트리거).
     *
     * 닫힌 polygon을 이루는 free edges를 감지해 face로 전환.
     * 2D DXF 도면 import 후 "평면도 → 면 생성"에 유용.
     *
     * **사용자 명시 호출만** — import 직후 자동 실행 안 함 (의도 왜곡 방지).
     *
     * 반환: 생성된 face 개수 (감지 실패 / 이미 face로 처리됨 시 0)
     */
    synthesizeFacesFromFreeEdges(): number;
    /**
     * Taper a vertex set along `(axis_origin, axis_dir)` from
     * `start_scale` at t=0 to `end_scale` at t=length.
     */
    taperVerts(vert_ids: Uint32Array, ox: number, oy: number, oz: number, ax: number, ay: number, az: number, start_scale: number, end_scale: number, length: number): boolean;
    /**
     * Tessellate an edge into a polyline approximating its curve within
     * `chord_tol` (mm).
     *
     * - For straight edges (no curve attached), returns 6 floats — the two
     *   endpoint positions: `[x0,y0,z0, x1,y1,z1]`.
     * - For curved edges (Arc, Circle), returns 3·n floats where n = number
     *   of tessellation points. n+1 points for n segments — first and last
     *   coincide for full circles.
     *
     * The result is a flat `Float64Array` for zero-copy WASM transfer.
     * Returns empty array if edge_id is invalid.
     */
    tessellateEdge(edge_id: number, chord_tol: number): Float64Array;
    /**
     * Tessellate a face's analytic surface for rendering. Returns flat
     * `[v_count, t_count, vx, vy, vz, ..., t0_a, t0_b, t0_c, t1_a, ...]`.
     * Returns empty array if face has no surface.
     */
    tessellateFaceSurface(face_id: number, chord_tol: number): Float64Array;
    /**
     * 그룹 잠금 토글
     */
    toggle_group_lock(group_id: number): boolean;
    /**
     * 그룹 가시성 토글
     */
    toggle_group_visibility(group_id: number): boolean;
    /**
     * 지정 정점 배열을 delta만큼 이동. Constraint Solver에서 makeParallel/
     * Perpendicular/setDistance의 기초 연산으로 사용.
     */
    translateVerts(vert_ids: Uint32Array, dx: number, dy: number, dz: number): boolean;
    /**
     * 선택된 face들의 정점을 이동
     */
    translate_faces(face_ids: Uint32Array, dx: number, dy: number, dz: number): boolean;
    /**
     * Try to merge adjacent coplanar faces in the given selection.
     *
     * Iteratively finds pairs of faces that share exactly one edge and are
     * coplanar, merges them, and repeats until no more pairs qualify.
     * Returns the number of merges actually performed.
     *
     * All merges are wrapped in a single undo transaction.
     */
    tryMergeAdjacentFaces(face_ids: Uint32Array): number;
    /**
     * Tolerance 지정 인접 면 반복 병합 (B1).
     */
    tryMergeAdjacentFacesTol(face_ids: Uint32Array, angle_tol_deg: number): number;
    /**
     * Twist a vertex set around `(axis_origin, axis_dir)` with
     * `degrees_per_unit` degrees of rotation per unit of axial distance.
     */
    twistVerts(vert_ids: Uint32Array, ox: number, oy: number, oz: number, ax: number, ay: number, az: number, degrees_per_unit: number): boolean;
    undo(): boolean;
    verifyInvariants(): string;
    /**
     * ADR-007 원칙 1 확장 — 닫힌 solid의 outward normal 검증.
     * 반환 JSON: {isClosedSolid, checkedFaces, inwardCount, inwardFaces[]}
     */
    verifyOutwardNormals(): string;
    vert_count(): number;
    /**
     * 씬의 XIA 개수.
     */
    xiaCount(): number;
}

/**
 * Delta buffers for incremental mesh updates (Phase 1 Optimization).
 *
 * Two modes:
 * 1. **Position-only delta** (translate/rotate/scale): topology unchanged,
 *    only vertex positions & normals updated. JS patches the existing buffer
 *    at the given offsets — no geometry rebuild needed.
 * 2. **Topology changed** (draw/push_pull/delete/boolean/offset):
 *    returns topology_changed=true, JS must do a full rebuild.
 *
 * Design: Each dirty face's new positions/normals are packed contiguously.
 * `face_vert_offsets[i]` tells JS where face i's data starts in the
 * FULL cached buffer (so JS patches at the right position).
 * `face_vert_counts[i]` tells JS how many vertices (×3 floats) per face.
 */
export class DeltaBuffers {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    getCacheVersion(): number;
    /**
     * Number of vertices for each dirty face.
     */
    getFaceVertCounts(): Uint32Array;
    /**
     * Vertex offsets into the FULL buffer for each dirty face.
     * `face_vert_offsets[i]` is the vertex index (not byte) where
     * face i starts in the full position buffer.
     */
    getFaceVertOffsets(): Uint32Array;
    getModifiedFaceIds(): Uint32Array;
    getNormals(): Float32Array;
    getPositions(): Float32Array;
    /**
     * If true, topology changed (faces added/removed) — JS must do full rebuild.
     * If false, only positions/normals changed — JS can patch in-place.
     */
    isTopologyChanged(): boolean;
}

/**
 * Engine build version (axia-wasm crate version). For audit logs and
 * drift detection. ADR-041 P26.2.
 */
export function engine_version(): string;

/**
 * MCP capability schema version (semver). MCP server must satisfy
 * `^MAJOR.MINOR` against this string. ADR-041 P26.2.
 */
export function schema_version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_axiaengine_free: (a: number, b: number) => void;
    readonly __wbg_deltabuffers_free: (a: number, b: number) => void;
    readonly axiaengine_addDistanceConstraint: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_addEdgeConstraint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_add_faces_to_group: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_allXiaIds: (a: number, b: number) => void;
    readonly axiaengine_analyzeMergeCandidates: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_analyzeMergeCandidatesTol: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly axiaengine_applyOrphanRecovery: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly axiaengine_arrayLinearFaces: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly axiaengine_arrayRadialFaces: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly axiaengine_assign_material: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_batchEraseEdgesSoftFallback: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly axiaengine_batchEraseEdgesWithMerge: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly axiaengine_batch_delete: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly axiaengine_bendVerts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => number;
    readonly axiaengine_boolean_op: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly axiaengine_can_redo: (a: number) => number;
    readonly axiaengine_can_undo: (a: number) => number;
    readonly axiaengine_classifyOrphans: (a: number, b: number) => void;
    readonly axiaengine_clearEdgeCurve: (a: number, b: number) => number;
    readonly axiaengine_clearFaceSurface: (a: number, b: number) => number;
    readonly axiaengine_collectEdgeChain: (a: number, b: number, c: number) => void;
    readonly axiaengine_computeGroundProjectedShadows: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly axiaengine_constraintCount: (a: number) => number;
    readonly axiaengine_countFreeEdges: (a: number) => number;
    readonly axiaengine_create_box: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_create_cone: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_create_cylinder: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_create_group: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly axiaengine_create_sphere: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_deleteEdgeCascade: (a: number, b: number) => number;
    readonly axiaengine_delete_edge: (a: number, b: number) => number;
    readonly axiaengine_delete_face: (a: number, b: number) => number;
    readonly axiaengine_delete_group: (a: number, b: number) => number;
    readonly axiaengine_drawArcWithCurve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => number;
    readonly axiaengine_drawBSplineWithCurve: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly axiaengine_drawBezierWithCurve: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_drawCenterline: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_drawPolyline: (a: number, b: number, c: number) => number;
    readonly axiaengine_draw_circle: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly axiaengine_draw_line: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly axiaengine_draw_rect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => number;
    readonly axiaengine_edgeAngleThreshold: (a: number) => number;
    readonly axiaengine_edgeClass: (a: number, b: number) => number;
    readonly axiaengine_edgeCurveKind: (a: number, b: number) => number;
    readonly axiaengine_edgeIsHoleBoundary: (a: number, b: number) => number;
    readonly axiaengine_edgeLength: (a: number, b: number) => number;
    readonly axiaengine_edgeRayDistance: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly axiaengine_eraseEdgeResynthesize: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_exportSnapshotStrict: (a: number, b: number) => void;
    readonly axiaengine_export_snapshot: (a: number, b: number) => void;
    readonly axiaengine_faceArea: (a: number, b: number) => number;
    readonly axiaengine_faceHasAnalyticSurface: (a: number, b: number) => number;
    readonly axiaengine_faceInnerLoopCount: (a: number, b: number) => number;
    readonly axiaengine_faceSurfaceKind: (a: number, b: number) => number;
    readonly axiaengine_face_count: (a: number) => number;
    readonly axiaengine_faces_centroid: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_filletEdge: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_findNonManifoldEdges: (a: number, b: number) => void;
    readonly axiaengine_findVertexIdAt: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly axiaengine_flipFaces: (a: number, b: number, c: number) => number;
    readonly axiaengine_getAutoIntersectOnDraw: (a: number) => number;
    readonly axiaengine_getCacheVersion: (a: number) => number;
    readonly axiaengine_getCenterlineLines: (a: number, b: number) => void;
    readonly axiaengine_getDirtyFaceBuffers: (a: number) => number;
    readonly axiaengine_getDirtyFaceCount: (a: number) => number;
    readonly axiaengine_getEdgeEndpoints: (a: number, b: number, c: number) => void;
    readonly axiaengine_getEdgeVisibilityAngleDeg: (a: number) => number;
    readonly axiaengine_getFaceMapLen: (a: number) => number;
    readonly axiaengine_getFaceMapPtr: (a: number) => number;
    readonly axiaengine_getFaceVertices: (a: number, b: number, c: number) => void;
    readonly axiaengine_getFaceVolumeFlags: (a: number, b: number) => void;
    readonly axiaengine_getIndicesLen: (a: number) => number;
    readonly axiaengine_getIndicesPtr: (a: number) => number;
    readonly axiaengine_getLastExportSkipStats: (a: number, b: number) => void;
    readonly axiaengine_getNonManifoldEdgeSegments: (a: number, b: number) => void;
    readonly axiaengine_getNormalsLen: (a: number) => number;
    readonly axiaengine_getNormalsPtr: (a: number) => number;
    readonly axiaengine_getPositionsF64: (a: number, b: number) => void;
    readonly axiaengine_getPositionsLen: (a: number) => number;
    readonly axiaengine_getPositionsPtr: (a: number) => number;
    readonly axiaengine_getSnapVerticesF64: (a: number, b: number) => void;
    readonly axiaengine_getVertexPos: (a: number, b: number, c: number) => void;
    readonly axiaengine_getXiaFaceIds: (a: number, b: number, c: number) => void;
    readonly axiaengine_getXiaIds: (a: number, b: number) => void;
    readonly axiaengine_getXiaStats: (a: number, b: number, c: number) => void;
    readonly axiaengine_get_all_groups: (a: number, b: number) => void;
    readonly axiaengine_get_all_materials: (a: number, b: number) => void;
    readonly axiaengine_get_connected_faces: (a: number, b: number, c: number) => void;
    readonly axiaengine_get_edge_lines: (a: number, b: number) => void;
    readonly axiaengine_get_edge_map: (a: number, b: number) => void;
    readonly axiaengine_get_face_map: (a: number, b: number) => void;
    readonly axiaengine_get_face_material: (a: number, b: number) => number;
    readonly axiaengine_get_face_normal: (a: number, b: number, c: number) => void;
    readonly axiaengine_get_group_faces: (a: number, b: number, c: number) => void;
    readonly axiaengine_get_group_for_face: (a: number, b: number) => number;
    readonly axiaengine_get_group_info: (a: number, b: number, c: number) => void;
    readonly axiaengine_get_indices: (a: number, b: number) => void;
    readonly axiaengine_get_normals: (a: number, b: number) => void;
    readonly axiaengine_get_positions: (a: number, b: number) => void;
    readonly axiaengine_get_stats: (a: number, b: number) => void;
    readonly axiaengine_get_xia_face: (a: number, b: number) => number;
    readonly axiaengine_get_xia_for_face: (a: number, b: number) => number;
    readonly axiaengine_get_xia_info: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_group_count: (a: number) => number;
    readonly axiaengine_import_dxf: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_import_snapshot: (a: number, b: number, c: number) => number;
    readonly axiaengine_intersectEdges: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly axiaengine_intersectWithModel: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_isFaceInVolume: (a: number, b: number) => number;
    readonly axiaengine_is_face_locked: (a: number, b: number) => number;
    readonly axiaengine_lastError: (a: number, b: number) => void;
    readonly axiaengine_lastMergeFailureReason: (a: number, b: number) => void;
    readonly axiaengine_listConstraints: (a: number, b: number) => void;
    readonly axiaengine_loftSections: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly axiaengine_make_component: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_maxConstraintResidual: (a: number) => number;
    readonly axiaengine_mergeCoplanarContaining: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_mergeCoplanarFacesGeometric: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_mergeFacesByEdge: (a: number, b: number) => number;
    readonly axiaengine_mergeFacesByEdgeTol: (a: number, b: number, c: number) => number;
    readonly axiaengine_meshManifoldInfo: (a: number, b: number) => void;
    readonly axiaengine_meshVolume: (a: number) => number;
    readonly axiaengine_mirrorFaces: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly axiaengine_new: () => number;
    readonly axiaengine_normalizeForImport: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_nurbsBoolean: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly axiaengine_offset_edge: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly axiaengine_offset_face: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_orient_faces: (a: number) => number;
    readonly axiaengine_pointInFace: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly axiaengine_previewEdgeEraseMerge: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_push_pull: (a: number, b: number, c: number) => number;
    readonly axiaengine_push_pull_smooth_group_seamless: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_redo: (a: number) => number;
    readonly axiaengine_removeConstraint: (a: number, b: number) => number;
    readonly axiaengine_remove_faces_from_group: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_remove_material: (a: number, b: number, c: number) => number;
    readonly axiaengine_rename_group: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_repairNonManifoldEdges: (a: number, b: number) => void;
    readonly axiaengine_resolveAllConstraints: (a: number) => number;
    readonly axiaengine_resolveConstraintsIterative: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_resynthesizeOrphanFaces: (a: number) => number;
    readonly axiaengine_revolveProfile: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly axiaengine_rotateVerts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly axiaengine_rotate_faces: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly axiaengine_scaleVerts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly axiaengine_scale_faces: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly axiaengine_sceneSummary: (a: number, b: number) => void;
    readonly axiaengine_setAutoIntersectOnDraw: (a: number, b: number) => void;
    readonly axiaengine_setConstraintActive: (a: number, b: number, c: number) => number;
    readonly axiaengine_setEdgeAngleThreshold: (a: number, b: number) => void;
    readonly axiaengine_setEdgeArcCurve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => number;
    readonly axiaengine_setEdgeBSplineCurve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_setEdgeBezierCurve: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_setEdgeCircleCurve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => number;
    readonly axiaengine_setEdgeClass: (a: number, b: number, c: number) => number;
    readonly axiaengine_setEdgeNurbsCurve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly axiaengine_setFaceSurfaceCone: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => number;
    readonly axiaengine_setFaceSurfaceCylinder: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => number;
    readonly axiaengine_setFaceSurfacePlane: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => number;
    readonly axiaengine_setFaceSurfaceSphere: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly axiaengine_setFaceSurfaceTorus: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => number;
    readonly axiaengine_set_group_parent: (a: number, b: number, c: number) => number;
    readonly axiaengine_sheetBoolean: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly axiaengine_sliceVolumeByPlane: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly axiaengine_softenInternalEdges: (a: number, b: number, c: number) => number;
    readonly axiaengine_splitEdge: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly axiaengine_splitFaceByLine: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly axiaengine_subdivideCatmullClark: (a: number) => number;
    readonly axiaengine_sweepProfileAlongPath: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly axiaengine_synthesizeFacesFromFreeEdges: (a: number) => number;
    readonly axiaengine_taperVerts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => number;
    readonly axiaengine_tessellateEdge: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_tessellateFaceSurface: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_toggle_group_lock: (a: number, b: number) => number;
    readonly axiaengine_toggle_group_visibility: (a: number, b: number) => number;
    readonly axiaengine_translateVerts: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly axiaengine_translate_faces: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly axiaengine_tryMergeAdjacentFaces: (a: number, b: number, c: number) => number;
    readonly axiaengine_tryMergeAdjacentFacesTol: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_twistVerts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly axiaengine_undo: (a: number) => number;
    readonly axiaengine_verifyInvariants: (a: number, b: number) => void;
    readonly axiaengine_verifyOutwardNormals: (a: number, b: number) => void;
    readonly axiaengine_vert_count: (a: number) => number;
    readonly axiaengine_xiaCount: (a: number) => number;
    readonly deltabuffers_getCacheVersion: (a: number) => number;
    readonly deltabuffers_getFaceVertCounts: (a: number, b: number) => void;
    readonly deltabuffers_getFaceVertOffsets: (a: number, b: number) => void;
    readonly deltabuffers_getModifiedFaceIds: (a: number, b: number) => void;
    readonly deltabuffers_getNormals: (a: number, b: number) => void;
    readonly deltabuffers_getPositions: (a: number, b: number) => void;
    readonly deltabuffers_isTopologyChanged: (a: number) => number;
    readonly engine_version: (a: number) => void;
    readonly schema_version: (a: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
