//! Material System
//!
//! Manages physical and visual properties of XIA objects.
//! Materials define how geometry manifests in the physical world.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

/// Material library — manages all available materials in a scene
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MaterialLibrary {
    materials: HashMap<u32, Material>,
    next_id: u32,
}

impl MaterialLibrary {
    /// Create a new library with built-in materials
    pub fn new() -> Self {
        let mut lib = Self {
            materials: HashMap::new(),
            next_id: 1,
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
                opacity: 1.0,
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
                opacity: 1.0,
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
                opacity: 1.0,
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
                opacity: 0.3,
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
                opacity: 1.0,
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
                opacity: 1.0,
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
                opacity: 1.0,
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
                opacity: 1.0,
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
                opacity: 1.0,
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
                opacity: 0.5,
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
                opacity: 1.0,
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
                opacity: 1.0,
            },
        });
    }

    /// Add a material to the library
    fn add_material(&mut self, mut material: Material) {
        material.id = MaterialId::new(self.next_id);
        self.materials.insert(self.next_id, material);
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

    /// Create a new custom material
    pub fn create_material(
        &mut self,
        name: String,
        name_en: String,
        category: MaterialCategory,
        physical: PhysicalProperties,
        visual: VisualProperties,
    ) -> MaterialId {
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
        self.next_id += 1;
        id
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
            opacity: 1.0,
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
                opacity: 1.0,
            },
        );
        assert!(lib.get(id).is_some(), "custom material should exist");
        assert_eq!(lib.get(id).unwrap().name, "Custom");
    }
}
