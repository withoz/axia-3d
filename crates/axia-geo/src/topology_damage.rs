//! ADR-097 T-β — Topology Damage Detection (Two-Layer Citizenship Phase 4).
//!
//! Q5 사건 2~4 의 *centralized typed detection*. ADR-007 invariant +
//! ADR-051 P7 manifold 의 결과를 dispatcher-friendly typed enum 으로
//! categorize.
//!
//! **Phase 4 architectural 본질**: 새 알고리즘 발명 0 — 5개월 누적
//! 자산 (verify_face_invariants / verify_p7_manifold / face_to_xia /
//! face_to_shape / face_to_reference reverse 인덱스) 의 centralized
//! orchestration.
//!
//! **T-β scope (본 sub-step)**: Mesh-level damage detection (사건 2/3).
//! 사건 4 (Orphan — Scene context 필요) 는 T-γ Scene-level wrapper 에서
//! 처리.
//!
//! Cross-references:
//! - ADR-097 §2 (Lock-ins T-A ~ T-H)
//! - ADR-049 §4 Q5 (사건 분류 정의)
//! - LOCKED #26 메타-원칙 #6 (Preventive over Curative)

use crate::entities::{EdgeId, FaceId};

/// Q5 사건 2~4 의 typed damage kind. Phase 4 dispatcher (T-γ) 가 본
/// enum 을 패턴 매치하여 알려진 recovery 자산을 호출.
///
/// **사건 1 (재질 제거)** 은 본 enum 에 포함 안 함 — Phase 2 / ADR-091
/// 에서 사용자 explicit Inspector 액션으로 처리.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopologyDamageKind {
    /// **사건 2 (boundary edge)**: edge 가 정확히 1 개의 active
    /// incident face 를 가짐 — manifold 개방 (closed solid 가정 위반).
    ///
    /// 출처: radial HE chain 검사 (active HE with face count == 1).
    /// Recovery 자산 (T-γ): `repair_non_manifold_edges` (LOCKED #16
    /// K-ε hotfix) 또는 boundary 보존 의도 시 Sheet 분류.
    BoundaryEdge {
        edge_id: EdgeId,
        incident_face: FaceId,
    },

    /// **사건 2 (non-manifold)**: edge 가 3+ 개의 active incident face
    /// 를 가짐 — manifold 위반 (P7-M1 violation).
    ///
    /// 출처: radial HE chain count >= 3.
    /// Recovery 자산 (T-γ): `repair_non_manifold_edges` 또는 사용자
    /// 다이얼로그 ([Undo] / [강등] / [수동수정]).
    NonManifold {
        edge_id: EdgeId,
        face_count: usize,
    },

    /// **사건 3 (degenerate face)**: face 가 0-area 또는 NaN/zero normal
    /// — render / Boolean / Push-Pull 모두 정의되지 않음.
    ///
    /// 출처: face_normal length zero 또는 NaN 검사.
    /// Recovery 자산 (T-γ): `deactivate_empty_emit_faces` 또는 face 의
    /// 명시 deactivation.
    Degenerate {
        face_id: FaceId,
        reason: &'static str,
    },

    /// **사건 4 (orphan face)**: face 가 active 이지만 어느 시민권
    /// 시민에도 등록되지 않음 (face_to_xia / face_to_shape /
    /// face_to_reference 모두 부재).
    ///
    /// 출처: Scene-level reverse 인덱스 검사 (T-γ Scene wrapper).
    /// Mesh-level `detect_topology_damage` 는 본 variant 미생성.
    /// Recovery 자산 (T-γ): Scene::orphan_recovery 또는 face 의 명시
    /// 시민권 등록 (사용자 다이얼로그 prompt).
    Orphan {
        face_id: FaceId,
    },
}

impl TopologyDamageKind {
    /// Stable label for telemetry / dispatch routing.
    pub fn label(&self) -> &'static str {
        match self {
            Self::BoundaryEdge { .. } => "BoundaryEdge",
            Self::NonManifold { .. } => "NonManifold",
            Self::Degenerate { .. } => "Degenerate",
            Self::Orphan { .. } => "Orphan",
        }
    }
}

/// ADR-097 T-γ — Recovery 시도의 결과. dispatcher 가 호출자에게 반환.
///
/// `Recovered`: 모든 damage atomic recovery 성공.
/// `PartialFailure`: 일부 damage 잔존 — 사용자 다이얼로그 escalation
/// 필요 ([Undo] / [강등] / [수동수정]).
/// `NoOp`: 처음부터 damage 0 — recovery 미시도.
#[derive(Debug, Clone)]
pub enum RecoveryOutcome {
    /// 처음부터 damage 0 — recovery 미시도.
    NoOp,
    /// 모든 damage 자동 recovery 성공.
    Recovered {
        /// 적용된 fix 수 (telemetry).
        fixes_applied: usize,
        /// 처음 detected 한 damage 수 (telemetry).
        initial_damages: usize,
    },
    /// 일부 damage 잔존 — 사용자 다이얼로그 escalation 필요.
    PartialFailure {
        /// 적용된 fix 수.
        fixes_applied: usize,
        /// 잔존 damage 의 typed report.
        remaining: TopologyDamageReport,
    },
}

impl RecoveryOutcome {
    /// Recovery 성공 여부 (NoOp 또는 Recovered).
    #[inline]
    pub fn is_success(&self) -> bool {
        matches!(self, Self::NoOp | Self::Recovered { .. })
    }

    /// Stable label for telemetry.
    pub fn label(&self) -> &'static str {
        match self {
            Self::NoOp => "NoOp",
            Self::Recovered { .. } => "Recovered",
            Self::PartialFailure { .. } => "PartialFailure",
        }
    }
}

/// `Mesh::detect_topology_damage` 의 결과. 빈 `damages` 면 mesh-level
/// invariant 통과 (사건 2/3 없음).
#[derive(Debug, Clone)]
pub struct TopologyDamageReport {
    pub damages: Vec<TopologyDamageKind>,
    /// 검사된 active face 수 — 성능 telemetry 용.
    pub checked_faces: usize,
    /// 검사된 active edge 수 — 성능 telemetry 용.
    pub checked_edges: usize,
}

impl TopologyDamageReport {
    /// 모든 mesh-level invariant 통과 여부. T-β scope 에서는 사건 4
    /// (Orphan) 미포함 — 그 검사는 T-γ Scene wrapper.
    #[inline]
    pub fn is_clean(&self) -> bool {
        self.damages.is_empty()
    }

    /// Damage 의 분류별 count (telemetry). Returns
    /// (boundary_edge, non_manifold, degenerate, orphan).
    pub fn count_by_kind(&self) -> (usize, usize, usize, usize) {
        let mut be = 0;
        let mut nm = 0;
        let mut dg = 0;
        let mut orph = 0;
        for d in &self.damages {
            match d {
                TopologyDamageKind::BoundaryEdge { .. } => be += 1,
                TopologyDamageKind::NonManifold { .. } => nm += 1,
                TopologyDamageKind::Degenerate { .. } => dg += 1,
                TopologyDamageKind::Orphan { .. } => orph += 1,
            }
        }
        (be, nm, dg, orph)
    }

    /// Human-readable 요약 (사용자 facing 다이얼로그 prefix 활용).
    pub fn summary(&self) -> String {
        if self.damages.is_empty() {
            format!(
                "✓ Topology clean ({} faces, {} edges checked)",
                self.checked_faces, self.checked_edges,
            )
        } else {
            let (be, nm, dg, orph) = self.count_by_kind();
            format!(
                "✗ {} damages: {} boundary / {} non-manifold / {} degenerate / {} orphan",
                self.damages.len(), be, nm, dg, orph,
            )
        }
    }
}
