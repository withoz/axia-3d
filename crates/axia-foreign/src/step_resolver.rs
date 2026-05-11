//! STEP geometry entity resolver (Phase G Stage 4-B A-3, ADR-035 P20.2).
//!
//! `step_parser` 가 산출한 `StepFile` AST 에서 자주 쓰이는 geometric
//! primitive (점 / 방향 / 벡터 / 축 배치) 를 안전하게 추출하는 헬퍼.
//!
//! ## 매핑 (STEP entity → Rust 값)
//!
//! | STEP entity | Resolver | 출력 |
//! |---|---|---|
//! | `CARTESIAN_POINT('', (x, y, z))` | `resolve_cartesian_point` | `[f64; 3]` |
//! | `DIRECTION('', (dx, dy, dz))` | `resolve_direction` | unit `[f64; 3]` (정규화 강제) |
//! | `VECTOR('', dir_ref, mag)` | `resolve_vector` | `([f64; 3], f64)` (dir, magnitude) |
//! | `AXIS2_PLACEMENT_3D('', loc_ref, axis_ref, ref_ref)` | `resolve_axis2_placement_3d` | `Axis2Placement3D` |
//!
//! AP203 / AP214 / AP242 동일 — geometry primitive 의 인자 순서는 ISO
//! 10303-42 (geometric_and_topological_representation) 에 의해 고정.
//!
//! ## 에러 처리 (P21.7 정합)
//!
//! 모든 resolver 는 `Result<T, ResolveError>` 반환. ResolveError 는
//! `into_warning()` 으로 ImportResult.warnings 에 누적 가능.

use std::collections::HashMap;

use crate::step_parser::{Entity, StepFile, Value};

// ────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct ResolveError {
    pub message: String,
    /// Entity reference id (`#N`) where 에러 발생 — 디버깅용.
    pub entity_ref: Option<u32>,
}

impl ResolveError {
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), entity_ref: None }
    }

    pub fn at(message: impl Into<String>, entity_ref: u32) -> Self {
        Self { message: message.into(), entity_ref: Some(entity_ref) }
    }

    /// `ImportResult.warnings` 에 누적 가능한 형태로 변환.
    pub fn into_warning(self) -> String {
        match self.entity_ref {
            Some(n) => format!("STEP resolve failed at #{}: {}", n, self.message),
            None => format!("STEP resolve failed: {}", self.message),
        }
    }
}

impl std::fmt::Display for ResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ResolveError {}

// ────────────────────────────────────────────────────────────────────────
// Output types
// ────────────────────────────────────────────────────────────────────────

/// AXIS2_PLACEMENT_3D — STEP 의 표준 좌표계.
///
/// `axis` = z-axis (primary direction)
/// `ref_direction` = x-axis (이 + axis 의 cross 가 y-axis)
///
/// AP203 spec: `axis` 와 `ref_direction` 은 단위 벡터여야 하며 서로 직교.
/// 비직교 입력 시 (Schmidt 정규화로 자동 보정 가능 — 본 MVP 는 입력
/// 그대로 사용 후 warning).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Axis2Placement3D {
    pub location: [f64; 3],
    pub axis: [f64; 3],            // primary direction (z)
    pub ref_direction: [f64; 3],   // x direction
}

impl Axis2Placement3D {
    /// Computed y-axis = axis × ref_direction (right-handed).
    pub fn y_axis(&self) -> [f64; 3] {
        cross(self.axis, self.ref_direction)
    }
}

// ────────────────────────────────────────────────────────────────────────
// Public resolvers
// ────────────────────────────────────────────────────────────────────────

/// `#N = CARTESIAN_POINT('', (x, y, z));` → `[x, y, z]`.
///
/// AP203 spec: arg[0] = name string, arg[1] = list of coordinates.
/// 좌표 list 의 길이가 정확히 3 이어야 함 (2D POINT 는 별도 처리).
pub fn resolve_cartesian_point(file: &StepFile, entity_ref: u32) -> Result<[f64; 3], ResolveError> {
    let entity = entity_by_id(file, entity_ref)?;
    if entity.tag != "CARTESIAN_POINT" {
        return Err(ResolveError::at(
            format!("expected CARTESIAN_POINT, got {}", entity.tag),
            entity_ref,
        ));
    }
    let coords = entity.args.get(1).ok_or_else(|| ResolveError::at(
        "CARTESIAN_POINT missing coordinates list (arg[1])", entity_ref,
    ))?;
    let list = coords.as_list().ok_or_else(|| ResolveError::at(
        "CARTESIAN_POINT arg[1] is not a list", entity_ref,
    ))?;
    if list.len() != 3 {
        return Err(ResolveError::at(
            format!("CARTESIAN_POINT expected 3 coords, got {}", list.len()),
            entity_ref,
        ));
    }
    Ok([
        list[0].as_f64().ok_or_else(|| ResolveError::at("coord[0] not numeric", entity_ref))?,
        list[1].as_f64().ok_or_else(|| ResolveError::at("coord[1] not numeric", entity_ref))?,
        list[2].as_f64().ok_or_else(|| ResolveError::at("coord[2] not numeric", entity_ref))?,
    ])
}

/// `#N = DIRECTION('', (dx, dy, dz));` → 정규화된 단위 벡터.
///
/// AP203 spec: DIRECTION 의 입력 벡터는 단위 길이가 권장되지만 강제
/// 안 됨 — resolver 가 자동 정규화 (zero vector 만 error).
pub fn resolve_direction(file: &StepFile, entity_ref: u32) -> Result<[f64; 3], ResolveError> {
    let entity = entity_by_id(file, entity_ref)?;
    if entity.tag != "DIRECTION" {
        return Err(ResolveError::at(
            format!("expected DIRECTION, got {}", entity.tag),
            entity_ref,
        ));
    }
    let coords = entity.args.get(1).ok_or_else(|| ResolveError::at(
        "DIRECTION missing components list (arg[1])", entity_ref,
    ))?;
    let list = coords.as_list().ok_or_else(|| ResolveError::at(
        "DIRECTION arg[1] is not a list", entity_ref,
    ))?;
    if list.len() != 3 {
        return Err(ResolveError::at(
            format!("DIRECTION expected 3 components, got {}", list.len()),
            entity_ref,
        ));
    }
    let v = [
        list[0].as_f64().ok_or_else(|| ResolveError::at("component[0] not numeric", entity_ref))?,
        list[1].as_f64().ok_or_else(|| ResolveError::at("component[1] not numeric", entity_ref))?,
        list[2].as_f64().ok_or_else(|| ResolveError::at("component[2] not numeric", entity_ref))?,
    ];
    let len_sq = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if len_sq < 1e-20 {
        return Err(ResolveError::at(
            "DIRECTION zero vector (cannot normalize)", entity_ref,
        ));
    }
    let inv_len = 1.0 / len_sq.sqrt();
    Ok([v[0] * inv_len, v[1] * inv_len, v[2] * inv_len])
}

/// `#N = VECTOR('', dir_ref, magnitude);` → `(unit_dir, magnitude)`.
///
/// AP203 spec: arg[1] = DIRECTION ref, arg[2] = magnitude (positive Real).
pub fn resolve_vector(file: &StepFile, entity_ref: u32) -> Result<([f64; 3], f64), ResolveError> {
    let entity = entity_by_id(file, entity_ref)?;
    if entity.tag != "VECTOR" {
        return Err(ResolveError::at(
            format!("expected VECTOR, got {}", entity.tag),
            entity_ref,
        ));
    }
    let dir_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("VECTOR arg[1] not a ref", entity_ref))?;
    let magnitude = entity.args.get(2)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at("VECTOR arg[2] not a real", entity_ref))?;
    if magnitude < 0.0 {
        return Err(ResolveError::at(
            format!("VECTOR magnitude must be non-negative, got {}", magnitude),
            entity_ref,
        ));
    }
    let dir = resolve_direction(file, dir_ref)?;
    Ok((dir, magnitude))
}

/// `#N = AXIS2_PLACEMENT_3D('', loc_ref, axis_ref, ref_dir_ref);`
///
/// AP203 spec: arg[1] = CARTESIAN_POINT ref (location),
///             arg[2] = DIRECTION ref (z-axis), optional → defaults to (0,0,1)
///             arg[3] = DIRECTION ref (x-axis), optional → defaults to (1,0,0)
///
/// Default 처리: arg[2] / arg[3] 가 `$` (Null) 이면 spec default 사용.
pub fn resolve_axis2_placement_3d(file: &StepFile, entity_ref: u32) -> Result<Axis2Placement3D, ResolveError> {
    let entity = entity_by_id(file, entity_ref)?;
    if entity.tag != "AXIS2_PLACEMENT_3D" {
        return Err(ResolveError::at(
            format!("expected AXIS2_PLACEMENT_3D, got {}", entity.tag),
            entity_ref,
        ));
    }
    let loc_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("AXIS2_PLACEMENT_3D arg[1] (location) not a ref", entity_ref))?;
    let location = resolve_cartesian_point(file, loc_ref)?;

    // arg[2] = z-axis (DIRECTION ref or $ for default (0, 0, 1))
    let axis = match entity.args.get(2) {
        Some(Value::Ref(r)) => resolve_direction(file, *r)?,
        Some(Value::Null) | None => [0.0, 0.0, 1.0],
        Some(other) => return Err(ResolveError::at(
            format!("AXIS2_PLACEMENT_3D arg[2] (axis) unexpected: {:?}", other),
            entity_ref,
        )),
    };

    // arg[3] = x-axis (ref_direction)
    let ref_direction = match entity.args.get(3) {
        Some(Value::Ref(r)) => resolve_direction(file, *r)?,
        Some(Value::Null) | None => [1.0, 0.0, 0.0],
        Some(other) => return Err(ResolveError::at(
            format!("AXIS2_PLACEMENT_3D arg[3] (ref_direction) unexpected: {:?}", other),
            entity_ref,
        )),
    };

    Ok(Axis2Placement3D { location, axis, ref_direction })
}

/// Generic — list value 에서 f64 배열 추출. Knot vector / weight list 등 사용.
pub fn resolve_real_list(value: &Value) -> Result<Vec<f64>, ResolveError> {
    let list = value.as_list().ok_or_else(|| ResolveError::new("expected list of reals"))?;
    let mut out = Vec::with_capacity(list.len());
    for (i, v) in list.iter().enumerate() {
        out.push(v.as_f64().ok_or_else(|| ResolveError::new(
            format!("real list[{}] not numeric: {:?}", i, v)
        ))?);
    }
    Ok(out)
}

/// Generic — list value 에서 usize 배열 추출. Knot multiplicity list 등 사용.
pub fn resolve_uint_list(value: &Value) -> Result<Vec<usize>, ResolveError> {
    let list = value.as_list().ok_or_else(|| ResolveError::new("expected list of integers"))?;
    let mut out = Vec::with_capacity(list.len());
    for (i, v) in list.iter().enumerate() {
        let n = match v {
            Value::Int(n) if *n >= 0 => *n as usize,
            other => return Err(ResolveError::new(
                format!("integer list[{}] not non-negative integer: {:?}", i, other)
            )),
        };
        out.push(n);
    }
    Ok(out)
}

/// Generic — list value 에서 entity ref 배열 추출. Control point reference list 등.
pub fn resolve_ref_list(value: &Value) -> Result<Vec<u32>, ResolveError> {
    let list = value.as_list().ok_or_else(|| ResolveError::new("expected list of refs"))?;
    let mut out = Vec::with_capacity(list.len());
    for (i, v) in list.iter().enumerate() {
        out.push(v.as_ref().ok_or_else(|| ResolveError::new(
            format!("ref list[{}] not a ref: {:?}", i, v)
        ))?);
    }
    Ok(out)
}

/// Resolve list of `CARTESIAN_POINT` refs → `Vec<[f64; 3]>`.
///
/// B_SPLINE_CURVE_WITH_KNOTS / BEZIER_CURVE 의 control_points_list 에 사용.
pub fn resolve_cartesian_points(file: &StepFile, refs: &[u32]) -> Result<Vec<[f64; 3]>, ResolveError> {
    let mut out = Vec::with_capacity(refs.len());
    for &r in refs {
        out.push(resolve_cartesian_point(file, r)?);
    }
    Ok(out)
}

/// Resolve 2D control point grid (rows of CARTESIAN_POINT refs).
///
/// `B_SPLINE_SURFACE_WITH_KNOTS` 의 control_points_list 는
/// `((#1, #2, ...), (#10, #11, ...))` 형태. row-major 로 추출.
pub fn resolve_cartesian_point_grid(
    file: &StepFile, value: &Value,
) -> Result<Vec<Vec<[f64; 3]>>, ResolveError> {
    let outer = value.as_list().ok_or_else(|| ResolveError::new(
        "expected control point grid (list of lists)"
    ))?;
    let mut grid = Vec::with_capacity(outer.len());
    for (i, row_val) in outer.iter().enumerate() {
        let row_list = row_val.as_list().ok_or_else(|| ResolveError::new(
            format!("ctrl_grid row[{}] is not a list", i)
        ))?;
        let mut row = Vec::with_capacity(row_list.len());
        for (j, ref_val) in row_list.iter().enumerate() {
            let r = ref_val.as_ref().ok_or_else(|| ResolveError::new(
                format!("ctrl_grid[{}][{}] not a ref", i, j)
            ))?;
            row.push(resolve_cartesian_point(file, r)?);
        }
        grid.push(row);
    }
    Ok(grid)
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

fn entity_by_id<'a>(file: &'a StepFile, id: u32) -> Result<&'a Entity, ResolveError> {
    file.data.get(&id).ok_or_else(|| ResolveError::at(
        format!("entity #{} not found in DATA section", id), id,
    ))
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

// ────────────────────────────────────────────────────────────────────────
// Resolver cache (선택적) — 같은 ref 를 여러 번 resolve 시 재계산 회피
// ────────────────────────────────────────────────────────────────────────

/// Resolve cache — 같은 entity 가 여러 번 참조될 때 재계산 회피.
///
/// promote_curve / promote_surface 본체에서 사용. STEP 파일은 보통
/// 수천 entity 라 cache 효과가 큼.
#[derive(Default)]
pub struct ResolveCache {
    points: HashMap<u32, [f64; 3]>,
    directions: HashMap<u32, [f64; 3]>,
    placements: HashMap<u32, Axis2Placement3D>,
}

impl ResolveCache {
    pub fn new() -> Self { Self::default() }

    pub fn cartesian_point(&mut self, file: &StepFile, r: u32) -> Result<[f64; 3], ResolveError> {
        if let Some(p) = self.points.get(&r) { return Ok(*p); }
        let p = resolve_cartesian_point(file, r)?;
        self.points.insert(r, p);
        Ok(p)
    }

    pub fn direction(&mut self, file: &StepFile, r: u32) -> Result<[f64; 3], ResolveError> {
        if let Some(d) = self.directions.get(&r) { return Ok(*d); }
        let d = resolve_direction(file, r)?;
        self.directions.insert(r, d);
        Ok(d)
    }

    pub fn placement(&mut self, file: &StepFile, r: u32) -> Result<Axis2Placement3D, ResolveError> {
        if let Some(p) = self.placements.get(&r) { return Ok(*p); }
        let p = resolve_axis2_placement_3d(file, r)?;
        self.placements.insert(r, p);
        Ok(p)
    }
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::step_parser::parse;

    fn minimal_data(data_body: &str) -> String {
        format!(
            "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('test'),'2;1');\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",
            data_body
        )
    }

    fn approx_eq(a: [f64; 3], b: [f64; 3], eps: f64) -> bool {
        (0..3).all(|i| (a[i] - b[i]).abs() < eps)
    }

    // ─── CARTESIAN_POINT ───────────────────────────────────────────────────

    #[test]
    fn resolve_cartesian_point_basic() {
        let f = parse(&minimal_data("#1 = CARTESIAN_POINT('', (1.5, -2.0, 3.25));")).unwrap();
        let p = resolve_cartesian_point(&f, 1).unwrap();
        assert!(approx_eq(p, [1.5, -2.0, 3.25], 1e-12));
    }

    #[test]
    fn resolve_cartesian_point_int_coerced() {
        // STEP allows integer literals where real is expected
        let f = parse(&minimal_data("#1 = CARTESIAN_POINT('', (0, 0, 0));")).unwrap();
        let p = resolve_cartesian_point(&f, 1).unwrap();
        assert!(approx_eq(p, [0.0, 0.0, 0.0], 1e-12));
    }

    #[test]
    fn resolve_cartesian_point_wrong_tag_errors() {
        let f = parse(&minimal_data("#1 = DIRECTION('', (1., 0., 0.));")).unwrap();
        let err = resolve_cartesian_point(&f, 1).unwrap_err();
        assert!(err.message.contains("expected CARTESIAN_POINT"));
        assert_eq!(err.entity_ref, Some(1));
    }

    #[test]
    fn resolve_cartesian_point_missing_id_errors() {
        let f = parse(&minimal_data("")).unwrap();
        let err = resolve_cartesian_point(&f, 99).unwrap_err();
        assert!(err.message.contains("not found"));
    }

    #[test]
    fn resolve_cartesian_point_2d_errors() {
        let f = parse(&minimal_data("#1 = CARTESIAN_POINT('', (1.0, 2.0));")).unwrap();
        let err = resolve_cartesian_point(&f, 1).unwrap_err();
        assert!(err.message.contains("expected 3 coords"));
    }

    // ─── DIRECTION ────────────────────────────────────────────────────────

    #[test]
    fn resolve_direction_already_unit() {
        let f = parse(&minimal_data("#1 = DIRECTION('', (1.0, 0.0, 0.0));")).unwrap();
        let d = resolve_direction(&f, 1).unwrap();
        assert!(approx_eq(d, [1.0, 0.0, 0.0], 1e-12));
    }

    #[test]
    fn resolve_direction_normalizes() {
        // (3, 4, 0) → (0.6, 0.8, 0)
        let f = parse(&minimal_data("#1 = DIRECTION('', (3.0, 4.0, 0.0));")).unwrap();
        let d = resolve_direction(&f, 1).unwrap();
        assert!(approx_eq(d, [0.6, 0.8, 0.0], 1e-12));
    }

    #[test]
    fn resolve_direction_zero_vector_errors() {
        let f = parse(&minimal_data("#1 = DIRECTION('', (0.0, 0.0, 0.0));")).unwrap();
        let err = resolve_direction(&f, 1).unwrap_err();
        assert!(err.message.contains("zero vector"));
    }

    // ─── VECTOR ───────────────────────────────────────────────────────────

    #[test]
    fn resolve_vector_basic() {
        let src = minimal_data(concat!(
            "#1 = DIRECTION('', (1.0, 0.0, 0.0));\n",
            "#2 = VECTOR('', #1, 5.0);"
        ));
        let f = parse(&src).unwrap();
        let (dir, mag) = resolve_vector(&f, 2).unwrap();
        assert!(approx_eq(dir, [1.0, 0.0, 0.0], 1e-12));
        assert_eq!(mag, 5.0);
    }

    #[test]
    fn resolve_vector_negative_magnitude_errors() {
        let src = minimal_data(concat!(
            "#1 = DIRECTION('', (1.0, 0.0, 0.0));\n",
            "#2 = VECTOR('', #1, -1.0);"
        ));
        let f = parse(&src).unwrap();
        let err = resolve_vector(&f, 2).unwrap_err();
        assert!(err.message.contains("non-negative"));
    }

    // ─── AXIS2_PLACEMENT_3D ───────────────────────────────────────────────

    #[test]
    fn resolve_axis2_placement_basic() {
        let src = minimal_data(concat!(
            "#1 = CARTESIAN_POINT('', (10., 20., 30.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = DIRECTION('', (1., 0., 0.));\n",
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);"
        ));
        let f = parse(&src).unwrap();
        let p = resolve_axis2_placement_3d(&f, 4).unwrap();
        assert!(approx_eq(p.location, [10., 20., 30.], 1e-12));
        assert!(approx_eq(p.axis, [0., 0., 1.], 1e-12));
        assert!(approx_eq(p.ref_direction, [1., 0., 0.], 1e-12));
        // y-axis = z × x = (0, 0, 1) × (1, 0, 0) = (0, 1, 0)
        assert!(approx_eq(p.y_axis(), [0., 1., 0.], 1e-12));
    }

    #[test]
    fn resolve_axis2_placement_default_directions() {
        // Defaults: axis = (0,0,1), ref_direction = (1,0,0)
        let src = minimal_data(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);"
        ));
        let f = parse(&src).unwrap();
        let p = resolve_axis2_placement_3d(&f, 2).unwrap();
        assert!(approx_eq(p.axis, [0., 0., 1.], 1e-12));
        assert!(approx_eq(p.ref_direction, [1., 0., 0.], 1e-12));
    }

    #[test]
    fn resolve_axis2_placement_chain_errors() {
        // location ref points to wrong type → error propagates
        let src = minimal_data(concat!(
            "#1 = DIRECTION('', (1., 0., 0.));\n",   // ← intentionally wrong
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);"
        ));
        let f = parse(&src).unwrap();
        let err = resolve_axis2_placement_3d(&f, 2).unwrap_err();
        assert!(err.message.contains("expected CARTESIAN_POINT"));
    }

    // ─── Generic list resolvers ───────────────────────────────────────────

    #[test]
    fn resolve_real_list_works() {
        let src = minimal_data("#1 = TEST('', (0., 0.5, 1.0, 1.5));");
        let f = parse(&src).unwrap();
        let entity = f.entity(1).unwrap();
        let list = resolve_real_list(&entity.args[1]).unwrap();
        assert_eq!(list, vec![0.0, 0.5, 1.0, 1.5]);
    }

    #[test]
    fn resolve_uint_list_works() {
        let src = minimal_data("#1 = TEST('', (4, 1, 1, 4));");
        let f = parse(&src).unwrap();
        let entity = f.entity(1).unwrap();
        let mults = resolve_uint_list(&entity.args[1]).unwrap();
        assert_eq!(mults, vec![4, 1, 1, 4]);
    }

    #[test]
    fn resolve_uint_list_rejects_negative() {
        let src = minimal_data("#1 = TEST('', (4, -1, 1));");
        let f = parse(&src).unwrap();
        let entity = f.entity(1).unwrap();
        let err = resolve_uint_list(&entity.args[1]).unwrap_err();
        assert!(err.message.contains("non-negative"));
    }

    #[test]
    fn resolve_ref_list_works() {
        let src = minimal_data("#1 = TEST('', (#10, #20, #30));");
        let f = parse(&src).unwrap();
        let entity = f.entity(1).unwrap();
        let refs = resolve_ref_list(&entity.args[1]).unwrap();
        assert_eq!(refs, vec![10, 20, 30]);
    }

    // ─── Multi-point batch resolver ────────────────────────────────────────

    #[test]
    fn resolve_cartesian_points_batch() {
        let src = minimal_data(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = CARTESIAN_POINT('', (1., 0., 0.));\n",
            "#3 = CARTESIAN_POINT('', (1., 1., 0.));\n"
        ));
        let f = parse(&src).unwrap();
        let pts = resolve_cartesian_points(&f, &[1, 2, 3]).unwrap();
        assert_eq!(pts.len(), 3);
        assert!(approx_eq(pts[1], [1., 0., 0.], 1e-12));
    }

    #[test]
    fn resolve_cartesian_point_grid_2x3() {
        // 2 row × 3 col grid for B_SPLINE_SURFACE_WITH_KNOTS control net.
        let src = minimal_data(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = CARTESIAN_POINT('', (1., 0., 0.));\n",
            "#3 = CARTESIAN_POINT('', (2., 0., 0.));\n",
            "#4 = CARTESIAN_POINT('', (0., 1., 0.));\n",
            "#5 = CARTESIAN_POINT('', (1., 1., 1.));\n",
            "#6 = CARTESIAN_POINT('', (2., 1., 0.));\n",
            "#7 = SURFACE('', ((#1, #2, #3), (#4, #5, #6)));"
        ));
        let f = parse(&src).unwrap();
        let entity = f.entity(7).unwrap();
        let grid = resolve_cartesian_point_grid(&f, &entity.args[1]).unwrap();
        assert_eq!(grid.len(), 2);          // 2 rows
        assert_eq!(grid[0].len(), 3);       // 3 cols
        assert!(approx_eq(grid[0][2], [2., 0., 0.], 1e-12));
        assert!(approx_eq(grid[1][1], [1., 1., 1.], 1e-12));
    }

    // ─── ResolveCache ─────────────────────────────────────────────────────

    #[test]
    fn cache_returns_same_value_on_repeat() {
        let src = minimal_data("#1 = CARTESIAN_POINT('', (1., 2., 3.));");
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let p1 = cache.cartesian_point(&f, 1).unwrap();
        let p2 = cache.cartesian_point(&f, 1).unwrap();
        assert_eq!(p1, p2);
        assert_eq!(cache.points.len(), 1);
    }

    // ─── Error formatting ──────────────────────────────────────────────────

    #[test]
    fn resolve_error_into_warning_includes_ref() {
        let err = ResolveError::at("test message", 42);
        let warning = err.into_warning();
        assert!(warning.contains("#42"));
        assert!(warning.contains("test message"));
    }

    #[test]
    fn resolve_error_without_ref() {
        let err = ResolveError::new("no ref");
        let warning = err.into_warning();
        assert!(!warning.contains("#"));
        assert!(warning.contains("no ref"));
    }
}
