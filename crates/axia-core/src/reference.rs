//! ADR-095 Phase 3-β — Reference (Two-Layer Citizenship Phase 3).
//!
//! Reference 시민권 — Form (Shape) / Property (Xia) 두 layer 와 직교
//! 하는 별개 분류. v3.2 spec 약속 + LOCKED #26 메타-원칙 #2 ("외부
//! 참조는 형태/모양만") 의 architectural 정착.
//!
//! 3 categories (R-C):
//! - **ConstructionLine** — 작도선 (DrawCenterline 결과). Final build
//!   에 미포함, print/export 시 자연 제외.
//! - **ImportedMesh** — STEP/IGES/OBJ import 결과 (ADR-035/036/081~086).
//!   외부 모델 — 사용자 의도 *수정 안 함*.
//! - **PointCloud** — LiDAR scan / sensor data. 측정 데이터 — 측정 대상.
//!
//! Architectural lock-ins (ADR-095 §2.2):
//! - L1: Mesh-level Map storage (R-A) — bincode legacy 호환
//! - L2: Form/Property 와 mutually exclusive geometry ownership (R-B)
//! - L3: O(1) reverse index (R-D, ADR-079 W-1 face_to_shape 답습)
//! - L5: additive only (Form/Property 회귀 자산 영향 0)
//!
//! Cross-references:
//! - ADR-095 §2 (Reference enum spec)
//! - ADR-049 §4 Phase 3 promise
//! - LOCKED #26 메타-원칙 #2 (외부 참조는 형태/모양만)
//! - v3.2 spec §3 시민권 (Reference layer)

use serde::{Deserialize, Serialize};
use axia_geo::{EdgeId, FaceId, VertId};

/// Unique identifier for a `Reference` entity. Newtype to keep type
/// distinct from `XiaId` / `ShapeId` (Rust compile-time guard for
/// citizenship layer mix-ups, ADR-050 §2.1.1 답습).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ReferenceId(u32);

impl ReferenceId {
    pub fn new(raw: u32) -> Self { Self(raw) }
    pub fn raw(self) -> u32 { self.0 }
}

/// Reference category — geometry kind + 출처 metadata.
///
/// Mutually exclusive geometry ownership (R-B): a given face/edge/vert
/// id belongs to AT MOST one Reference, AND cannot simultaneously
/// belong to a Form (Shape) or Property (Xia) — Scene-level `create_
/// reference` must enforce this invariant.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ReferenceCategory {
    /// 작도선 — N edges 의 standalone wire. Final build 미포함.
    ConstructionLine {
        edge_ids: Vec<EdgeId>,
    },
    /// 외부 import — N faces (face_set). source_path 는 출처 추적용
    /// (예: "/projects/foo/site.step").
    ImportedMesh {
        face_ids: Vec<FaceId>,
        source_path: Option<String>,
    },
    /// 포인트 클라우드 — N standalone vertices (no edges, no faces).
    PointCloud {
        vert_ids: Vec<VertId>,
    },
}

impl ReferenceCategory {
    /// Stable label for telemetry / serialization.
    pub fn label(&self) -> &'static str {
        match self {
            Self::ConstructionLine { .. } => "ConstructionLine",
            Self::ImportedMesh { .. } => "ImportedMesh",
            Self::PointCloud { .. } => "PointCloud",
        }
    }
}

/// Reference 시민 — Form/Property 와 직교하는 third citizenship layer.
///
/// **사용자 의도 (LOCKED #26 메타-원칙 #2)**: *수정 안 함* (build 대상
/// 아님). Boolean / Push-Pull / Offset 등 op operand 거부 default —
/// promote to Form 후 op 적용 (R-E lock-in).
///
/// **Visibility / Locked**: 사용자 explicit 토글 (Inspector 또는
/// SettingsPanel — Phase 3-δ).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Reference {
    pub id: ReferenceId,
    pub name: String,
    pub category: ReferenceCategory,
    pub visible: bool,
    pub locked: bool,
}

impl Reference {
    /// Construct a new Reference with given id, name, category. Default
    /// flags: visible=true, locked=false. Caller (Scene::create_reference)
    /// fills in via this then inserts into Scene.references map.
    pub fn new(id: ReferenceId, name: String, category: ReferenceCategory) -> Self {
        Self {
            id,
            name,
            category,
            visible: true,
            locked: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_id_roundtrip() {
        let id = ReferenceId::new(42);
        assert_eq!(id.raw(), 42);
        let id2 = ReferenceId::new(7);
        assert_ne!(id, id2);
    }

    #[test]
    fn reference_new_starts_visible_unlocked() {
        let r = Reference::new(
            ReferenceId::new(1),
            "Test".into(),
            ReferenceCategory::ConstructionLine { edge_ids: vec![] },
        );
        assert!(r.visible);
        assert!(!r.locked);
    }

    #[test]
    fn category_label_3_categories() {
        let cl = ReferenceCategory::ConstructionLine { edge_ids: vec![] };
        let im = ReferenceCategory::ImportedMesh {
            face_ids: vec![],
            source_path: None,
        };
        let pc = ReferenceCategory::PointCloud { vert_ids: vec![] };
        assert_eq!(cl.label(), "ConstructionLine");
        assert_eq!(im.label(), "ImportedMesh");
        assert_eq!(pc.label(), "PointCloud");
    }

    #[test]
    fn reference_serde_roundtrip() {
        // Critical for ADR-095 Phase 3-ε (snapshot section 8) — ensure
        // Reference serializable now even though section is deferred.
        let r = Reference::new(
            ReferenceId::new(5),
            "Imported Site".into(),
            ReferenceCategory::ImportedMesh {
                face_ids: vec![FaceId::new(10), FaceId::new(20)],
                source_path: Some("/path/to/site.step".into()),
            },
        );
        let bytes = bincode::serialize(&r).expect("serialize");
        let restored: Reference = bincode::deserialize(&bytes).expect("deserialize");
        assert_eq!(restored, r);
    }
}
