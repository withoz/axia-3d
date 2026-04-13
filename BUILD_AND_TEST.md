# Boolean Face Split — 빌드 및 테스트 가이드

## 1. 빌드 확인

```bash
cd "AXiA 3D"
cargo build --lib -p axia-geo
```

## 2. Boolean Face Split 테스트 실행

```bash
cargo test -p axia-geo -- boolean --nocapture
```

실행되는 테스트 목록:

| 테스트 | 설명 |
|--------|------|
| `boolean_union_basic` | 겹치는 두 박스 Union |
| `boolean_subtract_basic` | 겹치는 두 박스 Subtract |
| `boolean_intersect_basic` | 겹치는 두 박스 Intersect |
| `boolean_no_overlap` | 떨어진 두 박스 Union (전체 face 유지) |
| `split_polygon_2d_horizontal_cut` | 정사각형 가로 분할 |
| `split_polygon_2d_no_intersection` | 교차 없음 → 분할 안 됨 |
| `split_polygon_2d_diagonal_cut` | 대각선 분할 + 면적 보존 검증 |
| `boolean_union_with_face_split` | Face Split 통합 파이프라인 테스트 |

## 3. 변경 파일 요약

### `crates/axia-geo/src/operations/boolean_geo.rs`
- `Pt2` 구조체 (2D 점)
- `project_to_2d()` / `unproject_to_3d()` — 3D↔2D 투영
- `segment_segment_2d()` — 2D 선분 교차
- `polygon_signed_area_2d()` / `polygon_centroid_2d()` / `point_in_polygon_2d()`

### `crates/axia-geo/src/operations/boolean.rs`
- `split_faces_by_intersections()` — face별 교차선으로 분할
- `split_polygon_2d()` — 2D 다각형 분할 (핵심 알고리즘)
- `pair_intersection_points()` — 교차점 Entry/Exit 페어링
- 파이프라인 5단계: 준비 → 교차선 → **Face Split** → 분류 → 조립

### `crates/axia-geo/src/mesh.rs`
- `export_buffers()` — inner loop (hole) earcut 지원 연결

## 4. 컴파일 오류 발생 시

가장 흔한 원인:
- `earcutr` 크레이트 버전 차이 → `Cargo.toml` 확인
- `glam` DVec3 메서드 변경 → `glam = "0.30"` 확인
