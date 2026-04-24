/* @ts-self-types="./axia_wasm.d.ts" */

export class AxiaEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AxiaEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_axiaengine_free(ptr, 0);
    }
    /**
     * Add a distance constraint between two vertices.
     * @param {number} v_a
     * @param {number} v_b
     * @param {number} distance
     * @returns {number}
     */
    addDistanceConstraint(v_a, v_b, distance) {
        const ret = wasm.axiaengine_addDistanceConstraint(this.__wbg_ptr, v_a, v_b, distance);
        return ret >>> 0;
    }
    /**
     * Add a parallel/perpendicular/collinear constraint between two edges.
     * `edgeA_v_a/b` and `edgeB_v_a/b` are vertex IDs.
     * `kind`: "parallel" | "perpendicular" | "collinear"
     * Returns the new constraint ID (>=1) on success, 0 on failure.
     * @param {string} kind
     * @param {number} edge_a_v_a
     * @param {number} edge_a_v_b
     * @param {number} edge_b_v_a
     * @param {number} edge_b_v_b
     * @returns {number}
     */
    addEdgeConstraint(kind, edge_a_v_a, edge_a_v_b, edge_b_v_a, edge_b_v_b) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_addEdgeConstraint(this.__wbg_ptr, ptr0, len0, edge_a_v_a, edge_a_v_b, edge_b_v_a, edge_b_v_b);
        return ret >>> 0;
    }
    /**
     * 그룹에 face 추가
     * @param {number} group_id
     * @param {Uint32Array} face_ids
     * @returns {boolean}
     */
    add_faces_to_group(group_id, face_ids) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_add_faces_to_group(this.__wbg_ptr, group_id, ptr0, len0);
        return ret !== 0;
    }
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
     * @param {Uint32Array} face_ids
     * @returns {string}
     */
    analyzeMergeCandidates(face_ids) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_analyzeMergeCandidates(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Tolerance 지정 merge analysis (B1).
     * @param {Uint32Array} face_ids
     * @param {number} angle_tol_deg
     * @returns {string}
     */
    analyzeMergeCandidatesTol(face_ids, angle_tol_deg) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_analyzeMergeCandidatesTol(retptr, this.__wbg_ptr, ptr0, len0, angle_tol_deg);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Apply or preview an orphan-recovery plan. Wrapped in a single undo
     * frame on apply; preview rolls back to the exact prior snapshot.
     *
     * `plan_json` — `RecoveryPlan` serialised as JSON.
     * `dry_run`   — true = preview (always rolls back); false = apply.
     *
     * Returns `RecoveryResult` serialised as JSON.
     * @param {string} plan_json
     * @param {boolean} dry_run
     * @returns {string}
     */
    applyOrphanRecovery(plan_json, dry_run) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(plan_json, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_applyOrphanRecovery(retptr, this.__wbg_ptr, ptr0, len0, dry_run);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Linear array — create `count` translated copies of the given
     * faces, each shifted by `offset · k` for k = 1..=count. Returns
     * the new FaceIds in copy-major, source-order.
     * @param {Uint32Array} face_ids
     * @param {number} count
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @returns {Uint32Array}
     */
    arrayLinearFaces(face_ids, count, dx, dy, dz) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_arrayLinearFaces(retptr, this.__wbg_ptr, ptr0, len0, count, dx, dy, dz);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Radial array — rotate `count` copies of the given faces around
     * an axis. Copy `k` is rotated by `total_angle_rad · k / count`
     * about (axis_origin, axis_dir). Returns new FaceIds copy-major.
     * @param {Uint32Array} face_ids
     * @param {number} count
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     * @param {number} total_angle_rad
     * @returns {Uint32Array}
     */
    arrayRadialFaces(face_ids, count, ox, oy, oz, ax, ay, az, total_angle_rad) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_arrayRadialFaces(retptr, this.__wbg_ptr, ptr0, len0, count, ox, oy, oz, ax, ay, az, total_angle_rad);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 면에 재질 부여 (material_id_raw = MaterialId의 raw u32 값)
     * @param {Uint32Array} face_ids_raw
     * @param {number} material_id_raw
     * @returns {boolean}
     */
    assign_material(face_ids_raw, material_id_raw) {
        const ptr0 = passArray32ToWasm0(face_ids_raw, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_assign_material(this.__wbg_ptr, ptr0, len0, material_id_raw);
        return ret !== 0;
    }
    /**
     * New variant: merge failure falls back to SOFT edge (hidden, topology
     * preserved) instead of destroying the adjacent faces. Recommended
     * default for interactive Erase tool.
     * @param {Uint32Array} face_ids
     * @param {Uint32Array} edge_ids
     * @param {number} angle_tol_deg
     * @param {boolean} cascade_only
     * @returns {Int32Array}
     */
    batchEraseEdgesSoftFallback(face_ids, edge_ids, angle_tol_deg, cascade_only) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray32ToWasm0(edge_ids, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.axiaengine_batchEraseEdgesSoftFallback(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, angle_tol_deg, cascade_only);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v3 = getArrayI32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
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
     * @param {Uint32Array} face_ids
     * @param {Uint32Array} edge_ids
     * @param {number} angle_tol_deg
     * @param {boolean} cascade_only
     * @returns {Int32Array}
     */
    batchEraseEdgesWithMerge(face_ids, edge_ids, angle_tol_deg, cascade_only) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray32ToWasm0(edge_ids, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.axiaengine_batchEraseEdgesWithMerge(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, angle_tol_deg, cascade_only);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v3 = getArrayI32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Batch delete faces and edges in a single undo transaction.
     * Called from JS delete action — undo restores everything at once.
     * @param {Uint32Array} face_ids
     * @param {Uint32Array} edge_ids
     * @returns {boolean}
     */
    batch_delete(face_ids, edge_ids) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(edge_ids, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_batch_delete(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    /**
     * Bend a vertex set around `bend_axis` with angle ramping from 0
     * (at `t=0` along `bend_dir`) to `angle_deg` (at `t=length_limit`).
     * Verts with negative `t` (behind `origin`) are left untouched.
     * @param {Uint32Array} vert_ids
     * @param {number} ax_x
     * @param {number} ax_y
     * @param {number} ax_z
     * @param {number} dir_x
     * @param {number} dir_y
     * @param {number} dir_z
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} angle_deg
     * @param {number} length_limit
     * @returns {boolean}
     */
    bendVerts(vert_ids, ax_x, ax_y, ax_z, dir_x, dir_y, dir_z, ox, oy, oz, angle_deg, length_limit) {
        const ptr0 = passArray32ToWasm0(vert_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_bendVerts(this.__wbg_ptr, ptr0, len0, ax_x, ax_y, ax_z, dir_x, dir_y, dir_z, ox, oy, oz, angle_deg, length_limit);
        return ret !== 0;
    }
    /**
     * Boolean 연산 수행
     * faces_a, faces_b: face ID 배열 (u32)
     * op: "union" | "subtract" | "intersect"
     * 반환: JSON 문자열 (결과 정보)
     * @param {Uint32Array} faces_a
     * @param {Uint32Array} faces_b
     * @param {string} op
     * @returns {string}
     */
    boolean_op(faces_a, faces_b, op) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(faces_a, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray32ToWasm0(faces_b, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(op, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
            const len2 = WASM_VECTOR_LEN;
            wasm.axiaengine_boolean_op(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred4_0 = r0;
            deferred4_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    can_redo() {
        const ret = wasm.axiaengine_can_redo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    can_undo() {
        const ret = wasm.axiaengine_can_undo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Read-only classifier. Returns JSON-serialised `OrphanReport`.
     * See ADR-009 for category definitions (C1 / C2 / C3).
     * @returns {string}
     */
    classifyOrphans() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_classifyOrphans(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Collect all edges in the polyline chain containing `edge_id`.
     * Walks through degree-2 vertices and stops at junctions/dead-ends.
     * Empty Vec on invalid / inactive edge.
     * @param {number} edge_id_raw
     * @returns {Uint32Array}
     */
    collectEdgeChain(edge_id_raw) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_collectEdgeChain(retptr, this.__wbg_ptr, edge_id_raw);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
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
     * @param {number} sun_x
     * @param {number} sun_y
     * @param {number} sun_z
     * @returns {Float32Array}
     */
    computeGroundProjectedShadows(sun_x, sun_y, sun_z) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_computeGroundProjectedShadows(retptr, this.__wbg_ptr, sun_x, sun_y, sun_z);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Count of constraints (active + inactive).
     * @returns {number}
     */
    constraintCount() {
        const ret = wasm.axiaengine_constraintCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Phase H5 — 자유 엣지 개수만 카운트 (dry-run, mesh 불변).
     * UI에서 "N개 자유 엣지 발견 — Face Synthesis 실행?" 안내에 사용.
     *
     * Centerline 엣지는 제외 — 얘네는 "free" 상태로 있는 게 정상이므로
     * Finish→Extrude 트리거에 영향 주지 않아야 함.
     * @returns {number}
     */
    countFreeEdges() {
        const ret = wasm.axiaengine_countFreeEdges(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a cone primitive.
     * Returns the base face ID for Push/Pull operations.
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @param {number} radius
     * @param {number} height
     * @param {number} segments
     * @returns {number}
     */
    create_cone(cx, cy, cz, radius, height, segments) {
        const ret = wasm.axiaengine_create_cone(this.__wbg_ptr, cx, cy, cz, radius, height, segments);
        return ret;
    }
    /**
     * Create a cylinder primitive.
     * Returns the base face ID for Push/Pull operations.
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @param {number} radius
     * @param {number} height
     * @param {number} segments
     * @returns {number}
     */
    create_cylinder(cx, cy, cz, radius, height, segments) {
        const ret = wasm.axiaengine_create_cylinder(this.__wbg_ptr, cx, cy, cz, radius, height, segments);
        return ret;
    }
    /**
     * 선택된 face들을 그룹으로 생성
     * 반환: group ID (성공) 또는 0 (실패)
     * @param {string} name
     * @param {Uint32Array} face_ids
     * @returns {number}
     */
    create_group(name, face_ids) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_create_group(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * Create a sphere primitive (UV sphere).
     * Returns a face ID from the sphere for Push/Pull operations.
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @param {number} radius
     * @param {number} u_segments
     * @param {number} v_segments
     * @returns {number}
     */
    create_sphere(cx, cy, cz, radius, u_segments, v_segments) {
        const ret = wasm.axiaengine_create_sphere(this.__wbg_ptr, cx, cy, cz, radius, u_segments, v_segments);
        return ret;
    }
    /**
     * Delete an edge plus all faces sharing it. Returns the cascaded face count
     * (>= 0 on success, -1 on failure). TS wraps this to inform the user how
     * many faces were removed as a side effect.
     * @param {number} edge_id_raw
     * @returns {number}
     */
    deleteEdgeCascade(edge_id_raw) {
        const ret = wasm.axiaengine_deleteEdgeCascade(this.__wbg_ptr, edge_id_raw);
        return ret;
    }
    /**
     * Delete an edge (and its half-edges) from the mesh.
     * Also removes any faces that reference this edge (SketchUp-style cascade).
     *
     * Legacy signature returning just bool — calls the cascaded_count version.
     * New code should prefer `delete_edge_cascade` which reports how many faces
     * were removed so the UI can show a toast.
     * @param {number} edge_id_raw
     * @returns {boolean}
     */
    delete_edge(edge_id_raw) {
        const ret = wasm.axiaengine_delete_edge(this.__wbg_ptr, edge_id_raw);
        return ret !== 0;
    }
    /**
     * Force-delete a face from the mesh.
     *
     * Wrapped in an undo transaction (Bug #1 fix, 2026-04-17) — previously
     * this op mutated the mesh without recording a snapshot, causing Ctrl+Z
     * to skip past the deletion to an earlier command.
     * @param {number} face_id_raw
     * @returns {boolean}
     */
    delete_face(face_id_raw) {
        const ret = wasm.axiaengine_delete_face(this.__wbg_ptr, face_id_raw);
        return ret !== 0;
    }
    /**
     * 그룹 해제
     * @param {number} group_id
     * @returns {boolean}
     */
    delete_group(group_id) {
        const ret = wasm.axiaengine_delete_group(this.__wbg_ptr, group_id);
        return ret !== 0;
    }
    /**
     * Draw a centerline (reference axis). Unlike drawLine, bypasses
     * intersection-split / face synthesis / loop detection. Creates one
     * edge tagged Centerline; crossing other edges does not split them.
     * Returns the new edge raw id, or -1 on failure.
     * @param {number} x0
     * @param {number} y0
     * @param {number} z0
     * @param {number} x1
     * @param {number} y1
     * @param {number} z1
     * @returns {number}
     */
    drawCenterline(x0, y0, z0, x1, y1, z1) {
        const ret = wasm.axiaengine_drawCenterline(this.__wbg_ptr, x0, y0, z0, x1, y1, z1);
        return ret;
    }
    /**
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @param {number} radius
     * @param {number} segments
     * @returns {number}
     */
    draw_circle(cx, cy, cz, nx, ny, nz, radius, segments) {
        const ret = wasm.axiaengine_draw_circle(this.__wbg_ptr, cx, cy, cz, nx, ny, nz, radius, segments);
        return ret;
    }
    /**
     * @param {number} x0
     * @param {number} y0
     * @param {number} z0
     * @param {number} x1
     * @param {number} y1
     * @param {number} z1
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @returns {number}
     */
    draw_line(x0, y0, z0, x1, y1, z1, nx, ny, nz) {
        const ret = wasm.axiaengine_draw_line(this.__wbg_ptr, x0, y0, z0, x1, y1, z1, nx, ny, nz);
        return ret;
    }
    /**
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @param {number} ux
     * @param {number} uy
     * @param {number} uz
     * @param {number} width
     * @param {number} height
     * @returns {number}
     */
    draw_rect(cx, cy, cz, nx, ny, nz, ux, uy, uz, width, height) {
        const ret = wasm.axiaengine_draw_rect(this.__wbg_ptr, cx, cy, cz, nx, ny, nz, ux, uy, uz, width, height);
        return ret;
    }
    /**
     * 엣지 가시성 임계 각도(도) 조회. StylePanel 슬라이더 초기화에 사용.
     * @returns {number}
     */
    edgeAngleThreshold() {
        const ret = wasm.axiaengine_edgeAngleThreshold(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get an edge's semantic class as u32 (0=Geometry, 1=Centerline).
     * Returns 0 for missing/inactive edges (safe default).
     * @param {number} edge_id_raw
     * @returns {number}
     */
    edgeClass(edge_id_raw) {
        const ret = wasm.axiaengine_edgeClass(this.__wbg_ptr, edge_id_raw);
        return ret >>> 0;
    }
    /**
     * edgeLength returns the straight-line distance between an edge's
     * two endpoints. Zero on missing / degenerate edge.
     * @param {number} edge_id_raw
     * @returns {number}
     */
    edgeLength(edge_id_raw) {
        const ret = wasm.axiaengine_edgeLength(this.__wbg_ptr, edge_id_raw);
        return ret;
    }
    /**
     * ADR-007 Phase 5 — 엄격 export: invariant 위반 시 빈 배열 반환 + lastError 설정.
     * 파일 저장 대화창 등에서 데이터 무결성이 중요한 경우 사용.
     * @returns {Uint8Array}
     */
    exportSnapshotStrict() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_exportSnapshotStrict(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 프로젝트 데이터를 바이너리 스냅샷으로 내보내기 (versioned format with magic bytes)
     * @returns {Uint8Array}
     */
    export_snapshot() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_export_snapshot(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Measure helpers — pure queries, no state mutation.
     *
     * faceArea returns the planar area of a single face (fan-triangulated
     * cross-product magnitude / 2). Returns 0 on error / missing face.
     * @param {number} face_id_raw
     * @returns {number}
     */
    faceArea(face_id_raw) {
        const ret = wasm.axiaengine_faceArea(this.__wbg_ptr, face_id_raw);
        return ret;
    }
    /**
     * @returns {number}
     */
    face_count() {
        const ret = wasm.axiaengine_face_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * face 집합의 중심점 반환 [x, y, z]
     * @param {Uint32Array} face_ids
     * @returns {Float64Array}
     */
    faces_centroid(face_ids) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_faces_centroid(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 8, 8);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Round off a single edge into a cylindrical arc of the given
     * radius, sampled with `segments` quads. Returns the count of new
     * fillet strip quads on success (>= 2), or -1 on failure with
     * `lastError()` populated.
     * @param {number} edge_id_raw
     * @param {number} radius
     * @param {number} segments
     * @returns {number}
     */
    filletEdge(edge_id_raw, radius, segments) {
        const ret = wasm.axiaengine_filletEdge(this.__wbg_ptr, edge_id_raw, radius, segments);
        return ret;
    }
    /**
     * **User-triggered Face Reverse** (SketchUp "Reverse Faces").
     *
     * Flips orientation of the given faces. Locked (inside grouped/component)
     * faces are silently skipped. Wrapped in a single undo transaction so the
     * whole batch restores with one Ctrl+Z.
     *
     * Returns the count of faces actually flipped.
     * @param {Uint32Array} face_ids
     * @returns {number}
     */
    flipFaces(face_ids) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_flipFaces(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * Get the current cache version (monotonic counter).
     * Used by JavaScript to validate delta buffer freshness.
     * @returns {number}
     */
    getCacheVersion() {
        const ret = wasm.axiaengine_getCacheVersion(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get centerline edge segments for separate rendering (dashed/thin/dimmer).
     * Flat [x0,y0,z0, x1,y1,z1, ...] — pair per segment.
     * Not cached — centerlines are typically fewer and changes infrequently,
     * but if perf becomes an issue we can cache like getEdgeLines.
     * @returns {Float32Array}
     */
    getCenterlineLines() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_getCenterlineLines(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
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
     * @returns {DeltaBuffers | undefined}
     */
    getDirtyFaceBuffers() {
        const ret = wasm.axiaengine_getDirtyFaceBuffers(this.__wbg_ptr);
        return ret === 0 ? undefined : DeltaBuffers.__wrap(ret);
    }
    /**
     * Get dirty face count (for debugging)
     * @returns {number}
     */
    getDirtyFaceCount() {
        const ret = wasm.axiaengine_getDirtyFaceCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Edge의 두 끝점 VertId를 반환 ([v_small, v_large]).
     * 실패 시 빈 벡터.
     * @param {number} edge_id_raw
     * @returns {Uint32Array}
     */
    getEdgeEndpoints(edge_id_raw) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_getEdgeEndpoints(retptr, this.__wbg_ptr, edge_id_raw);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Return the outer-loop vertex IDs of a face in walk order.
     * Empty vec on error (face missing, degenerate, etc.).
     * @param {number} face_id_raw
     * @returns {Uint32Array}
     */
    getFaceVertices(face_id_raw) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_getFaceVertices(retptr, this.__wbg_ptr, face_id_raw);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get vertex positions in f64 precision (CAD-grade).
     * Same layout as get_positions() but Float64Array — no f32 truncation.
     * Use for dimension display, snap matching, and precision-sensitive operations.
     * @returns {Float64Array}
     */
    getPositionsF64() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_getPositionsF64(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get unique vertex positions in f64 precision for snap system.
     * Returns flat [x0,y0,z0, x1,y1,z1, ...] as Float64Array.
     * Snap system should use these instead of the f32 render buffers.
     * @returns {Float64Array}
     */
    getSnapVerticesF64() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_getSnapVerticesF64(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Vertex 위치를 [x, y, z]로 반환. 실패 시 빈 벡터.
     * @param {number} vert_id_raw
     * @returns {Float64Array}
     */
    getVertexPos(vert_id_raw) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_getVertexPos(retptr, this.__wbg_ptr, vert_id_raw);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 주어진 XIA가 소유한 모든 face ID 반환 (B3 — 그룹 병합용).
     * 빈 배열이면 해당 XIA가 없거나 비어 있음.
     * @param {number} xia_id
     * @returns {Uint32Array}
     */
    getXiaFaceIds(xia_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_getXiaFaceIds(retptr, this.__wbg_ptr, xia_id);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 씬에 존재하는 모든 XIA ID를 반환. 디버깅/열거용.
     * @returns {Uint32Array}
     */
    getXiaIds() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_getXiaIds(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 특정 XIA ID에 대한 요약 JSON.
     * `get_xia_info`는 face ID를 받지만, 이 함수는 **XIA ID를 직접 받는다**.
     * 내부적으로 해당 XIA의 모든 face_ids를 수집해 `get_xia_info`와 동일한 JSON을 반환.
     *
     * XIA가 없으면 `{"empty":true}` 반환.
     * @param {number} xia_id
     * @returns {string}
     */
    getXiaStats(xia_id) {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_getXiaStats(retptr, this.__wbg_ptr, xia_id);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * 전체 그룹 트리 JSON 반환
     * @returns {string}
     */
    get_all_groups() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_all_groups(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * 전체 재질 목록 JSON 반환 (format! 기반, serde_json 불필요)
     * @returns {string}
     */
    get_all_materials() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_all_materials(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * DCEL 위상(topology) 기반으로 seedFace에 연결된 모든 face를 BFS 탐색.
     * half-edge의 radial partner(next_rad)를 통해 edge를 공유하는 인접 face를 찾습니다.
     * 좌표 비교 없이 순수 위상 구조만 사용 → 다른 Volume의 face가 섞이지 않음.
     * @param {number} seed_face_raw
     * @returns {Uint32Array}
     */
    get_connected_faces(seed_face_raw) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_connected_faces(retptr, this.__wbg_ptr, seed_face_raw);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get hard edge line segments for wireframe rendering.
     * Returns flat [x0,y0,z0, x1,y1,z1, ...] — use with THREE.LineSegments.
     * Coplanar edges (angle ≤ 15°) are automatically hidden.
     * Centerline edges are excluded — call getCenterlineLines() separately.
     * @returns {Float32Array}
     */
    get_edge_lines() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_edge_lines(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Edge line segment index → EdgeId raw value mapping.
     * segment[i]의 EdgeId = edge_map[i]
     * @returns {Uint32Array}
     */
    get_edge_map() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_edge_map(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get the FaceId for each triangle (one u32 per triangle).
     * Use: face_map[triangleIndex] → FaceId for push_pull.
     * @returns {Uint32Array}
     */
    get_face_map() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_face_map(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 면의 재질 ID 조회 (없으면 0 반환, 0 = 기본 재질)
     * @param {number} face_id_raw
     * @returns {number}
     */
    get_face_material(face_id_raw) {
        const ret = wasm.axiaengine_get_face_material(this.__wbg_ptr, face_id_raw);
        return ret >>> 0;
    }
    /**
     * @param {number} face_id_raw
     * @returns {Float64Array}
     */
    get_face_normal(face_id_raw) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_face_normal(retptr, this.__wbg_ptr, face_id_raw);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 그룹의 모든 face ID 반환 (재귀적)
     * @param {number} group_id
     * @returns {Uint32Array}
     */
    get_group_faces(group_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_group_faces(retptr, this.__wbg_ptr, group_id);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * face가 속한 그룹 ID 조회 (없으면 0 반환)
     * @param {number} face_id_raw
     * @returns {number}
     */
    get_group_for_face(face_id_raw) {
        const ret = wasm.axiaengine_get_group_for_face(this.__wbg_ptr, face_id_raw);
        return ret;
    }
    /**
     * 그룹 정보 JSON 반환
     * @param {number} group_id
     * @returns {string}
     */
    get_group_info(group_id) {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_group_info(retptr, this.__wbg_ptr, group_id);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Uint32Array}
     */
    get_indices() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_indices(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {Float32Array}
     */
    get_normals() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_normals(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {Float32Array}
     */
    get_positions() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_positions(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string}
     */
    get_stats() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_get_stats(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Returns the first face ID owned by the given XIA ID.
     * draw_rect/draw_circle return XIA IDs; push_pull expects face IDs.
     * Returns u32::MAX on failure.
     * @param {number} xia_id
     * @returns {number}
     */
    get_xia_face(xia_id) {
        const ret = wasm.axiaengine_get_xia_face(this.__wbg_ptr, xia_id);
        return ret >>> 0;
    }
    /**
     * face가 속한 XIA의 ID 반환 (O(1) 역인덱스)
     * 없으면 u32::MAX 반환
     * @param {number} face_id_raw
     * @returns {number}
     */
    get_xia_for_face(face_id_raw) {
        const ret = wasm.axiaengine_get_xia_for_face(this.__wbg_ptr, face_id_raw);
        return ret >>> 0;
    }
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
     * @param {Uint32Array} face_ids_raw
     * @returns {string}
     */
    get_xia_info(face_ids_raw) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(face_ids_raw, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_get_xia_info(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * 그룹 수
     * @returns {number}
     */
    group_count() {
        const ret = wasm.axiaengine_group_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * DXF 파일 바이트를 파싱하여 DCEL 메시로 가져오기
     * 반환: JSON 문자열 (통계 정보)
     * @param {Uint8Array} data
     * @returns {string}
     */
    import_dxf(data) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_import_dxf(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * 바이너리 스냅샷으로부터 프로젝트 복원 (supports versioned and legacy formats)
     * @param {Uint8Array} data
     * @returns {boolean}
     */
    import_snapshot(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_import_snapshot(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * "Intersect with Model" — SketchUp 스타일 수동 교차선 생성.
     * 선택된 face 들과 나머지 active face 사이의 3D 교차선을 edge 로 변환.
     * inside/outside 판정 없이 모든 sub-face 유지.
     *
     * 반환: 성공 시 {"ok":true,"faceCount":N,"totalFaces":M}
     *       실패 시 {"ok":false,"error":"..."}
     * @param {Uint32Array} face_ids
     * @returns {string}
     */
    intersectWithModel(face_ids) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_intersectWithModel(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * face가 잠긴 그룹에 속하는지 확인
     * @param {number} face_id_raw
     * @returns {boolean}
     */
    is_face_locked(face_id_raw) {
        const ret = wasm.axiaengine_is_face_locked(this.__wbg_ptr, face_id_raw);
        return ret !== 0;
    }
    /**
     * 최근 실패한 연산의 에러 메시지를 반환. 실패 이력이 없으면 빈 문자열.
     * TypeScript Bridge가 연산 반환값이 false일 때 이 값을 Toast로 표시.
     * @returns {string}
     */
    lastError() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_lastError(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Diagnostic — first merge failure reason from the most recent
     * `batchEraseEdgesWithMerge` call. Empty string if no failure or no
     * call yet. Intended for the debug-mode Toast in the Erase tool.
     * @returns {string}
     */
    lastMergeFailureReason() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_lastMergeFailureReason(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * List all constraints as JSON.
     * Format: [{id, kind, active, refs:[...], value}, ...]
     * @returns {string}
     */
    listConstraints() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_listConstraints(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
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
     * @param {Float64Array} sections_flat
     * @param {number} section_size
     * @param {boolean} closed_sections
     * @returns {Uint32Array}
     */
    loftSections(sections_flat, section_size, closed_sections) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayF64ToWasm0(sections_flat, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_loftSections(retptr, this.__wbg_ptr, ptr0, len0, section_size, closed_sections);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 그룹을 컴포넌트로 변환
     * @param {number} group_id
     * @param {string} name
     * @returns {number}
     */
    make_component(group_id, name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_make_component(this.__wbg_ptr, group_id, ptr0, len0);
        return ret;
    }
    /**
     * **Level 3**: max residual across all active constraints at current state.
     * For monitoring / UI status without mutating the mesh.
     * @returns {number}
     */
    maxConstraintResidual() {
        const ret = wasm.axiaengine_maxConstraintResidual(this.__wbg_ptr);
        return ret;
    }
    /**
     * Phase F — 비인접 coplanar 포함 병합 (ADR-006 C1).
     * outer_face 안에 inner_face가 완전히 들어 있으면 inner를 hole로 합침.
     * Returns new face ID, or -1 on failure (lastError set).
     * @param {number} outer_face_raw
     * @param {number} inner_face_raw
     * @param {number} angle_tol_deg
     * @returns {number}
     */
    mergeCoplanarContaining(outer_face_raw, inner_face_raw, angle_tol_deg) {
        const ret = wasm.axiaengine_mergeCoplanarContaining(this.__wbg_ptr, outer_face_raw, inner_face_raw, angle_tol_deg);
        return ret;
    }
    /**
     * 2026-04-24 — Geometric merge of two coplanar adjacent faces even when
     * they don't share an exact DCEL edge (different-sized boundaries).
     * Used by the "두 면 기하 병합" menu action when user selects 2 faces.
     * @param {number} f1_raw
     * @param {number} f2_raw
     * @param {number} angle_tol_deg
     * @returns {number}
     */
    mergeCoplanarFacesGeometric(f1_raw, f2_raw, angle_tol_deg) {
        const ret = wasm.axiaengine_mergeCoplanarFacesGeometric(this.__wbg_ptr, f1_raw, f2_raw, angle_tol_deg);
        return ret;
    }
    /**
     * Merge the two coplanar faces sharing the given edge into a single face.
     *
     * - Success: returns the new merged FaceId (>= 0).
     * - Failure: returns -1 and sets lastError (e.g. "not coplanar",
     *   "shares multiple edges", "edge not shared by exactly 2 faces").
     *
     * Wrapped in a single undo transaction.
     * @param {number} edge_id_raw
     * @returns {number}
     */
    mergeFacesByEdge(edge_id_raw) {
        const ret = wasm.axiaengine_mergeFacesByEdge(this.__wbg_ptr, edge_id_raw);
        return ret;
    }
    /**
     * Tolerance 지정 단일 엣지 병합 (B1).
     * `angle_tol_deg` — 허용 각도 (°). 기본 0.5° (strict). 관대하게는 2~5°.
     * @param {number} edge_id_raw
     * @param {number} angle_tol_deg
     * @returns {number}
     */
    mergeFacesByEdgeTol(edge_id_raw, angle_tol_deg) {
        const ret = wasm.axiaengine_mergeFacesByEdgeTol(this.__wbg_ptr, edge_id_raw, angle_tol_deg);
        return ret;
    }
    /**
     * Analyse the whole active mesh for solid-closure status.
     * Returns JSON: {face_count, interior_edge_count, boundary_edge_count,
     *                non_manifold_edge_count, is_closed_solid}.
     * Used by the Solidify action to report before/after state to the user.
     * @returns {string}
     */
    meshManifoldInfo() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_meshManifoldInfo(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * meshVolume returns the signed enclosed volume of the whole mesh.
     * Exact for closed solids; indicative only for open shells.
     * @returns {number}
     */
    meshVolume() {
        const ret = wasm.axiaengine_meshVolume(this.__wbg_ptr);
        return ret;
    }
    /**
     * Mirror the given faces across a plane. Returns the new FaceIds
     * in the same order as the input (empty vec on failure, with
     * `lastError()` set). Single undo transaction wraps the whole batch.
     * @param {Uint32Array} face_ids
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @returns {Uint32Array}
     */
    mirrorFaces(face_ids, ox, oy, oz, nx, ny, nz) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_mirrorFaces(retptr, this.__wbg_ptr, ptr0, len0, ox, oy, oz, nx, ny, nz);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    constructor() {
        const ret = wasm.axiaengine_new();
        this.__wbg_ptr = ret >>> 0;
        AxiaEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
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
     * @param {string} options_json
     * @returns {string}
     */
    normalizeForImport(options_json) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(options_json, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_normalizeForImport(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Edge(line)를 평행하게 offset하여 새 edge 생성 (선만 복사, 면은 만들지 않음)
     * plane_normal: 참조 평면 법선 (Y-up = 0,1,0)
     * @param {number} edge_id_raw
     * @param {number} dist
     * @param {number} pnx
     * @param {number} pny
     * @param {number} pnz
     * @returns {string}
     */
    offset_edge(edge_id_raw, dist, pnx, pny, pnz) {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_offset_edge(retptr, this.__wbg_ptr, edge_id_raw, dist, pnx, pny, pnz);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Offset: face의 경계를 dist만큼 안쪽(+)/바깥쪽(-)으로 오프셋
     * 반환: JSON 결과 { ok, innerFace, stripFaces, ... }
     * @param {number} face_id_raw
     * @param {number} dist
     * @returns {string}
     */
    offset_face(face_id_raw, dist) {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_offset_face(retptr, this.__wbg_ptr, face_id_raw, dist);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Orient all faces for consistent normals.
     * Returns number of faces flipped.
     * @returns {number}
     */
    orient_faces() {
        const ret = wasm.axiaengine_orient_faces(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Test if a 3D point lies within a face's boundary.
     *
     * Returns true if the point is on the face's plane and inside its edges.
     * Useful for determining if a draw operation should trigger face split.
     * @param {number} face_id_raw
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {boolean}
     */
    pointInFace(face_id_raw, x, y, z) {
        const ret = wasm.axiaengine_pointInFace(this.__wbg_ptr, face_id_raw, x, y, z);
        return ret !== 0;
    }
    /**
     * Dry-run: "if I erase this edge right now, would it merge two coplanar
     * faces (good outcome) or cascade-delete (destructive)?"
     *
     * Returns:
     *   • `[f1, f2]` — the two adjacent faces that would merge into one
     *   • `[]`      — merge would fail (non-coplanar, C-slit, or edge not
     *                 shared by exactly 2 faces); erase would cascade
     *
     * Pure inspection — no state mutation, safe to call on every mousemove.
     * @param {number} edge_id_raw
     * @param {number} angle_tol_deg
     * @returns {Uint32Array}
     */
    previewEdgeEraseMerge(edge_id_raw, angle_tol_deg) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_previewEdgeEraseMerge(retptr, this.__wbg_ptr, edge_id_raw, angle_tol_deg);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Push/Pull a face along its normal.
     * dist > 0 = extrude outward (face kept)
     * dist < 0 = recess inward  (face removed)
     * @param {number} face_id_raw
     * @param {number} dist
     * @returns {boolean}
     */
    push_pull(face_id_raw, dist) {
        const ret = wasm.axiaengine_push_pull(this.__wbg_ptr, face_id_raw, dist);
        return ret !== 0;
    }
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
     * @param {Uint32Array} face_ids
     * @param {number} dist
     * @returns {boolean}
     */
    push_pull_smooth_group_seamless(face_ids, dist) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_push_pull_smooth_group_seamless(this.__wbg_ptr, ptr0, len0, dist);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    redo() {
        const ret = wasm.axiaengine_redo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Remove a constraint by ID. Returns true on success.
     * @param {number} id
     * @returns {boolean}
     */
    removeConstraint(id) {
        const ret = wasm.axiaengine_removeConstraint(this.__wbg_ptr, id);
        return ret !== 0;
    }
    /**
     * 그룹에서 face 제거
     * @param {number} group_id
     * @param {Uint32Array} face_ids
     * @returns {boolean}
     */
    remove_faces_from_group(group_id, face_ids) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_remove_faces_from_group(this.__wbg_ptr, group_id, ptr0, len0);
        return ret !== 0;
    }
    /**
     * 면에서 재질 제거 → XIA가 Volume으로 복귀
     * @param {Uint32Array} face_ids_raw
     * @returns {boolean}
     */
    remove_material(face_ids_raw) {
        const ptr0 = passArray32ToWasm0(face_ids_raw, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_remove_material(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * 그룹 이름 변경
     * @param {number} group_id
     * @param {string} new_name
     * @returns {boolean}
     */
    rename_group(group_id, new_name) {
        const ptr0 = passStringToWasm0(new_name, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_rename_group(this.__wbg_ptr, group_id, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Re-solve all active constraints. Returns number of constraints that
     * actually moved geometry.
     * @returns {number}
     */
    resolveAllConstraints() {
        const ret = wasm.axiaengine_resolveAllConstraints(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * **Level 3**: iterative XPBD-style solver. Returns a JSON result
     * `{converged, iterations, finalResidual, initialResidual, overConstrained}`.
     * Wraps in a single undo transaction if anything moved.
     * @param {number} max_iter
     * @param {number} tolerance
     * @returns {string}
     */
    resolveConstraintsIterative(max_iter, tolerance) {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_resolveConstraintsIterative(retptr, this.__wbg_ptr, max_iter, tolerance);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Revolve a 2D profile (flat array of [x,y,z, x,y,z, …]) around the
     * axis `(origin, dir)` into a surface of revolution. Returns the new
     * FaceIds in profile-major, ring-minor order, or an empty vec on
     * failure (with `lastError` set).
     *
     * Profile vertex order matters — see `operations::revolve` docs.
     * Single undo transaction wraps the whole spin.
     * @param {Float64Array} profile_flat
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @param {number} segments
     * @returns {Uint32Array}
     */
    revolveProfile(profile_flat, ox, oy, oz, dx, dy, dz, segments) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayF64ToWasm0(profile_flat, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.axiaengine_revolveProfile(retptr, this.__wbg_ptr, ptr0, len0, ox, oy, oz, dx, dy, dz, segments);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 지정 정점을 center/axis 기준으로 회전.
     * @param {Uint32Array} vert_ids
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     * @param {number} angle_deg
     * @returns {boolean}
     */
    rotateVerts(vert_ids, cx, cy, cz, ax, ay, az, angle_deg) {
        const ptr0 = passArray32ToWasm0(vert_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_rotateVerts(this.__wbg_ptr, ptr0, len0, cx, cy, cz, ax, ay, az, angle_deg);
        return ret !== 0;
    }
    /**
     * 선택된 face들의 정점을 회전
     * cx,cy,cz: 회전 중심, ax,ay,az: 회전축, angle_deg: 각도 (도)
     * @param {Uint32Array} face_ids
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     * @param {number} angle_deg
     * @returns {boolean}
     */
    rotate_faces(face_ids, cx, cy, cz, ax, ay, az, angle_deg) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_rotate_faces(this.__wbg_ptr, ptr0, len0, cx, cy, cz, ax, ay, az, angle_deg);
        return ret !== 0;
    }
    /**
     * 지정 정점을 center 기준으로 스케일. (sx,sy,sz)로 비균일 지원.
     * @param {Uint32Array} vert_ids
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @param {number} sx
     * @param {number} sy
     * @param {number} sz
     * @returns {boolean}
     */
    scaleVerts(vert_ids, cx, cy, cz, sx, sy, sz) {
        const ptr0 = passArray32ToWasm0(vert_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_scaleVerts(this.__wbg_ptr, ptr0, len0, cx, cy, cz, sx, sy, sz);
        return ret !== 0;
    }
    /**
     * 선택된 face들의 정점을 스케일
     * cx,cy,cz: 스케일 중심, sx,sy,sz: 축별 배율
     * @param {Uint32Array} face_ids
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @param {number} sx
     * @param {number} sy
     * @param {number} sz
     * @returns {boolean}
     */
    scale_faces(face_ids, cx, cy, cz, sx, sy, sz) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_scale_faces(this.__wbg_ptr, ptr0, len0, cx, cy, cz, sx, sy, sz);
        return ret !== 0;
    }
    /**
     * Toggle active flag of a constraint.
     * @param {number} id
     * @param {boolean} active
     * @returns {boolean}
     */
    setConstraintActive(id, active) {
        const ret = wasm.axiaengine_setConstraintActive(this.__wbg_ptr, id, active);
        return ret !== 0;
    }
    /**
     * 엣지 가시성 임계 각도(도) 설정. 범위 [1.0, 89.0]로 clamp.
     * 변경 시 edge cache 무효화 → 다음 getEdgeLines 호출에 반영.
     * 작은 값: 모든 panel 경계가 보임 (건축/기계 CAD 선호).
     * 큰 값: 부드러운 곡면 유지 (캐릭터 모델 선호).
     * @param {number} deg
     */
    setEdgeAngleThreshold(deg) {
        wasm.axiaengine_setEdgeAngleThreshold(this.__wbg_ptr, deg);
    }
    /**
     * Change an edge's semantic class. Rejects Geometry→Centerline if the
     * edge bounds an active face (would orphan the face).
     * Returns true on success.
     * @param {number} edge_id_raw
     * @param {number} class_raw
     * @returns {boolean}
     */
    setEdgeClass(edge_id_raw, class_raw) {
        const ret = wasm.axiaengine_setEdgeClass(this.__wbg_ptr, edge_id_raw, class_raw);
        return ret !== 0;
    }
    /**
     * 중첩 그룹 설정
     * @param {number} child_id
     * @param {number} parent_id
     * @returns {boolean}
     */
    set_group_parent(child_id, parent_id) {
        const ret = wasm.axiaengine_set_group_parent(this.__wbg_ptr, child_id, parent_id);
        return ret !== 0;
    }
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
     * @param {Uint32Array} face_ids
     * @returns {number}
     */
    softenInternalEdges(face_ids) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_softenInternalEdges(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Edge를 지정 위치에서 split하여 새 vertex를 생성하고 edge를 2개로 나눈다.
     * 반환: 성공 시 새 vertex id (>=0), 실패 시 -1.
     * position이 엣지 선분 밖이면 가까운 쪽으로 clamp.
     * 내부적으로 mesh.split_edge를 호출하고 단일 undo 트랜잭션으로 감쌈.
     * @param {number} edge_id_raw
     * @param {number} px
     * @param {number} py
     * @param {number} pz
     * @returns {number}
     */
    splitEdge(edge_id_raw, px, py, pz) {
        const ret = wasm.axiaengine_splitEdge(this.__wbg_ptr, edge_id_raw, px, py, pz);
        return ret;
    }
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
     * @param {number} face_id_raw
     * @param {number} x0
     * @param {number} y0
     * @param {number} z0
     * @param {number} x1
     * @param {number} y1
     * @param {number} z1
     * @returns {string}
     */
    splitFaceByLine(face_id_raw, x0, y0, z0, x1, y1, z1) {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_splitFaceByLine(retptr, this.__wbg_ptr, face_id_raw, x0, y0, z0, x1, y1, z1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Apply one level of Catmull-Clark subdivision to the whole mesh.
     * Returns the count of new quads on success, or -1 on failure.
     * Wrapped in a single undo transaction so one Ctrl+Z restores the
     * original topology.
     * @returns {number}
     */
    subdivideCatmullClark() {
        const ret = wasm.axiaengine_subdivideCatmullClark(this.__wbg_ptr);
        return ret;
    }
    /**
     * Sweep a 2D profile along a 3D path, producing one ring of vertices
     * per path point and stitching them with `loft`. `profile_flat` is
     * K points (xyz triples) in a local XY plane; `path_flat` is M points
     * (xyz triples) in world space. `closed_profile` treats the profile
     * as a closed ring. Returns new FaceIds; empty on failure.
     * @param {Float64Array} profile_flat
     * @param {Float64Array} path_flat
     * @param {boolean} closed_profile
     * @returns {Uint32Array}
     */
    sweepProfileAlongPath(profile_flat, path_flat, closed_profile) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayF64ToWasm0(profile_flat, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArrayF64ToWasm0(path_flat, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.axiaengine_sweepProfileAlongPath(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, closed_profile);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v3 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Phase H5 — 자유 엣지 → Face Synthesis (사용자 수동 트리거).
     *
     * 닫힌 polygon을 이루는 free edges를 감지해 face로 전환.
     * 2D DXF 도면 import 후 "평면도 → 면 생성"에 유용.
     *
     * **사용자 명시 호출만** — import 직후 자동 실행 안 함 (의도 왜곡 방지).
     *
     * 반환: 생성된 face 개수 (감지 실패 / 이미 face로 처리됨 시 0)
     * @returns {number}
     */
    synthesizeFacesFromFreeEdges() {
        const ret = wasm.axiaengine_synthesizeFacesFromFreeEdges(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Taper a vertex set along `(axis_origin, axis_dir)` from
     * `start_scale` at t=0 to `end_scale` at t=length.
     * @param {Uint32Array} vert_ids
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     * @param {number} start_scale
     * @param {number} end_scale
     * @param {number} length
     * @returns {boolean}
     */
    taperVerts(vert_ids, ox, oy, oz, ax, ay, az, start_scale, end_scale, length) {
        const ptr0 = passArray32ToWasm0(vert_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_taperVerts(this.__wbg_ptr, ptr0, len0, ox, oy, oz, ax, ay, az, start_scale, end_scale, length);
        return ret !== 0;
    }
    /**
     * 그룹 잠금 토글
     * @param {number} group_id
     * @returns {boolean}
     */
    toggle_group_lock(group_id) {
        const ret = wasm.axiaengine_toggle_group_lock(this.__wbg_ptr, group_id);
        return ret !== 0;
    }
    /**
     * 그룹 가시성 토글
     * @param {number} group_id
     * @returns {boolean}
     */
    toggle_group_visibility(group_id) {
        const ret = wasm.axiaengine_toggle_group_visibility(this.__wbg_ptr, group_id);
        return ret !== 0;
    }
    /**
     * 지정 정점 배열을 delta만큼 이동. Constraint Solver에서 makeParallel/
     * Perpendicular/setDistance의 기초 연산으로 사용.
     * @param {Uint32Array} vert_ids
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @returns {boolean}
     */
    translateVerts(vert_ids, dx, dy, dz) {
        const ptr0 = passArray32ToWasm0(vert_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_translateVerts(this.__wbg_ptr, ptr0, len0, dx, dy, dz);
        return ret !== 0;
    }
    /**
     * 선택된 face들의 정점을 이동
     * @param {Uint32Array} face_ids
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @returns {boolean}
     */
    translate_faces(face_ids, dx, dy, dz) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_translate_faces(this.__wbg_ptr, ptr0, len0, dx, dy, dz);
        return ret !== 0;
    }
    /**
     * Try to merge adjacent coplanar faces in the given selection.
     *
     * Iteratively finds pairs of faces that share exactly one edge and are
     * coplanar, merges them, and repeats until no more pairs qualify.
     * Returns the number of merges actually performed.
     *
     * All merges are wrapped in a single undo transaction.
     * @param {Uint32Array} face_ids
     * @returns {number}
     */
    tryMergeAdjacentFaces(face_ids) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_tryMergeAdjacentFaces(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * Tolerance 지정 인접 면 반복 병합 (B1).
     * @param {Uint32Array} face_ids
     * @param {number} angle_tol_deg
     * @returns {number}
     */
    tryMergeAdjacentFacesTol(face_ids, angle_tol_deg) {
        const ptr0 = passArray32ToWasm0(face_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_tryMergeAdjacentFacesTol(this.__wbg_ptr, ptr0, len0, angle_tol_deg);
        return ret >>> 0;
    }
    /**
     * Twist a vertex set around `(axis_origin, axis_dir)` with
     * `degrees_per_unit` degrees of rotation per unit of axial distance.
     * @param {Uint32Array} vert_ids
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     * @param {number} degrees_per_unit
     * @returns {boolean}
     */
    twistVerts(vert_ids, ox, oy, oz, ax, ay, az, degrees_per_unit) {
        const ptr0 = passArray32ToWasm0(vert_ids, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.axiaengine_twistVerts(this.__wbg_ptr, ptr0, len0, ox, oy, oz, ax, ay, az, degrees_per_unit);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    undo() {
        const ret = wasm.axiaengine_undo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * 마지막 verify_face_invariants 결과를 요약 JSON으로 반환.
     * UI에서 "정합성 검사" 버튼에 바인딩.
     * @returns {string}
     */
    verifyInvariants() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_verifyInvariants(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * ADR-007 원칙 1 확장 — 닫힌 solid의 outward normal 검증.
     * 반환 JSON: {isClosedSolid, checkedFaces, inwardCount, inwardFaces[]}
     * @returns {string}
     */
    verifyOutwardNormals() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.axiaengine_verifyOutwardNormals(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    vert_count() {
        const ret = wasm.axiaengine_vert_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * 씬의 XIA 개수.
     * @returns {number}
     */
    xiaCount() {
        const ret = wasm.axiaengine_xiaCount(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) AxiaEngine.prototype[Symbol.dispose] = AxiaEngine.prototype.free;

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
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(DeltaBuffers.prototype);
        obj.__wbg_ptr = ptr;
        DeltaBuffersFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DeltaBuffersFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_deltabuffers_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    getCacheVersion() {
        const ret = wasm.deltabuffers_getCacheVersion(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of vertices for each dirty face.
     * @returns {Uint32Array}
     */
    getFaceVertCounts() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.deltabuffers_getFaceVertCounts(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Vertex offsets into the FULL buffer for each dirty face.
     * `face_vert_offsets[i]` is the vertex index (not byte) where
     * face i starts in the full position buffer.
     * @returns {Uint32Array}
     */
    getFaceVertOffsets() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.deltabuffers_getFaceVertOffsets(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {Uint32Array}
     */
    getModifiedFaceIds() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.deltabuffers_getModifiedFaceIds(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {Float32Array}
     */
    getNormals() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.deltabuffers_getNormals(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {Float32Array}
     */
    getPositions() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.deltabuffers_getPositions(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * If true, topology changed (faces added/removed) — JS must do full rebuild.
     * If false, only positions/normals changed — JS can patch in-place.
     * @returns {boolean}
     */
    isTopologyChanged() {
        const ret = wasm.deltabuffers_isTopologyChanged(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) DeltaBuffers.prototype[Symbol.dispose] = DeltaBuffers.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_6b64449b9b9ed33c: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_2001591ad2463697: function(arg0) {
            console.error(getObject(arg0));
        },
        __wbg_getRandomValues_d49329ff89a07af1: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getTime_da7c55f52b71e8c6: function(arg0) {
            const ret = getObject(arg0).getTime();
            return ret;
        },
        __wbg_getTimezoneOffset_31f57a5389d0d57c: function(arg0) {
            const ret = getObject(arg0).getTimezoneOffset();
            return ret;
        },
        __wbg_new_0_4d657201ced14de3: function() {
            const ret = new Date();
            return addHeapObject(ret);
        },
        __wbg_new_7913666fe5070684: function(arg0) {
            const ret = new Date(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_new_with_year_month_day_hr_min_sec_d352dc3247220342: function(arg0, arg1, arg2, arg3, arg4, arg5) {
            const ret = new Date(arg0 >>> 0, arg1, arg2, arg3, arg4, arg5);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./axia_wasm_bg.js": import0,
    };
}

const AxiaEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_axiaengine_free(ptr >>> 0, 1));
const DeltaBuffersFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_deltabuffers_free(ptr >>> 0, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export(addHeapObject(e));
    }
}

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('axia_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
