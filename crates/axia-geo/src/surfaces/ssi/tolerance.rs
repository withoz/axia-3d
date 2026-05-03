//! ADR-055 Phase J Step 5 — Boolean Tolerance Unification.
//!
//! Single source of truth for tolerance policy across the Boolean
//! pipeline (SSI / trim arithmetic / containment / DCEL integration).
//!
//! Reconciles:
//!   - LOCKED #5 (1.5μm spatial-hash dedup at DCEL level)
//!   - Phase F SSI MVP (1e-3 mm geometric)
//!   - Phase J Step 1-2 (parameter-space chord_tol)

/// Phase J unified Boolean tolerance.
///
/// All distances are in **mm** (engine convention). Parameter and angular
/// tolerances are unitless / radians. Use `Default::default()` to obtain
/// the production policy aligned with LOCKED #5.
#[derive(Clone, Copy, Debug)]
pub struct BooleanTolerance {
    /// Geometric distance threshold (mm) — used for "are these two points
    /// the same?", "is this point on this curve?", etc. SSI Newton
    /// convergence target.
    pub geometric: f64,
    /// Parameter-space equality threshold — used for knot multiplicity
    /// detection, parameter coincidence in trim curves.
    pub parameter: f64,
    /// Angular threshold (radians) — used for tangent direction comparison
    /// (G1 continuity, tangent-contact detection in SSI).
    pub angular: f64,
    /// Topological dedup threshold (mm) — must match the engine's
    /// `LOCKED #5` (1.5μm) spatial-hash dedup. Any two coincident
    /// vertices/HE endpoints within this distance collapse into one.
    pub topological: f64,
}

impl Default for BooleanTolerance {
    fn default() -> Self {
        Self {
            geometric:   1e-3,    // 1 micron (1 μm = 0.001 mm)
            parameter:   1e-6,
            angular:     1e-4,    // ~0.006°
            topological: 1.5e-3,  // 1.5 μm — LOCKED #5 spatial-hash dedup
        }
    }
}

impl BooleanTolerance {
    /// Strict variant — Newton converges to 1e-6 mm. Slow but accurate;
    /// use for STEP/IGES round-trip validation (Phase Q).
    pub fn strict() -> Self {
        Self {
            geometric:   1e-6,
            parameter:   1e-9,
            angular:     1e-7,
            topological: 1.5e-3,
        }
    }

    /// Relaxed variant — sub-millimeter accuracy. Good for fast preview.
    pub fn relaxed() -> Self {
        Self {
            geometric:   1e-2,    // 10 μm
            parameter:   1e-4,
            angular:     1e-3,
            topological: 1.5e-3,
        }
    }

    /// Sanity check — caller-supplied tolerance is sane.
    /// Returns Err if any field is non-positive or NaN.
    pub fn validate(&self) -> Result<(), &'static str> {
        if !self.geometric.is_finite()   || self.geometric <= 0.0   { return Err("geometric must be finite and > 0"); }
        if !self.parameter.is_finite()   || self.parameter <= 0.0   { return Err("parameter must be finite and > 0"); }
        if !self.angular.is_finite()     || self.angular <= 0.0     { return Err("angular must be finite and > 0"); }
        if !self.topological.is_finite() || self.topological <= 0.0 { return Err("topological must be finite and > 0"); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// LOCKED #5 / ADR-055 §2.6 — Default topological tol = 1.5μm.
    #[test]
    fn default_topological_matches_locked_5_spatial_hash() {
        let t = BooleanTolerance::default();
        assert_eq!(t.topological, 1.5e-3, "must match LOCKED #5 spatial-hash dedup tolerance");
    }

    /// Phase J §2.6 — Default geometric = 1 micron.
    #[test]
    fn default_geometric_one_micron() {
        let t = BooleanTolerance::default();
        assert_eq!(t.geometric, 1e-3);
    }

    /// Strict variant tightens geometric / parameter / angular but
    /// preserves the LOCKED #5 topological tolerance (cannot tighten
    /// without breaking DCEL invariants).
    #[test]
    fn strict_keeps_topological_at_locked_5() {
        let t = BooleanTolerance::strict();
        assert_eq!(t.topological, 1.5e-3);
        assert!(t.geometric < BooleanTolerance::default().geometric);
        assert!(t.parameter < BooleanTolerance::default().parameter);
        assert!(t.angular < BooleanTolerance::default().angular);
    }

    /// Relaxed variant for preview — geometric 10μm, others scaled.
    #[test]
    fn relaxed_geometric_ten_micron() {
        let t = BooleanTolerance::relaxed();
        assert_eq!(t.geometric, 1e-2);
        assert_eq!(t.topological, 1.5e-3, "topological stays at LOCKED #5");
    }

    /// validate() rejects non-positive / non-finite values.
    #[test]
    fn validate_rejects_invalid() {
        let mut t = BooleanTolerance::default();
        t.geometric = -1.0;
        assert!(t.validate().is_err());

        let mut t = BooleanTolerance::default();
        t.parameter = f64::NAN;
        assert!(t.validate().is_err());

        let mut t = BooleanTolerance::default();
        t.angular = 0.0;
        assert!(t.validate().is_err());

        let mut t = BooleanTolerance::default();
        t.topological = f64::INFINITY;
        assert!(t.validate().is_err());

        // Default and strict/relaxed all valid
        assert!(BooleanTolerance::default().validate().is_ok());
        assert!(BooleanTolerance::strict().validate().is_ok());
        assert!(BooleanTolerance::relaxed().validate().is_ok());
    }
}
