//! ADR-078 — Boolean Group Persistence (Rust mirror of TS U-1).
//!
//! Mirrors the TS-side `groupTags: Map<faceId, 'A'|'B'>` in
//! `SelectionManager.ts` (ADR-074 U-1). The Rust side owns the
//! persistent storage that survives project save/load round-trips;
//! the TS side is the runtime UI mirror. P-2/P-3 sync the two.
//!
//! Per ADR-078 §C lock-ins:
//! - One face = one group (HashMap key uniqueness — TS U-1 invariant)
//! - `set` overwrites on conflict (same as TS U-1 `setGroupTag`)
//! - `clear` resets all tags (TS U-1 `clearGroupTags` parity)
//! - `has_any` true iff ≥1 tag (TS U-1 `hasAnyGroupTag` parity)
//! - `has_selection` true iff BOTH A and B (TS U-1 `hasGroupSelection`)

use serde::{Deserialize, Serialize};

/// ADR-078 P-1 — Boolean Group tag.
///
/// Discriminates which Boolean operand a face belongs to in the
/// user-explicit grouping (ADR-074). One face = one tag (or untagged).
/// Mirror of TS literal `'A' | 'B'` from
/// `web/src/tools/SelectionManager.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BooleanGroupTag {
    /// Group A — first Boolean operand
    A,
    /// Group B — second Boolean operand
    B,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boolean_group_tag_serde_roundtrip() {
        let original = BooleanGroupTag::A;
        let bytes = bincode::serialize(&original).expect("serialize A");
        let decoded: BooleanGroupTag = bincode::deserialize(&bytes).expect("deserialize A");
        assert_eq!(original, decoded);

        let original = BooleanGroupTag::B;
        let bytes = bincode::serialize(&original).expect("serialize B");
        let decoded: BooleanGroupTag = bincode::deserialize(&bytes).expect("deserialize B");
        assert_eq!(original, decoded);
    }

    #[test]
    fn boolean_group_tag_a_and_b_are_distinct() {
        assert_ne!(BooleanGroupTag::A, BooleanGroupTag::B);
    }
}
