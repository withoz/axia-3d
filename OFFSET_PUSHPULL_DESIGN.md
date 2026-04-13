# Seamless Offset Push-Pull — 설계 문서

## 목표
Rhino 스타일의 seamless curved surface offset을 구현하여 갭과 중앙 빈 공간을 제거합니다.

## 현재 문제

```
각 면을 독립적으로 push-pull
  ├─ Face A: 정점 v1 → v1' (법선 A 방향)
  ├─ Face B: 정점 v2 → v2' (법선 B 방향)
  └─ 공유 엣지가 떨어짐 (갭 발생)
      └─ 중앙에 구멍이 남음
```

## 해결 방법: Smooth Group 전체 Offset

### 1단계: 정점 수집 및 법선 계산

```rust
fn calculate_vertex_offset_normal(
    mesh: &Mesh,
    smooth_group: &[FaceId],  // Smooth group의 모든 면
    vertex_id: VertId,
) -> Vector3 {
    // vertex_id가 속한 모든 면 찾기
    let mut adjacent_faces = Vec::new();
    for &face_id in smooth_group {
        if face_contains_vertex(mesh, face_id, vertex_id) {
            adjacent_faces.push(face_id);
        }
    }
    
    // 모든 인접 면의 법선을 가중 평균
    let mut normal_sum = Vector3::ZERO;
    for &face_id in &adjacent_faces {
        let face_normal = mesh.faces[face_id].normal();
        let face_area = calculate_face_area(mesh, face_id);
        normal_sum += face_normal * face_area;
    }
    
    normal_sum.normalize()
}
```

### 2단계: 모든 정점을 함께 오프셋

```rust
// offset_distance = 거리 (mm)
for &vertex_id in smooth_group_vertices {
    let offset_normal = calculate_vertex_offset_normal(mesh, smooth_group, vertex_id);
    let old_pos = mesh.vertex_pos(vertex_id)?;
    let new_pos = old_pos + offset_normal * offset_distance;
    mesh.verts[vertex_id].set_pos(new_pos);
}
```

### 3단계: 인접 엣지에 Wall Face 생성

```
원래 엣지 (v1, v2)
오프셋 엣지 (v1', v2')

Wall Face 생성:
  Quad: (v1, v2, v2', v1')
  
→ 갭 없이 seamless 연결
```

```rust
for each_pair_of_adjacent_faces_in_smooth_group {
    // 공유 엣지 찾기
    let shared_edge = find_shared_edge(face_a, face_b);
    if shared_edge.is_some() {
        // 공유 엣지의 정점들
        let (v1, v2) = edge_vertices(shared_edge);
        // 오프셋 정점
        let v1_prime = offset_vertex_map[v1];
        let v2_prime = offset_vertex_map[v2];
        
        // Wall face 생성
        create_quad_face(v1, v2, v2_prime, v1_prime);
    }
}
```

### 4단계: 선택적 시작/끝 면

**Option A: 열린 형태 (기본)**
```
원래 곡면 (base)
     ↓
Wall faces (seamless 연결)
     ↓
오프셋 곡면 (top)
```

**Option B: 닫힌 형태 (선택)**
```
원래 곡면 (base, 유지)
     ↓
Wall faces (seamless 연결)
     ↓
오프셋 곡면 (top, 생성)
     ↓
중앙 면 (생성, 구멍 채우기)
```

## 구현 계획

### Phase 1: Core Algorithm
**파일**: `crates/axia-geo/src/operations/push_pull.rs`

```rust
pub fn push_pull_smooth_group_seamless(
    &mut self,
    smooth_group: Vec<FaceId>,
    distance: f64,
    material: MaterialId,
    close_ends: bool,  // 시작/끝 면 생성 여부
) -> Result<PushPullResult>
```

구현 순서:
1. `calculate_vertex_offset_normal()` — 정점별 법선 계산
2. `offset_smooth_group_vertices()` — 모든 정점 오프셋
3. `create_wall_faces()` — Wall face 생성
4. `close_ends_if_needed()` — 선택적 면 생성

### Phase 2: WASM Binding
**파일**: `crates/axia-wasm/src/lib.rs`

```rust
#[wasm_bindgen]
pub fn push_pull_smooth_group_seamless(
    engine: &AxiaEngine,
    face_ids: &[u32],  // Smooth group face IDs
    distance: f64,
    close_ends: bool,
) -> String
```

### Phase 3: TypeScript Integration
**파일**: `web/src/tools/PushPullTool.ts`

```typescript
// Phase 2에서 new smooth group 감지 시
if (this.isSmoothGroup) {
    const faceIds = new Uint32Array(this.smoothGroupFaces);
    const result = this.ctx.bridge.pushPullSmoothGroupSeamless?.(
        faceIds,
        distance,
        true  // close_ends
    );
}
```

## 알고리즘 복잡도

| 작업 | 복잡도 | 비고 |
|------|--------|------|
| 정점 수집 | O(V·F) | V=정점, F=면 |
| 법선 계산 | O(V) | 정점당 가중 평균 |
| 정점 오프셋 | O(V) | 병렬 처리 가능 |
| Wall face 생성 | O(E) | E=엣지 |
| 전체 | O(V·F) | V, F는 smooth group 크기에만 영존 |

## 테스트 케이스

1. **원통 (Cylinder)**
   - 30개 면 → 모두 오프셋
   - Wall faces로 seamless 연결
   - 중앙 구멍이 정확하게 채워짐

2. **구 (Sphere)**
   - 모든 면이 smooth group
   - 균등한 거리로 오프셋
   - 내부 구 형태 생성

3. **부분 곡면 (Partial Curved Surface)**
   - 일부 면만 smooth group
   - 다른 면과 경계 엣지 정확 연결

## 예상 결과

### Before (현재)
```
↓ Push/Pull curved surface
  [갭][갭][갭]  ← 톱니바퀴 패턴
  [    빈공간    ]  ← 중앙 구멍
```

### After (Seamless Offset)
```
↓ Seamless Offset Smooth Group
  [=====연결=====]  ← Seamless 벽
  [   닫힌 형태   ]  ← 중앙 채워짐
```

## 구현 우선순위

1. **High**: 정점 오프셋 + Wall face 생성
   - 이것이 갭 제거의 핵심
   - 1-2일 구현

2. **Medium**: 중앙 면 자동 생성
   - 사용자 옵션으로 선택 가능
   - 1일 구현

3. **Low**: 성능 최적화
   - Spatial hashing
   - 병렬 처리

---

**다음**: `push_pull.rs`에 `push_pull_smooth_group_seamless()` 구현 시작
