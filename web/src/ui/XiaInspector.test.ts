/**
 * ADR-050 P-6 — XiaInspector badge label regression.
 *
 * Source-inspection level test (no Three.js / DOM rendering required).
 * Verifies that the XiaInspector module + index.html template carry the
 * correct ADR-049 §4 Q3 form/property labels:
 *   - "형태 (Shape)" for the no-material (form layer) state
 *   - "XIA (특성)" for the with-material (property layer) state
 * and that the deprecated "Appearance" / "XIA (물체)" / "XIA(물체)"
 * labels are no longer present.
 *
 * Drift guard — if anyone re-introduces the old labels, this test
 * fails fast.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('ADR-050 P-6 — XiaInspector badge labels', () => {
  it('XiaInspector.ts uses the new form/property label strings', () => {
    const file = path.resolve(__dirname, 'XiaInspector.ts');
    const src = fs.readFileSync(file, 'utf-8');

    // P-6 new labels present.
    expect(src).toContain("'형태 (Shape)'");
    expect(src).toContain("'XIA (특성)'");

    // Old labels removed.
    expect(src).not.toContain("'Appearance'");
    expect(src).not.toContain("'XIA (물체)'");
    expect(src).not.toContain("'XIA(물체)'");
  });

  it('index.html template carries P-6 labels (no remnant Appearance)', () => {
    // The Inspector is initialized with the form-state default.
    const file = path.resolve(__dirname, '..', '..', 'index.html');
    const src = fs.readFileSync(file, 'utf-8');

    // Initial badge text in xi-phys-badge must match form-state.
    expect(src).toContain('형태 (Shape)');
    // Hint message references property layer ("XIA (특성)").
    expect(src).toContain('XIA (특성)');
    // Old labels removed from template.
    expect(src).not.toContain('Appearance');
    expect(src).not.toContain('XIA(물체)');
  });
});
