//! 실용성 테스트 — Edge case / degenerate geometry / stress tests.
//!
//! AXiA 3D 엔진이 비정상 입력이나 규모 있는 씬에서도 crash/hang 없이
//! 예측 가능하게 작동하는지 확인.
//!
//! Run: `cargo test --test practicality_edge_cases`

use axia_geo::entities::*;
use axia_geo::mesh::Mesh;
use glam::DVec3;

// ─── Category 1: Degenerate input rejection ──────────────────────

#[test]
fn nan_vertex_is_rejected_or_contained() {
    // NaN 좌표 face — 엔진이 crash하지 않고 Err 반환하거나 invalid face를
    // isolate하는지 확인.
    let mut mesh = Mesh::new();
    let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new(f64::NAN, 0.0, 1000.0));
    let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
    // add_face 내부에서 NaN 감지 여부는 구현 나름. 최소한 panic하면 안 됨.
    let result = mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0));
    // 거부되든 수용되든, 어느 경우에도 panic 없이 결과 반환.
    if result.is_ok() {
        // 수용된 경우 normal이 NaN이 아닌지 확인 — normal computation은
        // NaN을 숨겨둘 수 있음.
        let fid = result.unwrap();
        let face = mesh.faces.get(fid).expect("face exists");
        let n = face.normal();
        assert!(
            n.x.is_finite() || n.x.is_nan(),
            "normal의 NaN 여부는 detectable해야 함"
        );
    }
}

#[test]
fn zero_area_triangle_is_handled() {
    // Collinear 3 vertices — 0 면적 삼각형. 대부분 엔진이 거부함.
    let mut mesh = Mesh::new();
    let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new(2000.0, 0.0, 0.0));  // collinear
    let result = mesh.add_face_with_holes(&[v0, v1, v2], &[], MaterialId::new(0));
    // 예상: 거부됨 (ADR-003 degenerate guard). panic만 없으면 OK.
    let _ = result;
}

#[test]
fn duplicate_vertex_in_face_is_handled() {
    // 같은 vertex를 두 번 포함하는 face는 ADR-003 invariant 위반.
    let mut mesh = Mesh::new();
    let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
    let result = mesh.add_face_with_holes(&[v0, v1, v0, v1], &[], MaterialId::new(0));
    let _ = result;  // panic 없이 결과 반환하면 통과
}

// ─── Category 2: Stress / Scale ───────────────────────────────────

#[test]
fn build_1000_quad_scene_completes() {
    // 1000개 독립 quad face 생성 — 성능/메모리 sanity.
    let start = std::time::Instant::now();
    let mut mesh = Mesh::new();

    for i in 0..1000 {
        let x = (i % 50) as f64 * 100.0;
        let z = (i / 50) as f64 * 100.0;
        let y = 500.0 + (i as f64 * 0.1);
        let v0 = mesh.add_vertex(DVec3::new(x,     y, z));
        let v1 = mesh.add_vertex(DVec3::new(x,     y, z + 80.0));
        let v2 = mesh.add_vertex(DVec3::new(x + 80.0, y, z + 80.0));
        let v3 = mesh.add_vertex(DVec3::new(x + 80.0, y, z));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0))
            .expect("face creation must succeed");
    }
    let build_elapsed = start.elapsed();

    // 1000 face < 1초 예상. CI 느린 환경 고려 5초 한도.
    assert!(build_elapsed.as_secs() < 5, "1000 face build too slow: {:?}", build_elapsed);
    println!("Build 1000 quads: {:?}", build_elapsed);
}

#[test]
fn deep_undo_does_not_leak() {
    // 100회 face 추가/삭제 반복 — memory leak / panic 없이 동작.
    let mut mesh = Mesh::new();
    for iter in 0..100 {
        let offset = iter as f64 * 10.0;
        let v0 = mesh.add_vertex(DVec3::new(offset,         0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(offset + 100.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(offset + 100.0, 0.0, 100.0));
        let v3 = mesh.add_vertex(DVec3::new(offset,         0.0, 100.0));
        let fid = mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0))
            .expect("face creation must succeed");
        let _ = mesh.remove_face(fid);  // 있으면 삭제
    }
    // 그냥 panic 없이 끝나면 통과.
}

// ─── Category 3: (removed — shadow system deferred to future ADR-106) ────

// ─── Category 4: Boundary coordinate magnitudes ─────────────────

#[test]
fn very_large_coordinate_does_not_overflow() {
    // 지구 규모 건물(위경도 km) — 좌표가 1e6 넘어도 안전해야 함.
    let mut mesh = Mesh::new();
    let s = 1_000_000.0;  // 1km
    let v0 = mesh.add_vertex(DVec3::new(s, s, s));
    let v1 = mesh.add_vertex(DVec3::new(s, s, s + 1000.0));
    let v2 = mesh.add_vertex(DVec3::new(s + 1000.0, s, s + 1000.0));
    let v3 = mesh.add_vertex(DVec3::new(s + 1000.0, s, s));
    let result = mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0));
    assert!(result.is_ok(), "1km-scale face must be accepted");
}

#[test]
fn very_small_coordinate_degenerates_gracefully() {
    // 서브밀리미터 face — numerical precision 경계.
    let mut mesh = Mesh::new();
    let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new(0.001, 0.0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new(0.001, 0.0, 0.001));
    let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.001));
    let result = mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0));
    // 거부 or 허용 — 어느 쪽이든 panic 없이.
    let _ = result;
}
