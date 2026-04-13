//! Geometric tolerance constants.
//!
//! Refined from buildragon's tolerances.rs with clearer naming.

/// Vertex coincidence tolerance (positions closer than this are merged)
pub const VERTEX_TOLERANCE: f64 = 1e-7;

/// Edge coincidence tolerance
pub const EDGE_TOLERANCE: f64 = 1e-7;

/// Face tolerance
pub const FACE_TOLERANCE: f64 = 1e-7;

/// Coplanarity test tolerance (dot product threshold)
pub const COPLANAR_TOLERANCE: f64 = 1e-6;

/// Loop planarity enforcement tolerance
pub const LOOP_PLANAR_TOLERANCE: f64 = 1e-6;

/// Minimum face area difference for merge operations
pub const FACE_AREA_TOLERANCE: f64 = 1e-6;

/// Triangle winding order fix tolerance
pub const WINDING_ORDER_TOLERANCE: f64 = 1e-12;

/// Normal computation epsilon (keep at 0 to avoid missing thin faces)
pub const NORMAL_EPSILON: f64 = 0.0;
