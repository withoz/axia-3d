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
     * 면에 재질 부여 (material_id_raw = MaterialId의 raw u32 값)
     */
    assign_material(face_ids_raw: Uint32Array, material_id_raw: number): boolean;
    /**
     * Batch delete faces and edges in a single undo transaction.
     * Called from JS delete action — undo restores everything at once.
     */
    batch_delete(face_ids: Uint32Array, edge_ids: Uint32Array): boolean;
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
     * Count of constraints (active + inactive).
     */
    constraintCount(): number;
    /**
     * Phase H5 — 자유 엣지 개수만 카운트 (dry-run, mesh 불변).
     * UI에서 "N개 자유 엣지 발견 — Face Synthesis 실행?" 안내에 사용.
     */
    countFreeEdges(): number;
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
    draw_circle(cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, radius: number, segments: number): number;
    draw_line(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, nx: number, ny: number, nz: number): number;
    draw_rect(cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, ux: number, uy: number, uz: number, width: number, height: number): number;
    /**
     * ADR-007 Phase 5 — 엄격 export: invariant 위반 시 빈 배열 반환 + lastError 설정.
     * 파일 저장 대화창 등에서 데이터 무결성이 중요한 경우 사용.
     */
    exportSnapshotStrict(): Uint8Array;
    /**
     * 프로젝트 데이터를 바이너리 스냅샷으로 내보내기 (versioned format with magic bytes)
     */
    export_snapshot(): Uint8Array;
    face_count(): number;
    /**
     * face 집합의 중심점 반환 [x, y, z]
     */
    faces_centroid(face_ids: Uint32Array): Float64Array;
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
    /**
     * Get the current cache version (monotonic counter).
     * Used by JavaScript to validate delta buffer freshness.
     */
    getCacheVersion(): number;
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
     * Get vertex positions in f64 precision (CAD-grade).
     * Same layout as get_positions() but Float64Array — no f32 truncation.
     * Use for dimension display, snap matching, and precision-sensitive operations.
     */
    getPositionsF64(): Float64Array;
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
     * face가 잠긴 그룹에 속하는지 확인
     */
    is_face_locked(face_id_raw: number): boolean;
    /**
     * 최근 실패한 연산의 에러 메시지를 반환. 실패 이력이 없으면 빈 문자열.
     * TypeScript Bridge가 연산 반환값이 false일 때 이 값을 Toast로 표시.
     */
    lastError(): string;
    /**
     * List all constraints as JSON.
     * Format: [{id, kind, active, refs:[...], value}, ...]
     */
    listConstraints(): string;
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
     * Toggle active flag of a constraint.
     */
    setConstraintActive(id: number, active: boolean): boolean;
    /**
     * 중첩 그룹 설정
     */
    set_group_parent(child_id: number, parent_id: number): boolean;
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
    undo(): boolean;
    /**
     * 마지막 verify_face_invariants 결과를 요약 JSON으로 반환.
     * UI에서 "정합성 검사" 버튼에 바인딩.
     */
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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_axiaengine_free: (a: number, b: number) => void;
    readonly __wbg_deltabuffers_free: (a: number, b: number) => void;
    readonly axiaengine_addDistanceConstraint: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_addEdgeConstraint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_add_faces_to_group: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_analyzeMergeCandidates: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_analyzeMergeCandidatesTol: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly axiaengine_assign_material: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_batch_delete: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly axiaengine_boolean_op: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly axiaengine_can_redo: (a: number) => number;
    readonly axiaengine_can_undo: (a: number) => number;
    readonly axiaengine_constraintCount: (a: number) => number;
    readonly axiaengine_countFreeEdges: (a: number) => number;
    readonly axiaengine_create_cone: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_create_cylinder: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_create_group: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly axiaengine_create_sphere: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly axiaengine_deleteEdgeCascade: (a: number, b: number) => number;
    readonly axiaengine_delete_edge: (a: number, b: number) => number;
    readonly axiaengine_delete_face: (a: number, b: number) => number;
    readonly axiaengine_delete_group: (a: number, b: number) => number;
    readonly axiaengine_draw_circle: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly axiaengine_draw_line: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly axiaengine_draw_rect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => number;
    readonly axiaengine_exportSnapshotStrict: (a: number, b: number) => void;
    readonly axiaengine_export_snapshot: (a: number, b: number) => void;
    readonly axiaengine_face_count: (a: number) => number;
    readonly axiaengine_faces_centroid: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_flipFaces: (a: number, b: number, c: number) => number;
    readonly axiaengine_getCacheVersion: (a: number) => number;
    readonly axiaengine_getDirtyFaceBuffers: (a: number) => number;
    readonly axiaengine_getDirtyFaceCount: (a: number) => number;
    readonly axiaengine_getEdgeEndpoints: (a: number, b: number, c: number) => void;
    readonly axiaengine_getPositionsF64: (a: number, b: number) => void;
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
    readonly axiaengine_is_face_locked: (a: number, b: number) => number;
    readonly axiaengine_lastError: (a: number, b: number) => void;
    readonly axiaengine_listConstraints: (a: number, b: number) => void;
    readonly axiaengine_make_component: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_maxConstraintResidual: (a: number) => number;
    readonly axiaengine_mergeCoplanarContaining: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_mergeFacesByEdge: (a: number, b: number) => number;
    readonly axiaengine_mergeFacesByEdgeTol: (a: number, b: number, c: number) => number;
    readonly axiaengine_new: () => number;
    readonly axiaengine_normalizeForImport: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_offset_edge: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly axiaengine_offset_face: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_orient_faces: (a: number) => number;
    readonly axiaengine_pointInFace: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly axiaengine_push_pull: (a: number, b: number, c: number) => number;
    readonly axiaengine_push_pull_smooth_group_seamless: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_redo: (a: number) => number;
    readonly axiaengine_removeConstraint: (a: number, b: number) => number;
    readonly axiaengine_remove_faces_from_group: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_remove_material: (a: number, b: number, c: number) => number;
    readonly axiaengine_rename_group: (a: number, b: number, c: number, d: number) => number;
    readonly axiaengine_resolveAllConstraints: (a: number) => number;
    readonly axiaengine_resolveConstraintsIterative: (a: number, b: number, c: number, d: number) => void;
    readonly axiaengine_rotateVerts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly axiaengine_rotate_faces: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly axiaengine_scaleVerts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly axiaengine_scale_faces: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly axiaengine_setConstraintActive: (a: number, b: number, c: number) => number;
    readonly axiaengine_set_group_parent: (a: number, b: number, c: number) => number;
    readonly axiaengine_splitEdge: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly axiaengine_splitFaceByLine: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly axiaengine_synthesizeFacesFromFreeEdges: (a: number) => number;
    readonly axiaengine_toggle_group_lock: (a: number, b: number) => number;
    readonly axiaengine_toggle_group_visibility: (a: number, b: number) => number;
    readonly axiaengine_translateVerts: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly axiaengine_translate_faces: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly axiaengine_tryMergeAdjacentFaces: (a: number, b: number, c: number) => number;
    readonly axiaengine_tryMergeAdjacentFacesTol: (a: number, b: number, c: number, d: number) => number;
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
