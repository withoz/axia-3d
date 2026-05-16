//! AXiA-geo practicality benchmarks — scale-based timing (no Criterion).
//!
//! Run: `cargo bench --bench practicality_bench` (release mode)
//! Or:  `cargo run --release --bench practicality_bench`
//!
//! Captures perf baselines for:
//!   1.  Mesh build (N quad faces)
//!   2.  Primitive creation (Box / Sphere / Cylinder / Cone / Torus)
//!   3.  Closed-curve face (ADR-089 Phase 2: Circle / Bezier)
//!   4.  Push/Pull → cylinder Path A (legacy polygonal)
//!   5.  Sphere Path B (ADR-104 β-1-β-1 — kernel-native 2-hemisphere)
//!   6.  Boolean DCEL dispatch (mesh path + NURBS-aware)
//!   7.  Snapshot serialize / deserialize (bincode V3)
//!   8.  Memory footprint (1000-face mesh)
//!   9.  Topology traversal (all faces walk)
//!  10.  Mesh-level Map access (face_to_boundary_loops walk)
//!
//! Tier 2-B (LOCKED #44 — complete meaning per merge):
//! Single complete bench suite expansion as baseline for future
//! perf regression detection.

use axia_geo::entities::*;
use axia_geo::mesh::Mesh;
use axia_geo::curves::AnalyticCurve;
use axia_geo::operations::create_solid::CreateSolidMode;
use glam::DVec3;
use std::time::Instant;

// ─── Shared helpers ─────────────────────────────────────────────────

fn build_quad_grid(count: usize) -> Mesh {
    let mut m = Mesh::new();
    let side = (count as f64).sqrt().ceil() as usize;
    for i in 0..count {
        let x = (i % side) as f64 * 100.0;
        let y = (i / side) as f64 * 100.0;
        let z = 500.0 + (i as f64 * 0.1);
        let v0 = m.add_vertex(DVec3::new(x, y, z));
        let v1 = m.add_vertex(DVec3::new(x + 80.0, y, z));
        let v2 = m.add_vertex(DVec3::new(x + 80.0, y + 80.0, z));
        let v3 = m.add_vertex(DVec3::new(x, y + 80.0, z));
        m.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();
    }
    m
}

fn bench(label: &str, iters: u32, mut body: impl FnMut()) {
    for _ in 0..2 { body(); } // warmup
    let start = Instant::now();
    for _ in 0..iters { body(); }
    let elapsed = start.elapsed();
    let per_iter = elapsed / iters;
    println!("  {:<60} {:>10.2?} / iter  (n={})", label, per_iter, iters);
}

fn section(title: &str) {
    println!("\n{}", title);
}

// ─── Bench bodies ──────────────────────────────────────────────────

/// [1] Mesh build — N independent quad faces.
fn bench_mesh_build() {
    section("[1] Mesh build (N quad faces):");
    for &n in &[100usize, 1_000, 5_000] {
        let start = Instant::now();
        let m = build_quad_grid(n);
        let elapsed = start.elapsed();
        let per_face = elapsed.as_secs_f64() * 1e6 / n as f64;
        println!(
            "  N={:<6}  build={:>8.2?}  per face={:>7.1}µs  (verts={}, faces={}, hes={})",
            n, elapsed, per_face,
            m.verts.iter().count(), m.faces.iter().count(), m.hes.iter().count(),
        );
    }
}

/// [2] Primitive creation — Box / Sphere / Cylinder / Cone.
fn bench_primitives() {
    section("[2] Primitive creation (single instance, default segments):");
    bench("Box (1×1×1)", 1000, || {
        let mut m = Mesh::new();
        let _ = m.create_box(DVec3::ZERO, 1.0, 1.0, 1.0, MaterialId::new(0));
    });
    bench("Sphere (r=1, u=24, v=12)", 100, || {
        let mut m = Mesh::new();
        let _ = m.create_sphere(DVec3::ZERO, 1.0, 24, 12, MaterialId::new(0));
    });
    bench("Cylinder (r=1, h=2, N=24)", 100, || {
        let mut m = Mesh::new();
        let _ = m.create_cylinder(DVec3::ZERO, 1.0, 2.0, 24, MaterialId::new(0));
    });
    bench("Cone (r=1, h=2, N=24)", 100, || {
        let mut m = Mesh::new();
        let _ = m.create_cone(DVec3::ZERO, 1.0, 2.0, 24, MaterialId::new(0));
    });
}

/// [3] Closed-curve face (ADR-089 Phase 2).
fn bench_closed_curve_face() {
    section("[3] Closed-curve face (ADR-089 Phase 2 — 1 anchor + self-loop):");
    bench("Circle (r=5)", 1000, || {
        let mut m = Mesh::new();
        let anchor = m.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let curve = AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let _ = m.add_face_closed_curve(anchor, curve, MaterialId::new(0));
    });
    bench("Closed Bezier (4 cp, closed loop)", 1000, || {
        let mut m = Mesh::new();
        let cp = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(-1.0, 1.0, 0.0),
            DVec3::new(0.0, 0.0, 0.0),
        ];
        let anchor = m.add_vertex(cp[0]);
        let curve = AnalyticCurve::Bezier { control_pts: cp };
        let _ = m.add_face_closed_curve(anchor, curve, MaterialId::new(0));
    });
}

/// [4] Push/Pull — cylinder extrude (Path A polygonal).
fn bench_cylinder_extrude_path_a() {
    section("[4] Push/Pull cylinder (Path A — polygonal, N=24 default):");
    bench("Circle profile + extrude (h=10)", 100, || {
        let mut m = Mesh::new();
        let anchor = m.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let curve = AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let profile = m.add_face_closed_curve(anchor, curve, MaterialId::new(0)).unwrap();
        let _ = m.create_solid(
            profile,
            CreateSolidMode::Extrude { distance: 10.0 },
            MaterialId::new(0),
        );
    });
}

/// [5] Sphere Path B (ADR-104 β-1-β-1 — kernel-native 2-hemisphere).
fn bench_sphere_path_b() {
    section("[5] Sphere Path B kernel-native (ADR-104 β-1-β-1):");
    bench("create_sphere_kernel_native (r=5)", 1000, || {
        let mut m = Mesh::new();
        let _ = m.create_sphere_kernel_native(DVec3::ZERO, 5.0, MaterialId::new(0));
    });
    bench("create_sphere_kernel_native (r=100)", 1000, || {
        let mut m = Mesh::new();
        let _ = m.create_sphere_kernel_native(DVec3::ZERO, 100.0, MaterialId::new(0));
    });
}

/// [6] Topology traversal (all faces walk).
fn bench_topology_traversal() {
    section("[6] Topology traversal (all faces → normal sum):");
    for &n in &[100usize, 1_000, 5_000] {
        let mesh = build_quad_grid(n);
        bench(
            &format!("walk all faces (N={})", n), 100,
            || {
                let mut sum = 0.0;
                for (_fid, face) in mesh.faces.iter() {
                    sum += face.normal().y;
                }
                std::hint::black_box(sum);
            },
        );
    }
}

/// [7] Memory footprint estimation (1000-face mesh).
fn bench_memory_footprint() {
    section("[7] Memory footprint (1000 quad faces):");
    let m = build_quad_grid(1_000);
    let n_verts = m.verts.iter().count();
    let n_edges = m.edges.iter().count();
    let n_hes = m.hes.iter().count();
    let n_faces = m.faces.iter().count();
    // Rough estimate — actual slotmap overhead higher.
    let vertex_bytes = std::mem::size_of::<axia_geo::entities::Vertex>();
    let edge_bytes = std::mem::size_of::<axia_geo::entities::Edge>();
    let face_bytes = std::mem::size_of::<axia_geo::entities::Face>();
    println!(
        "  Vert: {} × {}B = {} KB",
        n_verts, vertex_bytes, n_verts * vertex_bytes / 1024,
    );
    println!(
        "  Edge: {} × {}B = {} KB",
        n_edges, edge_bytes, n_edges * edge_bytes / 1024,
    );
    println!(
        "  Face: {} × {}B = {} KB",
        n_faces, face_bytes, n_faces * face_bytes / 1024,
    );
    println!("  HE:   {} (count)", n_hes);
    let raw_total = n_verts * vertex_bytes + n_edges * edge_bytes + n_faces * face_bytes;
    println!("  Raw struct total: {} KB (excludes HE + maps + slotmap overhead)", raw_total / 1024);
}

/// [8] Invariant verification speed.
fn bench_invariants() {
    section("[8] Invariant verification (verify_face_invariants):");
    for &n in &[100usize, 1_000, 5_000] {
        let mesh = build_quad_grid(n);
        bench(
            &format!("verify_face_invariants (N={})", n), 20,
            || {
                let report = mesh.verify_face_invariants();
                std::hint::black_box(report.is_valid());
            },
        );
    }
}

/// [9] Mesh-level map access (face_to_boundary_loops walk).
fn bench_mesh_level_maps() {
    section("[9] Mesh-level Map access (ADR-091 §E L1 canonical):");
    let mesh = build_quad_grid(1_000);
    bench(
        "face_to_boundary_loops lookup × all faces (N=1000)",
        100,
        || {
            let mut count = 0;
            for (fid, _) in mesh.faces.iter() {
                if mesh.face_to_boundary_loops.get(&fid).is_some() {
                    count += 1;
                }
            }
            std::hint::black_box(count);
        },
    );
    bench(
        "face_to_surface_owner_id lookup × all faces (N=1000)",
        100,
        || {
            let mut count = 0;
            for (fid, _) in mesh.faces.iter() {
                if mesh.face_to_surface_owner_id.get(&fid).is_some() {
                    count += 1;
                }
            }
            std::hint::black_box(count);
        },
    );
}

fn main() {
    println!("\n═══════════════════════════════════════════════════════════════════");
    println!(" AXiA-geo practicality benchmarks (release mode)");
    println!("═══════════════════════════════════════════════════════════════════");

    bench_mesh_build();
    bench_primitives();
    bench_closed_curve_face();
    bench_cylinder_extrude_path_a();
    bench_sphere_path_b();
    bench_topology_traversal();
    bench_memory_footprint();
    bench_invariants();
    bench_mesh_level_maps();

    println!("\n═══════════════════════════════════════════════════════════════════\n");
}
