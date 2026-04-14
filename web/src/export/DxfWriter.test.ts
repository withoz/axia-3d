import { describe, it, expect, beforeEach } from 'vitest';
import { DxfWriter } from './DxfWriter';

describe('DxfWriter', () => {
  let writer: DxfWriter;

  beforeEach(() => {
    writer = new DxfWriter();
  });

  describe('empty export', () => {
    it('produces valid DXF with HEADER/TABLES/ENTITIES/EOF', () => {
      const dxf = writer.export();
      expect(dxf).toContain('SECTION');
      expect(dxf).toContain('HEADER');
      expect(dxf).toContain('TABLES');
      expect(dxf).toContain('ENTITIES');
      expect(dxf).toContain('ENDSEC');
      expect(dxf).toContain('EOF');
    });

    it('contains AutoCAD version marker', () => {
      const dxf = writer.export();
      expect(dxf).toContain('$ACADVER');
      expect(dxf).toContain('AC1015');
    });
  });

  describe('addLine', () => {
    it('adds a LINE entity to output', () => {
      writer.addLine({ x: 0, y: 0 }, { x: 100, y: 100 });
      const dxf = writer.export();
      expect(dxf).toContain('LINE');
    });

    it('supports chaining', () => {
      const result = writer
        .addLine({ x: 0, y: 0 }, { x: 10, y: 10 })
        .addLine({ x: 10, y: 10 }, { x: 20, y: 0 });
      expect(result).toBe(writer);
    });

    it('uses custom layer', () => {
      writer.addLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { layer: 'MyLayer' });
      const dxf = writer.export();
      expect(dxf).toContain('MyLayer');
    });

    it('includes start and end coordinates', () => {
      writer.addLine({ x: 10, y: 20, z: 30 }, { x: 40, y: 50, z: 60 });
      const dxf = writer.export();
      // DXF uses group codes 10,20,30 for start and 11,21,31 for end
      expect(dxf).toContain('10');
      expect(dxf).toContain('20');
    });
  });

  describe('addCircle', () => {
    it('adds a CIRCLE entity', () => {
      writer.addCircle({ x: 50, y: 50 }, 25);
      const dxf = writer.export();
      expect(dxf).toContain('CIRCLE');
    });

    it('rejects zero radius', () => {
      writer.addCircle({ x: 0, y: 0 }, 0);
      const dxf = writer.export();
      expect(dxf).not.toContain('CIRCLE');
    });

    it('rejects negative radius', () => {
      writer.addCircle({ x: 0, y: 0 }, -5);
      const dxf = writer.export();
      expect(dxf).not.toContain('CIRCLE');
    });
  });

  describe('addArc', () => {
    it('adds an ARC entity', () => {
      writer.addArc({ x: 0, y: 0 }, 10, 0, 90);
      const dxf = writer.export();
      expect(dxf).toContain('ARC');
    });

    it('rejects zero radius', () => {
      writer.addArc({ x: 0, y: 0 }, 0, 0, 90);
      const dxf = writer.export();
      expect(dxf).not.toContain('ARC');
    });
  });

  describe('addPolyline', () => {
    it('adds an LWPOLYLINE entity', () => {
      writer.addPolyline([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]);
      const dxf = writer.export();
      expect(dxf).toContain('LWPOLYLINE');
    });

    it('rejects polyline with fewer than 2 points', () => {
      writer.addPolyline([{ x: 0, y: 0 }]);
      const dxf = writer.export();
      expect(dxf).not.toContain('LWPOLYLINE');
    });

    it('supports closed polyline', () => {
      writer.addPolyline(
        [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        { closed: true },
      );
      const dxf = writer.export();
      expect(dxf).toContain('LWPOLYLINE');
    });
  });

  describe('addFace', () => {
    it('adds a 3DFACE entity for 3 vertices', () => {
      writer.addFace([
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 5, y: 10, z: 0 },
      ]);
      const dxf = writer.export();
      expect(dxf).toContain('FACE');
    });

    it('adds a 3DFACE entity for 4 vertices (quad)', () => {
      writer.addFace([
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 10, z: 0 },
        { x: 0, y: 10, z: 0 },
      ]);
      const dxf = writer.export();
      expect(dxf).toContain('FACE');
    });

    it('rejects face with fewer than 3 vertices', () => {
      writer.addFace([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
      const dxf = writer.export();
      expect(dxf).not.toContain('FACE');
    });

    it('rejects face with more than 4 vertices', () => {
      writer.addFace([
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 },
        { x: 0, y: 1 }, { x: 0.5, y: 0.5 },
      ]);
      const dxf = writer.export();
      expect(dxf).not.toContain('FACE');
    });
  });

  describe('clear', () => {
    it('removes all entities', () => {
      writer.addLine({ x: 0, y: 0 }, { x: 1, y: 1 });
      writer.addCircle({ x: 0, y: 0 }, 5);
      writer.clear();
      const dxf = writer.export();
      expect(dxf).not.toContain('LINE');
      expect(dxf).not.toContain('CIRCLE');
    });

    it('supports chaining after clear', () => {
      const result = writer.clear().addLine({ x: 0, y: 0 }, { x: 1, y: 1 });
      expect(result).toBe(writer);
    });
  });

  describe('layers', () => {
    it('default layer entries are included', () => {
      writer.addLine({ x: 0, y: 0 }, { x: 1, y: 1 });
      const dxf = writer.export();
      expect(dxf).toContain('LAYER');
      expect(dxf).toContain('Default');
    });

    it('multiple layers are registered', () => {
      writer.addLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { layer: 'Layer1' });
      writer.addCircle({ x: 0, y: 0 }, 5, { layer: 'Layer2' });
      const dxf = writer.export();
      expect(dxf).toContain('Layer1');
      expect(dxf).toContain('Layer2');
    });
  });

  describe('bounds calculation', () => {
    it('header contains EXTMIN/EXTMAX', () => {
      writer.addLine({ x: -10, y: -20, z: -30 }, { x: 100, y: 200, z: 300 });
      const dxf = writer.export();
      expect(dxf).toContain('$EXTMIN');
      expect(dxf).toContain('$EXTMAX');
    });
  });

  describe('mixed entities', () => {
    it('exports all entity types together', () => {
      writer
        .addLine({ x: 0, y: 0 }, { x: 10, y: 10 })
        .addCircle({ x: 5, y: 5 }, 3)
        .addArc({ x: 0, y: 0 }, 10, 0, 180)
        .addPolyline([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }])
        .addFace([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);

      const dxf = writer.export();
      expect(dxf).toContain('LINE');
      expect(dxf).toContain('CIRCLE');
      expect(dxf).toContain('ARC');
      expect(dxf).toContain('LWPOLYLINE');
      expect(dxf).toContain('FACE');
      expect(dxf).toContain('EOF');
    });
  });
});
