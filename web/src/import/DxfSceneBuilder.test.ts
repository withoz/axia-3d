import { describe, it, expect } from 'vitest';
import { DxfSceneBuilder, type DxfDocument } from './DxfSceneBuilder';

function makeDoc(over: Partial<DxfDocument>): DxfDocument {
  return {
    header: {},
    tables: { layers: {} },
    blocks: [],
    entities: [],
    ...over,
  };
}

describe('DxfSceneBuilder', () => {
  it('creates "0" layer group even when document has no layers', () => {
    const builder = new DxfSceneBuilder();
    const r = builder.build(makeDoc({}), 'empty.dxf');
    expect(r.stats.layers).toBeGreaterThanOrEqual(1);
    const group0 = r.group.children.find((c: any) => c.name === 'layer:0');
    expect(group0).toBeDefined();
    expect(r.stats.entities).toBe(0);
  });

  it('routes entities to their layer group', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      tables: {
        layers: {
          'Walls': { name: 'Walls', colorNumber: 5 },
          'Roof':  { name: 'Roof',  colorNumber: 3 },
        },
      },
      entities: [
        { type: 'LINE', layer: 'Walls', start: { x: 0, y: 0, z: 0 }, end: { x: 100, y: 0, z: 0 } },
        { type: 'LINE', layer: 'Roof',  start: { x: 0, y: 100, z: 0 }, end: { x: 100, y: 100, z: 0 } },
      ],
    });
    const r = builder.build(doc, 'two-layers.dxf');
    expect(r.stats.layers).toBe(3); // 0, Walls, Roof
    expect(r.stats.entities).toBe(2);
    const walls = r.group.children.find((c: any) => c.name === 'layer:Walls') as any;
    const roof = r.group.children.find((c: any) => c.name === 'layer:Roof') as any;
    expect(walls.children.length).toBe(1);
    expect(roof.children.length).toBe(1);
  });

  it('preserves layer color in userData', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      tables: { layers: { 'Walls': { name: 'Walls', colorNumber: 5, flags: 0 } } },
    });
    const r = builder.build(doc, 'color.dxf');
    const walls = r.group.children.find((c: any) => c.name === 'layer:Walls') as any;
    expect(walls.userData.layer.colorNumber).toBe(5);
  });

  it('hides frozen layers (flags & 1)', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      tables: {
        layers: {
          'Hidden': { name: 'Hidden', colorNumber: 1, flags: 1 }, // bit 0 = frozen
          'Shown':  { name: 'Shown',  colorNumber: 2, flags: 0 },
        },
      },
    });
    const r = builder.build(doc, 'visibility.dxf');
    const hidden = r.group.children.find((c: any) => c.name === 'layer:Hidden') as any;
    const shown = r.group.children.find((c: any) => c.name === 'layer:Shown') as any;
    expect(hidden.visible).toBe(false);
    expect(shown.visible).toBe(true);
  });

  it('builds block templates from BLOCKS section', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      blocks: [
        {
          name: 'door-A',
          x: 0, y: 0, z: 0,
          entities: [
            { type: 'LINE', start: { x: 0, y: 0, z: 0 }, end: { x: 100, y: 0, z: 0 } },
          ],
        },
      ],
      entities: [],
    });
    const r = builder.build(doc, 'block-def.dxf');
    expect(r.stats.blocks).toBe(1);
  });

  it('instantiates a BLOCK via INSERT entity with translation', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      blocks: [
        {
          name: 'door-A',
          x: 0, y: 0, z: 0,
          entities: [
            { type: 'LINE', start: { x: 0, y: 0, z: 0 }, end: { x: 100, y: 0, z: 0 } },
          ],
        },
      ],
      entities: [
        { type: 'INSERT', block: 'door-A', layer: '0', x: 500, y: 1000, z: 0 },
      ],
    });
    const r = builder.build(doc, 'insert.dxf');
    expect(r.stats.inserts).toBe(1);
    expect(r.stats.entities).toBe(1);
    const layer0 = r.group.children.find((c: any) => c.name === 'layer:0') as any;
    const insert = layer0.children.find((c: any) => c.name === 'insert:door-A') as any;
    expect(insert).toBeDefined();
    expect(insert.userData.insert.x).toBe(500);
    expect(insert.userData.insert.y).toBe(1000);
    // INSERT should contain a wrapper Group (with row/col layout) → child clone of template.
    expect(insert.children.length).toBeGreaterThan(0);
  });

  it('handles row/column array INSERT', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      blocks: [
        { name: 'tile', x: 0, y: 0, z: 0,
          entities: [{ type: 'LINE', start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } }] },
      ],
      entities: [
        { type: 'INSERT', block: 'tile', layer: '0',
          x: 0, y: 0, z: 0,
          rowCount: 3, columnCount: 4,
          rowSpacing: 100, columnSpacing: 100 },
      ],
    });
    const r = builder.build(doc, 'array.dxf');
    const layer0 = r.group.children.find((c: any) => c.name === 'layer:0') as any;
    const insert = layer0.children.find((c: any) => c.name === 'insert:tile') as any;
    expect(insert.children.length).toBe(12); // 3 × 4
  });

  it('supports CIRCLE / ARC / POINT / ELLIPSE / SPLINE / POLYLINE entities', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      entities: [
        { type: 'CIRCLE', layer: '0', x: 0, y: 0, z: 0, r: 50 },
        { type: 'ARC',    layer: '0', x: 0, y: 0, z: 0, r: 100, startAngle: 0, endAngle: 90 },
        { type: 'POINT',  layer: '0', x: 5, y: 5, z: 0 },
        { type: 'ELLIPSE',layer: '0', x: 0, y: 0, z: 0, majorX: 50, majorY: 0, majorZ: 0, axisRatio: 0.5, startAngle: 0, endAngle: Math.PI * 2 },
        { type: 'SPLINE', layer: '0', controlPoints: [
          { x: 0, y: 0, z: 0 }, { x: 50, y: 100, z: 0 }, { x: 100, y: 0, z: 0 },
        ]},
        { type: 'LWPOLYLINE', layer: '0', vertices: [
          { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
        ], closed: true },
      ],
    });
    const r = builder.build(doc, 'mixed.dxf');
    expect(r.stats.entities).toBe(6);
    expect(r.stats.skipped).toBe(0);
  });

  it('warns on unsupported entity types but does not throw', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      entities: [
        { type: 'SUNLIGHT_RAY_QUUX', layer: '0' },
      ],
    });
    const r = builder.build(doc, 'unknown.dxf');
    expect(r.stats.skipped).toBe(1);
    expect(r.stats.warnings.length).toBeGreaterThan(0);
    expect(r.stats.warnings[0]).toContain('SUNLIGHT_RAY_QUUX');
  });

  it('falls back to color BYLAYER when entity has no explicit color', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      tables: { layers: { 'Walls': { name: 'Walls', colorNumber: 1 /* red */ } } },
      entities: [
        { type: 'LINE', layer: 'Walls', start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
      ],
    });
    const r = builder.build(doc, 'color-bylayer.dxf');
    const walls = r.group.children.find((c: any) => c.name === 'layer:Walls') as any;
    const line = walls.children[0];
    // Material color should be red (0xff0000).
    expect(line.material.color.getHex()).toBe(0xff0000);
  });

  it('entity-specific colorNumber wins over layer color', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      tables: { layers: { 'Walls': { name: 'Walls', colorNumber: 1 } } }, // red
      entities: [
        { type: 'LINE', layer: 'Walls', colorNumber: 3, // entity-green wins
          start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
      ],
    });
    const r = builder.build(doc, 'color-override.dxf');
    const walls = r.group.children.find((c: any) => c.name === 'layer:Walls') as any;
    const line = walls.children[0];
    expect(line.material.color.getHex()).toBe(0x00ff00);
  });

  it('attaches entity userData with type/handle/layer', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      entities: [
        { type: 'LINE', layer: '0', handle: 'AABB', start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
      ],
    });
    const r = builder.build(doc, 'meta.dxf');
    const layer0 = r.group.children.find((c: any) => c.name === 'layer:0') as any;
    const line = layer0.children[0];
    expect(line.userData.entity.type).toBe('LINE');
    expect(line.userData.entity.handle).toBe('AABB');
    expect(line.userData.entity.layer).toBe('0');
  });

  it('creates layer on the fly if entity references undeclared layer', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      tables: { layers: {} }, // no layers declared
      entities: [
        { type: 'LINE', layer: 'Phantom', start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
      ],
    });
    const r = builder.build(doc, 'auto.dxf');
    const phantom = r.group.children.find((c: any) => c.name === 'layer:Phantom') as any;
    expect(phantom).toBeDefined();
    expect(phantom.children.length).toBe(1);
  });

  it('warns and skips INSERT referencing unknown block', () => {
    const builder = new DxfSceneBuilder();
    const doc = makeDoc({
      blocks: [],
      entities: [{ type: 'INSERT', block: 'ghost', layer: '0', x: 0, y: 0, z: 0 }],
    });
    const r = builder.build(doc, 'orphan-insert.dxf');
    expect(r.stats.skipped).toBe(1);
    expect(r.stats.warnings.some(w => w.includes('ghost'))).toBe(true);
  });
});
