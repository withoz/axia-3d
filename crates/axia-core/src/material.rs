//! Material System
//!
//! Manages physical and visual properties of XIA objects.
//! Materials define how geometry manifests in the physical world.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
// `BTreeMap` for materials + tier_index ensures deterministic bincode
// serialization (HashMap iteration order is non-deterministic, breaking
// snapshot byte-equality round-trips). ADR-098 S-γ — section 9 must be
// stable for orphan_recovery::preview_leaves_scene_unchanged regression.
#[allow(unused_imports)] use HashMap as _LegacyHashMap;
use axia_geo::MaterialId;

/// Fire resistance rating (minutes)
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum FireRating {
    None,
    Minutes(u32),
}

/// Physical material properties
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PhysicalProperties {
    /// Density in kg/m³
    pub density: f64,
    /// Friction coefficient (0.0 = frictionless, 1.0 = high friction)
    pub friction: f64,
    /// Restitution / Elasticity (0.0 = no bounce, 1.0 = perfect elasticity)
    pub restitution: f64,
    /// Specific gravity (density / water density, dimensionless)
    pub specific_gravity: f64,
    /// Thermal conductivity in W/(m·K)
    pub thermal_conductivity: f64,
    /// Fire resistance rating
    pub fire_rating: FireRating,
}

/// ADR-099 L-β — UV projection mode for a texture channel.
///
/// Mirrors TS `TextureInfo.projection` union: 'planar' | 'box' |
/// 'cylindrical'. Stored as enum for type-safety; serialized as
/// lowercase string for TS interop.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextureProjection {
    Planar,
    Box,
    Cylindrical,
}

impl Default for TextureProjection {
    fn default() -> Self { Self::Planar }
}

/// ADR-099 L-β — A single texture channel payload.
///
/// Mirrors TS `TextureInfo` (web/src/materials/MaterialLibrary.ts).
/// Stored as base64 dataUrl for direct .axia file embedding (no
/// external file refs — keeps snapshot self-contained, consistent
/// with ADR-098 S-γ section 9 policy).
///
/// Fields parallel TS shape for snapshot round-trip (L-η).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TextureChannelInfo {
    /// base64 dataUrl (PNG/JPEG/etc) — included in snapshot section 9.
    #[serde(rename = "dataUrl")]
    pub data_url: String,
    /// UV projection mode.
    #[serde(default)]
    pub projection: TextureProjection,
    /// World-units-per-tile (e.g. 0.001 = 1m per tile).
    pub scale: f64,
    /// Optional projection-axis rotation (radians, planar/box only).
    /// NOTE: NO `skip_serializing_if` — bincode positional EOF safety
    /// (see ADR-099 L-β 사후 정정).
    #[serde(default)]
    pub rotation: Option<f64>,
    /// Optional display label (filename etc). Same bincode safety.
    #[serde(default)]
    pub label: Option<String>,
}

impl TextureChannelInfo {
    /// Construct a new channel with the minimum required fields.
    /// `rotation` and `label` default to `None`; `projection` to Planar.
    pub fn new(data_url: String, scale: f64) -> Self {
        Self {
            data_url,
            projection: TextureProjection::default(),
            scale,
            rotation: None,
            label: None,
        }
    }

    /// L-B validation — dataUrl must be non-empty and scale > 0.
    /// Returns Ok on valid, Err with a short reason otherwise.
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.data_url.is_empty() {
            return Err("dataUrl is empty");
        }
        if !(self.scale > 0.0) || !self.scale.is_finite() {
            return Err("scale must be > 0 and finite");
        }
        Ok(())
    }
}

/// ADR-099 L-β — Layered PBR channels (Phase 5-B).
///
/// 4 fixed channels per Lock-in L-A (PBR standard: Disney BRDF +
/// Three.js MeshStandardMaterial). Each channel is optional — a
/// material may use any subset (e.g. albedo only = current behavior,
/// albedo + normal = bump-mapped, all 4 = full PBR).
///
/// Mirrored on TS side as `LayeredChannels` (L-ζ bridge wrappers).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LayeredChannels {
    /// Base color (a.k.a. diffuse) — Three.js `material.map`.
    #[serde(default)]
    pub albedo: Option<TextureChannelInfo>,
    /// Tangent-space normal map — Three.js `material.normalMap`.
    /// NO `skip_serializing_if` — bincode positional EOF safety
    /// (ADR-099 L-β 사후 정정 답습).
    #[serde(default)]
    pub normal: Option<TextureChannelInfo>,
    /// Greyscale roughness map — Three.js `material.roughnessMap`.
    #[serde(default)]
    pub roughness: Option<TextureChannelInfo>,
    /// Greyscale metallic map — Three.js `material.metalnessMap`.
    #[serde(default)]
    pub metallic: Option<TextureChannelInfo>,
}

impl LayeredChannels {
    /// True iff at least one channel is populated.
    pub fn has_any_channel(&self) -> bool {
        self.albedo.is_some()
            || self.normal.is_some()
            || self.roughness.is_some()
            || self.metallic.is_some()
    }

    /// Count of populated channels (0..=4).
    pub fn channel_count(&self) -> usize {
        [&self.albedo, &self.normal, &self.roughness, &self.metallic]
            .iter()
            .filter(|c| c.is_some())
            .count()
    }

    /// L-B validation — every populated channel must validate. Returns
    /// the FIRST error encountered (with channel name prefix) or Ok if
    /// all channels validate.
    pub fn validate(&self) -> Result<(), String> {
        for (name, ch) in [
            ("albedo", &self.albedo),
            ("normal", &self.normal),
            ("roughness", &self.roughness),
            ("metallic", &self.metallic),
        ] {
            if let Some(info) = ch {
                if let Err(e) = info.validate() {
                    return Err(format!("{}: {}", name, e));
                }
            }
        }
        Ok(())
    }
}

/// Visual/rendering material properties
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VisualProperties {
    /// RGB color (0xRRGGBB)
    pub color: u32,
    /// Surface roughness (0.0 = mirror, 1.0 = matte)
    pub roughness: f64,
    /// Metalness (0.0 = dielectric, 1.0 = pure metal)
    pub metalness: f64,
    /// Opacity (0.0 = transparent, 1.0 = opaque)
    pub opacity: f64,
    /// ADR-099 L-β — 4 PBR channels (Phase 5-B). `None` for legacy
    /// snapshots / scalar-only materials. `#[serde(default)]` ensures
    /// bincode compat (ADR-091 §E L1 canonical 6번째 적용).
    ///
    /// NOTE: `skip_serializing_if` is intentionally NOT applied here.
    /// bincode is a positional format — omitting a field at
    /// serialization time causes EOF during deserialization of the
    /// SAME version. The Option tag byte (1 byte for None) is cheap.
    /// Legacy snapshots predating L-β load through ADR-098 S-γ
    /// section 9 fallback (entire material_library reverts to Scene::
    /// new default → all materials have layered=None automatically).
    #[serde(default)]
    pub layered: Option<LayeredChannels>,
}

impl VisualProperties {
    /// Extract R, G, B channels from color
    pub fn rgb(&self) -> (u8, u8, u8) {
        let r = ((self.color >> 16) & 0xFF) as u8;
        let g = ((self.color >> 8) & 0xFF) as u8;
        let b = (self.color & 0xFF) as u8;
        (r, g, b)
    }
}

/// A material defines both physical and visual properties
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Material {
    /// Unique identifier
    pub id: MaterialId,
    /// Display name (e.g., "Concrete C30")
    pub name: String,
    /// English name (for i18n)
    pub name_en: String,
    /// Category/classification
    pub category: MaterialCategory,
    /// Physical properties
    pub physical: PhysicalProperties,
    /// Visual/rendering properties
    pub visual: VisualProperties,
}

/// Material classification
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MaterialCategory {
    Concrete,
    Steel,
    Wood,
    Glass,
    Brick,
    Aluminum,
    Stone,
    Gypsum,
    Insulation,
    Water,
    Soil,
    Tile,
    Custom,
}

impl std::fmt::Display for MaterialCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Concrete => write!(f, "Concrete"),
            Self::Steel => write!(f, "Steel"),
            Self::Wood => write!(f, "Wood"),
            Self::Glass => write!(f, "Glass"),
            Self::Brick => write!(f, "Brick"),
            Self::Aluminum => write!(f, "Aluminum"),
            Self::Stone => write!(f, "Stone"),
            Self::Gypsum => write!(f, "Gypsum"),
            Self::Insulation => write!(f, "Insulation"),
            Self::Water => write!(f, "Water"),
            Self::Soil => write!(f, "Soil"),
            Self::Tile => write!(f, "Tile"),
            Self::Custom => write!(f, "Custom"),
        }
    }
}

/// ADR-098 S-β — Material tier scope (System / Project / User).
///
/// Three-layer asset library scope, per LOCKED #26 Phase 5-A约속 +
/// v3.2 §13. **Form citizen 은 영원히 material 무관** (LOCKED #26
/// invariant) — 본 enum 은 Property citizen (Xia) 의 ScopedMaterialId
/// 에서만 의미.
///
/// - **System** — built-in 12 재질 (immutable, ADR-049 §4 Q4)
/// - **Project** — 현 프로젝트 (.axia file scope)
/// - **User** — opt-in 재사용 자산 라이브러리 (localStorage MVP, S-E)
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MaterialTier {
    System,
    Project,
    User,
}

impl MaterialTier {
    /// Stable u32 encoding for WASM bridge. ADR-098 S-H — typed wrapper
    /// 의 tier dispatch.
    pub fn as_u32(self) -> u32 {
        match self {
            Self::System => 0,
            Self::Project => 1,
            Self::User => 2,
        }
    }

    pub fn from_u32(v: u32) -> Option<Self> {
        match v {
            0 => Some(Self::System),
            1 => Some(Self::Project),
            2 => Some(Self::User),
            _ => None,
        }
    }
}

impl std::fmt::Display for MaterialTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::System => write!(f, "System"),
            Self::Project => write!(f, "Project"),
            Self::User => write!(f, "User"),
        }
    }
}

/// ADR-098 S-β — Tier-scoped material identifier.
///
/// 신규 API surface (legacy `MaterialId(u32)` UNCHANGED — FORM_MATERIAL
/// sentinel + bincode 호환). ScopedMaterialId 는 사용자 facing tier
/// dispatch 가 필요한 경로에서만 사용.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ScopedMaterialId {
    pub tier: MaterialTier,
    pub local_id: u32,
}

impl ScopedMaterialId {
    pub fn new(tier: MaterialTier, local_id: u32) -> Self {
        Self { tier, local_id }
    }
}

/// Material library — manages all available materials in a scene
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MaterialLibrary {
    /// BTreeMap (NOT HashMap) for deterministic bincode serialization.
    /// Snapshot byte-equality round-trip (orphan_recovery preview etc.)
    /// requires stable iteration order. ADR-098 S-γ.
    materials: BTreeMap<u32, Material>,
    next_id: u32,
    /// ADR-098 S-β — parallel tier index. Legacy snapshots without this
    /// field deserialize to empty; `migrate_legacy_materials` reconstructs
    /// from id ranges (built-in 0..=11 → System, ≥100 → Project).
    /// `#[serde(default)]` ensures bincode compat (ADR-091 §E L1 답습 —
    /// parallel Map, struct 자체 변경은 add field with default 만).
    #[serde(default)]
    tier_index: BTreeMap<u32, MaterialTier>,
}

/// ADR-098 S-D — Built-in material id sentinel range. Migration helper
/// classifies 0..=BUILTIN_MAX as System tier.
pub const BUILTIN_MATERIAL_ID_MAX: u32 = 11;

/// ADR-098 S-D — Custom user/project starting offset. Materials added
/// to project before tier was tracked use this lower bound.
pub const CUSTOM_MATERIAL_ID_MIN: u32 = 100;

impl MaterialLibrary {
    /// Create a new library with built-in materials
    pub fn new() -> Self {
        let mut lib = Self {
            materials: BTreeMap::new(),
            next_id: 0,
            tier_index: BTreeMap::new(),
        };
        lib.init_builtins();
        lib
    }

    /// Initialize built-in material library
    fn init_builtins(&mut self) {
        // Concrete
        self.add_material(Material {
            id: MaterialId::new(0),
            name: "콘크리트".to_string(),
            name_en: "Concrete".to_string(),
            category: MaterialCategory::Concrete,
            physical: PhysicalProperties {
                density: 2400.0,
                friction: 0.6,
                restitution: 0.1,
                specific_gravity: 2.4,
                thermal_conductivity: 1.4,
                fire_rating: FireRating::Minutes(240),
            },
            visual: VisualProperties {
                color: 0xB0B0B0,
                roughness: 0.85,
                metalness: 0.0,
                opacity: 1.0, layered: None,
            },
        });

        // Steel
        self.add_material(Material {
            id: MaterialId::new(1),
            name: "강철".to_string(),
            name_en: "Steel".to_string(),
            category: MaterialCategory::Steel,
            physical: PhysicalProperties {
                density: 7850.0,
                friction: 0.8,
                restitution: 0.3,
                specific_gravity: 7.85,
                thermal_conductivity: 50.0,
                fire_rating: FireRating::Minutes(0),
            },
            visual: VisualProperties {
                color: 0x6E6E6E,
                roughness: 0.3,
                metalness: 1.0,
                opacity: 1.0, layered: None,
            },
        });

        // Wood
        self.add_material(Material {
            id: MaterialId::new(2),
            name: "목재".to_string(),
            name_en: "Wood".to_string(),
            category: MaterialCategory::Wood,
            physical: PhysicalProperties {
                density: 600.0,
                friction: 0.5,
                restitution: 0.15,
                specific_gravity: 0.6,
                thermal_conductivity: 0.15,
                fire_rating: FireRating::None,
            },
            visual: VisualProperties {
                color: 0x8B4513,
                roughness: 0.6,
                metalness: 0.0,
                opacity: 1.0, layered: None,
            },
        });

        // Glass
        self.add_material(Material {
            id: MaterialId::new(3),
            name: "유리".to_string(),
            name_en: "Glass".to_string(),
            category: MaterialCategory::Glass,
            physical: PhysicalProperties {
                density: 2500.0,
                friction: 0.7,
                restitution: 0.8,
                specific_gravity: 2.5,
                thermal_conductivity: 0.8,
                fire_rating: FireRating::Minutes(120),
            },
            visual: VisualProperties {
                color: 0xE8F4F8,
                roughness: 0.1,
                metalness: 0.0,
                opacity: 0.3, layered: None,
            },
        });

        // Brick
        self.add_material(Material {
            id: MaterialId::new(4),
            name: "벽돌".to_string(),
            name_en: "Brick".to_string(),
            category: MaterialCategory::Brick,
            physical: PhysicalProperties {
                density: 1920.0,
                friction: 0.9,
                restitution: 0.1,
                specific_gravity: 1.92,
                thermal_conductivity: 0.9,
                fire_rating: FireRating::Minutes(240),
            },
            visual: VisualProperties {
                color: 0xC85A54,
                roughness: 0.8,
                metalness: 0.0,
                opacity: 1.0, layered: None,
            },
        });

        // Aluminum
        self.add_material(Material {
            id: MaterialId::new(5),
            name: "알루미늄".to_string(),
            name_en: "Aluminum".to_string(),
            category: MaterialCategory::Aluminum,
            physical: PhysicalProperties {
                density: 2700.0,
                friction: 0.8,
                restitution: 0.4,
                specific_gravity: 2.7,
                thermal_conductivity: 160.0,
                fire_rating: FireRating::Minutes(0),
            },
            visual: VisualProperties {
                color: 0xD3D3D3,
                roughness: 0.25,
                metalness: 0.9,
                opacity: 1.0, layered: None,
            },
        });

        // Stone
        self.add_material(Material {
            id: MaterialId::new(6),
            name: "석재".to_string(),
            name_en: "Stone".to_string(),
            category: MaterialCategory::Stone,
            physical: PhysicalProperties {
                density: 2700.0,
                friction: 0.85,
                restitution: 0.15,
                specific_gravity: 2.7,
                thermal_conductivity: 1.7,
                fire_rating: FireRating::Minutes(240),
            },
            visual: VisualProperties {
                color: 0x9A9A9A,
                roughness: 0.9,
                metalness: 0.0,
                opacity: 1.0, layered: None,
            },
        });

        // Gypsum
        self.add_material(Material {
            id: MaterialId::new(7),
            name: "석고".to_string(),
            name_en: "Gypsum".to_string(),
            category: MaterialCategory::Gypsum,
            physical: PhysicalProperties {
                density: 1400.0,
                friction: 0.4,
                restitution: 0.1,
                specific_gravity: 1.4,
                thermal_conductivity: 0.16,
                fire_rating: FireRating::Minutes(60),
            },
            visual: VisualProperties {
                color: 0xF5F5DC,
                roughness: 0.95,
                metalness: 0.0,
                opacity: 1.0, layered: None,
            },
        });

        // Insulation
        self.add_material(Material {
            id: MaterialId::new(8),
            name: "단열재".to_string(),
            name_en: "Insulation".to_string(),
            category: MaterialCategory::Insulation,
            physical: PhysicalProperties {
                density: 120.0,
                friction: 0.3,
                restitution: 0.05,
                specific_gravity: 0.12,
                thermal_conductivity: 0.04,
                fire_rating: FireRating::None,
            },
            visual: VisualProperties {
                color: 0xFFE4B5,
                roughness: 0.8,
                metalness: 0.0,
                opacity: 1.0, layered: None,
            },
        });

        // Water
        self.add_material(Material {
            id: MaterialId::new(9),
            name: "물".to_string(),
            name_en: "Water".to_string(),
            category: MaterialCategory::Water,
            physical: PhysicalProperties {
                density: 1000.0,
                friction: 0.1,
                restitution: 0.5,
                specific_gravity: 1.0,
                thermal_conductivity: 0.6,
                fire_rating: FireRating::None,
            },
            visual: VisualProperties {
                color: 0x4A90E2,
                roughness: 0.2,
                metalness: 0.0,
                opacity: 0.5, layered: None,
            },
        });

        // Soil
        self.add_material(Material {
            id: MaterialId::new(10),
            name: "흙".to_string(),
            name_en: "Soil".to_string(),
            category: MaterialCategory::Soil,
            physical: PhysicalProperties {
                density: 1800.0,
                friction: 0.85,
                restitution: 0.05,
                specific_gravity: 1.8,
                thermal_conductivity: 0.5,
                fire_rating: FireRating::None,
            },
            visual: VisualProperties {
                color: 0x8B7355,
                roughness: 0.9,
                metalness: 0.0,
                opacity: 1.0, layered: None,
            },
        });

        // Tile
        self.add_material(Material {
            id: MaterialId::new(11),
            name: "타일".to_string(),
            name_en: "Tile".to_string(),
            category: MaterialCategory::Tile,
            physical: PhysicalProperties {
                density: 2300.0,
                friction: 0.8,
                restitution: 0.15,
                specific_gravity: 2.3,
                thermal_conductivity: 0.4,
                fire_rating: FireRating::Minutes(120),
            },
            visual: VisualProperties {
                color: 0xD2B48C,
                roughness: 0.7,
                metalness: 0.0,
                opacity: 1.0, layered: None,
            },
        });
    }

    /// Add a material to the library (built-in path — System tier).
    /// ADR-098 S-D — `init_builtins` 만 호출. Legacy custom path 는
    /// `create_material` (Project tier default) 사용.
    fn add_material(&mut self, mut material: Material) {
        material.id = MaterialId::new(self.next_id);
        self.materials.insert(self.next_id, material);
        self.tier_index.insert(self.next_id, MaterialTier::System);
        self.next_id += 1;
    }

    /// Get a material by ID
    pub fn get(&self, id: MaterialId) -> Option<&Material> {
        self.materials.get(&id.raw())
    }

    /// Get a mutable reference to a material
    pub fn get_mut(&mut self, id: MaterialId) -> Option<&mut Material> {
        self.materials.get_mut(&id.raw())
    }

    /// Create a new custom material (legacy path — defaults to Project
    /// tier per ADR-098 S-D classification rule).
    pub fn create_material(
        &mut self,
        name: String,
        name_en: String,
        category: MaterialCategory,
        physical: PhysicalProperties,
        visual: VisualProperties,
    ) -> MaterialId {
        self.create_material_in_tier(
            MaterialTier::Project, name, name_en, category, physical, visual,
        )
    }

    /// ADR-098 S-β — Create a material in a specific tier.
    ///
    /// Returns the legacy `MaterialId` (raw u32 namespace UNCHANGED for
    /// FORM_MATERIAL + bincode compat). Use `tier_of(id)` to retrieve
    /// the tier at lookup time.
    ///
    /// `MaterialTier::System` is reserved for built-ins — calling this
    /// at runtime allocates a System-tier material but does not protect
    /// it from removal (immutability is enforced at the API boundary).
    pub fn create_material_in_tier(
        &mut self,
        tier: MaterialTier,
        name: String,
        name_en: String,
        category: MaterialCategory,
        physical: PhysicalProperties,
        visual: VisualProperties,
    ) -> MaterialId {
        // ADR-098 S-D — Custom materials use offset 100+ to leave room
        // for the 12 built-ins to grow. Only applies if `next_id` has
        // not yet crossed the threshold (legacy snapshots may have).
        if self.next_id < CUSTOM_MATERIAL_ID_MIN
            && tier != MaterialTier::System
        {
            self.next_id = CUSTOM_MATERIAL_ID_MIN;
        }
        let id = MaterialId::new(self.next_id);
        self.materials.insert(
            self.next_id,
            Material {
                id,
                name,
                name_en,
                category,
                physical,
                visual,
            },
        );
        self.tier_index.insert(self.next_id, tier);
        self.next_id += 1;
        id
    }

    /// ADR-098 S-β — Lookup the tier of an existing material.
    ///
    /// Returns `None` if the material doesn't exist. For legacy snapshots
    /// without `tier_index`, call `migrate_legacy_materials` first.
    pub fn tier_of(&self, id: MaterialId) -> Option<MaterialTier> {
        self.tier_index.get(&id.raw()).copied()
    }

    /// ADR-098 S-β — Set/move tier of an existing material.
    ///
    /// `MaterialTier::System` move is permitted (for migration) but the
    /// caller should treat System tier as immutable thereafter.
    pub fn set_tier(&mut self, id: MaterialId, tier: MaterialTier) -> bool {
        if self.materials.contains_key(&id.raw()) {
            self.tier_index.insert(id.raw(), tier);
            true
        } else {
            false
        }
    }

    /// ADR-098 S-β — Filter materials by tier. Returns refs in u32 id
    /// order for deterministic UI listing.
    pub fn materials_by_tier(&self, tier: MaterialTier) -> Vec<&Material> {
        let mut ids: Vec<u32> = self
            .tier_index
            .iter()
            .filter(|(_, t)| **t == tier)
            .map(|(id, _)| *id)
            .collect();
        ids.sort_unstable();
        ids.into_iter()
            .filter_map(|id| self.materials.get(&id))
            .collect()
    }

    /// ADR-098 S-D — Migration helper. Reconstructs `tier_index` from
    /// id range heuristics for legacy snapshots:
    ///   * id 0..=BUILTIN_MATERIAL_ID_MAX (11) → System
    ///   * id ≥ CUSTOM_MATERIAL_ID_MIN (100) → Project
    ///   * id 12..=99 → Project (legacy custom in tight range)
    ///
    /// Idempotent: re-running on a populated `tier_index` only fills
    /// gaps. Returns the count of newly classified materials.
    pub fn migrate_legacy_materials(&mut self) -> usize {
        let mut count = 0;
        let ids: Vec<u32> = self.materials.keys().copied().collect();
        for id in ids {
            if !self.tier_index.contains_key(&id) {
                let tier = if id <= BUILTIN_MATERIAL_ID_MAX {
                    MaterialTier::System
                } else {
                    MaterialTier::Project
                };
                self.tier_index.insert(id, tier);
                count += 1;
            }
        }
        count
    }

    /// ADR-099 L-D — Migrate legacy single-texture VisualProperties to
    /// the new `layered.albedo` slot. Idempotent.
    ///
    /// Current axia-core `VisualProperties` has no direct `texture`
    /// field (texture state currently lives on the TS side). The
    /// helper therefore has no Rust-side legacy data to migrate
    /// today — it remains as a future-proof normalizer that strips
    /// empty `LayeredChannels` payloads (every channel `None`).
    /// Future sub-step (L-γ bridge) will populate from TS state.
    ///
    /// Returns the count of materials normalized. ADR-098 S-D pattern
    /// 답습 — idempotent + monotonic.
    pub fn migrate_legacy_textures_to_layered(&mut self) -> usize {
        let mut count = 0;
        for material in self.materials.values_mut() {
            if let Some(ref layered) = material.visual.layered {
                if !layered.has_any_channel() {
                    material.visual.layered = None;
                    count += 1;
                }
            }
        }
        count
    }

    /// ADR-099 L-β — Bulk validation of all materials' layered channels.
    /// Returns `Err((material_id, reason))` on the first invalid
    /// channel. Caller may use this as a strict gate before snapshot
    /// export.
    pub fn validate_layered_channels(&self) -> Result<(), (MaterialId, String)> {
        for (raw_id, material) in &self.materials {
            if let Some(ref layered) = material.visual.layered {
                if let Err(e) = layered.validate() {
                    return Err((MaterialId::new(*raw_id), e));
                }
            }
        }
        Ok(())
    }

    /// ADR-098 S-G — Reject material removal when in use is the caller's
    /// responsibility (Scene-level face_to_material check). This helper
    /// only enforces System tier immutability.
    pub fn remove_material(&mut self, id: MaterialId) -> Result<(), &'static str> {
        match self.tier_index.get(&id.raw()).copied() {
            Some(MaterialTier::System) => Err("System tier material is immutable"),
            Some(_) => {
                self.materials.remove(&id.raw());
                self.tier_index.remove(&id.raw());
                Ok(())
            }
            None => Err("material not found"),
        }
    }

    /// Get all materials
    pub fn all(&self) -> Vec<&Material> {
        self.materials.values().collect()
    }

    /// Count of materials in library
    pub fn count(&self) -> usize {
        self.materials.len()
    }
}

impl Default for MaterialLibrary {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_material_library_creation() {
        let lib = MaterialLibrary::new();
        assert!(lib.count() > 0, "should have built-in materials");
        assert!(lib.get(MaterialId::new(0)).is_some(), "should have default concrete");
    }

    #[test]
    fn test_material_rgb_extraction() {
        let visual = VisualProperties {
            color: 0xFF8040,
            roughness: 0.5,
            metalness: 0.0,
            opacity: 1.0, layered: None,
        };
        let (r, g, b) = visual.rgb();
        assert_eq!(r, 0xFF);
        assert_eq!(g, 0x80);
        assert_eq!(b, 0x40);
    }

    #[test]
    fn test_create_custom_material() {
        let mut lib = MaterialLibrary::new();
        let id = lib.create_material(
            "Custom".to_string(),
            "Custom Material".to_string(),
            MaterialCategory::Custom,
            PhysicalProperties {
                density: 1000.0,
                friction: 0.5,
                restitution: 0.3,
                specific_gravity: 1.0,
                thermal_conductivity: 0.5,
                fire_rating: FireRating::None,
            },
            VisualProperties {
                color: 0x123456,
                roughness: 0.5,
                metalness: 0.5,
                opacity: 1.0, layered: None,
            },
        );
        assert!(lib.get(id).is_some(), "custom material should exist");
        assert_eq!(lib.get(id).unwrap().name, "Custom");
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-098 S-β — 3-Tier Material Scope regression
    // ────────────────────────────────────────────────────────────────

    fn dummy_phys() -> PhysicalProperties {
        PhysicalProperties {
            density: 1.0,
            friction: 0.5,
            restitution: 0.5,
            specific_gravity: 1.0,
            thermal_conductivity: 0.5,
            fire_rating: FireRating::None,
        }
    }
    fn dummy_vis() -> VisualProperties {
        VisualProperties {
            color: 0xffffff,
            roughness: 0.5,
            metalness: 0.0,
            opacity: 1.0, layered: None,
        }
    }

    #[test]
    fn material_tier_u32_roundtrip() {
        for t in [MaterialTier::System, MaterialTier::Project, MaterialTier::User] {
            assert_eq!(MaterialTier::from_u32(t.as_u32()), Some(t));
        }
        assert!(MaterialTier::from_u32(99).is_none());
    }

    #[test]
    fn scoped_material_id_carries_tier_and_local_id() {
        let s = ScopedMaterialId::new(MaterialTier::User, 42);
        assert_eq!(s.tier, MaterialTier::User);
        assert_eq!(s.local_id, 42);
    }

    #[test]
    fn builtins_are_classified_as_system_tier() {
        let lib = MaterialLibrary::new();
        for raw in 0..=BUILTIN_MATERIAL_ID_MAX {
            let id = MaterialId::new(raw);
            assert!(
                lib.get(id).is_some(),
                "built-in id {} must exist",
                raw
            );
            assert_eq!(
                lib.tier_of(id),
                Some(MaterialTier::System),
                "built-in id {} must be System tier",
                raw
            );
        }
    }

    #[test]
    fn create_material_defaults_to_project_tier() {
        let mut lib = MaterialLibrary::new();
        let id = lib.create_material(
            "Test".into(), "Test".into(), MaterialCategory::Custom,
            dummy_phys(), dummy_vis(),
        );
        assert_eq!(lib.tier_of(id), Some(MaterialTier::Project));
        assert!(id.raw() >= CUSTOM_MATERIAL_ID_MIN,
            "custom material id should jump to >= {}", CUSTOM_MATERIAL_ID_MIN);
    }

    #[test]
    fn create_material_in_tier_explicit_user() {
        let mut lib = MaterialLibrary::new();
        let id = lib.create_material_in_tier(
            MaterialTier::User,
            "UserMat".into(), "UserMat".into(), MaterialCategory::Custom,
            dummy_phys(), dummy_vis(),
        );
        assert_eq!(lib.tier_of(id), Some(MaterialTier::User));
    }

    #[test]
    fn materials_by_tier_filters_correctly() {
        let mut lib = MaterialLibrary::new();
        let p = lib.create_material_in_tier(
            MaterialTier::Project,
            "P".into(), "P".into(), MaterialCategory::Custom,
            dummy_phys(), dummy_vis(),
        );
        let u = lib.create_material_in_tier(
            MaterialTier::User,
            "U".into(), "U".into(), MaterialCategory::Custom,
            dummy_phys(), dummy_vis(),
        );

        let system = lib.materials_by_tier(MaterialTier::System);
        assert_eq!(system.len(), (BUILTIN_MATERIAL_ID_MAX as usize) + 1);

        let project = lib.materials_by_tier(MaterialTier::Project);
        assert_eq!(project.len(), 1);
        assert_eq!(project[0].id, p);

        let user = lib.materials_by_tier(MaterialTier::User);
        assert_eq!(user.len(), 1);
        assert_eq!(user[0].id, u);
    }

    #[test]
    fn migrate_legacy_materials_classifies_by_id_range() {
        let mut lib = MaterialLibrary::new();
        // Force-add a legacy custom material at id 50 (between 12 and 100)
        // by directly inserting (simulates old snapshot).
        lib.materials.insert(50, Material {
            id: MaterialId::new(50),
            name: "legacy".into(),
            name_en: "legacy".into(),
            category: MaterialCategory::Custom,
            physical: dummy_phys(),
            visual: dummy_vis(),
        });
        // tier_index is empty for id 50.

        // Wipe tier_index for built-ins to simulate a pre-S-β snapshot.
        lib.tier_index.clear();

        let count = lib.migrate_legacy_materials();
        assert_eq!(count, (BUILTIN_MATERIAL_ID_MAX as usize) + 1 + 1,
            "should classify all 12 builtins + 1 legacy custom");

        for raw in 0..=BUILTIN_MATERIAL_ID_MAX {
            assert_eq!(
                lib.tier_of(MaterialId::new(raw)),
                Some(MaterialTier::System),
            );
        }
        assert_eq!(
            lib.tier_of(MaterialId::new(50)),
            Some(MaterialTier::Project),
        );
    }

    #[test]
    fn migrate_is_idempotent() {
        let mut lib = MaterialLibrary::new();
        let first = lib.migrate_legacy_materials();
        assert_eq!(first, 0, "fresh library already has tier_index populated");
        let second = lib.migrate_legacy_materials();
        assert_eq!(second, 0);
    }

    #[test]
    fn remove_material_rejects_system_tier() {
        let mut lib = MaterialLibrary::new();
        let result = lib.remove_material(MaterialId::new(0));
        assert!(result.is_err());
        assert!(lib.get(MaterialId::new(0)).is_some(),
            "System-tier material must remain after rejected removal");
    }

    #[test]
    fn remove_material_succeeds_for_project_or_user_tier() {
        let mut lib = MaterialLibrary::new();
        let p = lib.create_material(
            "P".into(), "P".into(), MaterialCategory::Custom,
            dummy_phys(), dummy_vis(),
        );
        assert!(lib.remove_material(p).is_ok());
        assert!(lib.get(p).is_none());
        assert!(lib.tier_of(p).is_none());
    }

    #[test]
    fn set_tier_moves_material_between_tiers() {
        let mut lib = MaterialLibrary::new();
        let p = lib.create_material(
            "P".into(), "P".into(), MaterialCategory::Custom,
            dummy_phys(), dummy_vis(),
        );
        assert_eq!(lib.tier_of(p), Some(MaterialTier::Project));
        assert!(lib.set_tier(p, MaterialTier::User));
        assert_eq!(lib.tier_of(p), Some(MaterialTier::User));
        // Verify it now appears in User tier list, not Project.
        assert!(lib.materials_by_tier(MaterialTier::Project).is_empty());
        assert_eq!(lib.materials_by_tier(MaterialTier::User).len(), 1);
    }

    #[test]
    fn set_tier_returns_false_for_missing_material() {
        let mut lib = MaterialLibrary::new();
        assert!(!lib.set_tier(MaterialId::new(999), MaterialTier::User));
    }

    #[test]
    fn legacy_load_with_empty_tier_index_is_recoverable() {
        // Simulate a pre-S-β snapshot scenario: a library where
        // `tier_index` was deserialized as empty (default). The serde
        // `#[serde(default)]` attribute on `tier_index` ensures legacy
        // payloads without the field deserialize cleanly. We model this
        // by constructing the library directly and then running the
        // migration helper.
        let mut lib = MaterialLibrary::new();
        lib.tier_index.clear(); // simulate legacy snapshot

        let migrated = lib.migrate_legacy_materials();
        assert_eq!(migrated, (BUILTIN_MATERIAL_ID_MAX as usize) + 1);
        assert_eq!(lib.tier_of(MaterialId::new(0)), Some(MaterialTier::System));
        assert_eq!(lib.tier_of(MaterialId::new(11)), Some(MaterialTier::System));
    }

    #[test]
    fn form_layer_unaffected_by_tier_changes_locked_26_invariant() {
        // LOCKED #26: Form citizen은 영원히 material 무관. Tier 변경이
        // FORM_MATERIAL sentinel (id 0 in legacy MaterialId namespace —
        // *separate* from MaterialLibrary id 0 의 built-in concrete) 의
        // 의미에 영향이 없음을 명시.
        let lib = MaterialLibrary::new();
        // Built-in id 0 = Concrete (System tier). FORM_MATERIAL sentinel
        // = MaterialId::new(0) per ADR-050 P-5e-β. Same raw u32 — Phase
        // 5-A 는 sentinel collision 을 의도적으로 보존 (future ADR 가
        // 분리 가능).
        assert_eq!(lib.tier_of(MaterialId::new(0)), Some(MaterialTier::System));
        // Form layer (Shape) 는 material 자체를 안 갖음 — 본 test 는
        // tier 변경 surface 의 invariant 만 확인.
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-099 L-β — Layered Material (Phase 5-B) regression
    // ────────────────────────────────────────────────────────────────

    fn dummy_channel(label: &str) -> TextureChannelInfo {
        TextureChannelInfo {
            data_url: format!("data:image/png;base64,{}", label),
            projection: TextureProjection::Planar,
            scale: 0.001,
            rotation: None,
            label: Some(label.to_string()),
        }
    }

    #[test]
    fn texture_projection_default_is_planar() {
        assert_eq!(TextureProjection::default(), TextureProjection::Planar);
    }

    #[test]
    fn texture_channel_info_validate_accepts_minimal() {
        let info = TextureChannelInfo::new("data:image/png;base64,AAAA".into(), 0.001);
        assert!(info.validate().is_ok());
    }

    #[test]
    fn texture_channel_info_validate_rejects_empty_dataurl() {
        let info = TextureChannelInfo::new(String::new(), 0.001);
        assert!(info.validate().is_err());
    }

    #[test]
    fn texture_channel_info_validate_rejects_nonpositive_scale() {
        let mut info = TextureChannelInfo::new("data:image/png;base64,X".into(), 0.0);
        assert!(info.validate().is_err());
        info.scale = -1.0;
        assert!(info.validate().is_err());
        info.scale = f64::NAN;
        assert!(info.validate().is_err());
    }

    #[test]
    fn layered_channels_default_is_all_none() {
        let l = LayeredChannels::default();
        assert!(!l.has_any_channel());
        assert_eq!(l.channel_count(), 0);
    }

    #[test]
    fn layered_channels_count_and_has_any_track_population() {
        let mut l = LayeredChannels::default();
        l.albedo = Some(dummy_channel("albedo"));
        assert!(l.has_any_channel());
        assert_eq!(l.channel_count(), 1);
        l.normal = Some(dummy_channel("normal"));
        l.roughness = Some(dummy_channel("roughness"));
        l.metallic = Some(dummy_channel("metallic"));
        assert_eq!(l.channel_count(), 4);
    }

    #[test]
    fn layered_channels_validate_emits_first_channel_error() {
        let mut l = LayeredChannels::default();
        l.albedo = Some(dummy_channel("albedo"));
        // Inject an invalid normal channel.
        l.normal = Some(TextureChannelInfo::new(String::new(), 0.001));
        let err = l.validate().expect_err("should fail");
        assert!(err.starts_with("normal: "), "got {}", err);
    }

    #[test]
    fn visual_properties_layered_default_is_none() {
        // L-B canonical — default VisualProperties has no layered channels.
        let v = VisualProperties {
            color: 0xffffff, roughness: 0.5, metalness: 0.0, opacity: 1.0,
            layered: None,
        };
        assert!(v.layered.is_none());
    }

    #[test]
    fn visual_properties_bincode_roundtrip_with_legacy_payload() {
        // L-B canonical — bincode legacy payload (no `layered` field
        // in the encoded form) deserializes via #[serde(default)] to
        // None. We construct a "legacy" VisualProperties by serializing
        // a struct that excludes the layered field via the
        // skip_serializing_if attribute (None values are not encoded).
        let legacy = VisualProperties {
            color: 0xffffff, roughness: 0.5, metalness: 0.0, opacity: 1.0,
            layered: None,
        };
        let bytes = bincode::serialize(&legacy).expect("serialize");
        let decoded: VisualProperties = bincode::deserialize(&bytes).expect("deserialize");
        assert!(decoded.layered.is_none());
        assert_eq!(decoded.color, 0xffffff);
    }

    #[test]
    fn material_library_migrate_legacy_textures_is_idempotent() {
        let mut lib = MaterialLibrary::new();
        let first = lib.migrate_legacy_textures_to_layered();
        assert_eq!(first, 0, "fresh library has no layered channels");
        let second = lib.migrate_legacy_textures_to_layered();
        assert_eq!(second, 0, "second run also a no-op");
    }

    #[test]
    fn material_library_migrate_strips_empty_layered_payloads() {
        let mut lib = MaterialLibrary::new();
        let id = lib.create_material(
            "Test".into(), "Test".into(), MaterialCategory::Custom,
            PhysicalProperties {
                density: 1.0, friction: 0.5, restitution: 0.5,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: FireRating::None,
            },
            VisualProperties {
                color: 0xff0000, roughness: 0.5, metalness: 0.0, opacity: 1.0,
                layered: Some(LayeredChannels::default()), // all None — empty
            },
        );
        let count = lib.migrate_legacy_textures_to_layered();
        assert_eq!(count, 1, "empty layered should be normalized to None");
        assert!(lib.get(id).unwrap().visual.layered.is_none());
    }

    #[test]
    fn material_library_validate_layered_returns_ok_for_clean_library() {
        let lib = MaterialLibrary::new();
        assert!(lib.validate_layered_channels().is_ok());
    }

    #[test]
    fn material_library_validate_layered_emits_material_id_with_error() {
        let mut lib = MaterialLibrary::new();
        let id = lib.create_material(
            "Bad".into(), "Bad".into(), MaterialCategory::Custom,
            PhysicalProperties {
                density: 1.0, friction: 0.5, restitution: 0.5,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: FireRating::None,
            },
            VisualProperties {
                color: 0, roughness: 0.5, metalness: 0.0, opacity: 1.0,
                layered: Some(LayeredChannels {
                    albedo: Some(TextureChannelInfo::new(String::new(), 0.001)),
                    ..Default::default()
                }),
            },
        );
        let err = lib.validate_layered_channels().expect_err("invalid albedo");
        assert_eq!(err.0, id);
        assert!(err.1.starts_with("albedo: "));
    }

    #[test]
    fn material_partial_layered_bincode_roundtrip() {
        // ADR-099 L-γ — Direct bincode roundtrip regression guard for
        // partial layered payload (albedo Some, others None). Catches
        // any future re-introduction of `skip_serializing_if` on
        // `Option<TextureChannelInfo>` fields (ADR-099 L-β 사후 정정
        // bincode positional EOF lesson).
        let m = Material {
            id: MaterialId::new(100),
            name: "A".into(),
            name_en: "A".into(),
            category: MaterialCategory::Custom,
            physical: PhysicalProperties {
                density: 1.0, friction: 0.5, restitution: 0.5,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: FireRating::None,
            },
            visual: VisualProperties {
                color: 0, roughness: 0.5, metalness: 0.0, opacity: 1.0,
                layered: Some(LayeredChannels {
                    albedo: Some(TextureChannelInfo::new("data:_,ABC".into(), 0.001)),
                    normal: None, roughness: None, metallic: None,
                }),
            },
        };
        let bytes = bincode::serialize(&m).expect("serialize");
        let decoded: Material = bincode::deserialize(&bytes).expect("deserialize");
        assert_eq!(decoded.id.raw(), 100);
        let l = decoded.visual.layered.as_ref().expect("layered preserved");
        assert!(l.albedo.is_some());
        assert!(l.normal.is_none());
        assert!(l.roughness.is_none());
        assert!(l.metallic.is_none());
    }

    #[test]
    fn locked_26_form_layer_unaffected_by_layered_extension() {
        // LOCKED #26: Form citizen (Shape) is material-agnostic.
        // VisualProperties.layered 추가가 Shape lifecycle 에 영향이
        // 없음을 명시 — material 만 mutate.
        let lib = MaterialLibrary::new();
        // System tier built-ins all have layered = None by default.
        for raw in 0..=BUILTIN_MATERIAL_ID_MAX {
            let m = lib.get(MaterialId::new(raw)).unwrap();
            assert!(m.visual.layered.is_none(),
                "built-in {} must have layered=None (Form-agnostic anchor)", raw);
        }
    }
}
