// ADR-042 P27.6 — 8 regression tests for capability policy composition.
// Each test name maps 1:1 to the ADR's regression list — DO NOT rename
// without ADR amendment.

import { describe, it, expect } from 'vitest';
import {
  evaluatePolicy,
  formatDenialReason,
  policyFromEnv,
  validatePolicy,
  suggestCapability,
  isVisibleInToolsList,
  UnknownCapabilityInPolicyError,
  DEFAULT_POLICY,
  type CapabilityPolicy,
} from '../src/policy.js';
import { dispatch } from '../src/dispatcher.js';
import { MemoryAuditSink } from '../src/audit.js';
import type { EngineInstance } from '../src/capabilities/types.js';

const VERSIONS = { engine_version: '0.1.0', schema_version: '1.0.0' };

function mockEngine(): EngineInstance {
  return {
    draw_rect_as_shape: () => 1,
    create_solid_extrude: () => true,
    exportSnapshotStrict: () => new Uint8Array([0x41, 0x58, 0x69, 0x41]),
  };
}

function policy(overrides: Partial<CapabilityPolicy> = {}): CapabilityPolicy {
  return {
    enabled_tiers: overrides.enabled_tiers ?? [0, 1],
    allow_caps: overrides.allow_caps ?? new Set(),
    deny_caps: overrides.deny_caps ?? new Set(),
  };
}

describe('ADR-042 P27 — capability policy composition', () => {
  // ─────────────────────────────────────────────────────────────────
  // P27.6 #1
  // ─────────────────────────────────────────────────────────────────
  describe('policy_default_tier_only_unchanged', () => {
    it('DEFAULT_POLICY allows Tier 0+1 capabilities (ADR-041 default)', () => {
      expect(evaluatePolicy('draw_rect', DEFAULT_POLICY).allowed).toBe(true);
      expect(evaluatePolicy('export_axia', DEFAULT_POLICY).allowed).toBe(true);
      expect(evaluatePolicy('get_scene_summary', DEFAULT_POLICY).allowed).toBe(true);
    });

    it('DEFAULT_POLICY denies Tier 2+ (ADR-041 default)', () => {
      expect(evaluatePolicy('push_pull', DEFAULT_POLICY).allowed).toBe(false);
      expect(evaluatePolicy('erase_face', DEFAULT_POLICY).allowed).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // P27.6 #2
  // ─────────────────────────────────────────────────────────────────
  describe('policy_deny_overrides_tier', () => {
    it('Tier 2 enabled + DENY=[boolean_subtract] denies only that one', () => {
      const p = policy({
        enabled_tiers: [0, 1, 2],
        deny_caps: new Set(['boolean_subtract']),
      });
      expect(evaluatePolicy('boolean_subtract', p).allowed).toBe(false);
      expect(evaluatePolicy('push_pull', p).allowed).toBe(true);
      expect(evaluatePolicy('boolean_union', p).allowed).toBe(true);
    });

    it('denial reason is denied_by_DENY (distinguishable in audit)', () => {
      const p = policy({
        enabled_tiers: [0, 1, 2],
        deny_caps: new Set(['push_pull']),
      });
      const decision = evaluatePolicy('push_pull', p);
      expect(decision.allowed).toBe(false);
      expect(decision.reason?.kind).toBe('denied_by_DENY');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // P27.6 #3
  // ─────────────────────────────────────────────────────────────────
  describe('policy_allow_promotes_capability_above_tier', () => {
    it('Tiers=[0,1] + ALLOW=[push_pull] promotes push_pull (Tier 2)', () => {
      const p = policy({
        enabled_tiers: [0, 1],
        allow_caps: new Set(['push_pull']),
      });
      expect(evaluatePolicy('push_pull', p).allowed).toBe(true);
    });

    it('promoted capability runs through dispatcher', async () => {
      const sink = new MemoryAuditSink();
      const result = await dispatch(
        'push_pull',
        { face_id: 1, distance: 10 },
        {
          engine: mockEngine(),
          policy: policy({
            enabled_tiers: [0, 1],
            allow_caps: new Set(['push_pull']),
          }),
          auditSink: sink,
          versions: VERSIONS,
        },
      );
      expect(result.output).toEqual({ success: true });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // P27.6 #4 — exhaustive whitelist via empty TIERS
  // ─────────────────────────────────────────────────────────────────
  describe('policy_exhaustive_whitelist_via_empty_tiers', () => {
    it('TIERS=∅ + ALLOW=[draw_rect] → only draw_rect activates', () => {
      const p = policy({
        enabled_tiers: [], // no tier defaults
        allow_caps: new Set(['draw_rect']),
      });
      expect(evaluatePolicy('draw_rect', p).allowed).toBe(true);
      expect(evaluatePolicy('draw_circle', p).allowed).toBe(false);
      expect(evaluatePolicy('export_axia', p).allowed).toBe(false);
    });

    it('additive semantics — ALLOW does NOT shrink tier surface', () => {
      // Surprising-to-naive-users: ALLOW=[push_pull] does NOT mean
      // "only push_pull". To get exhaustive, use TIERS=∅.
      const p = policy({
        enabled_tiers: [0, 1],
        allow_caps: new Set(['push_pull']),
      });
      expect(evaluatePolicy('draw_rect', p).allowed).toBe(true);
      expect(evaluatePolicy('draw_circle', p).allowed).toBe(true);
      expect(evaluatePolicy('push_pull', p).allowed).toBe(true);
    });

    it('denial reason when both tier off and not in ALLOW', () => {
      const p = policy({
        enabled_tiers: [],
        allow_caps: new Set(['draw_rect']),
      });
      const decision = evaluatePolicy('draw_circle', p);
      expect(decision.reason?.kind).toBe('tier_disabled_no_allow');
      if (decision.reason?.kind === 'tier_disabled_no_allow') {
        expect(decision.reason.allow_caps).toEqual(['draw_rect']);
        expect(decision.reason.enabled_tiers).toEqual([]);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // P27.6 #5
  // ─────────────────────────────────────────────────────────────────
  describe('policy_deny_wins_over_allow', () => {
    it('cap in both ALLOW and DENY → denied (DENY wins, fail-closed)', () => {
      const p = policy({
        enabled_tiers: [0, 1, 2, 3],
        allow_caps: new Set(['push_pull']),
        deny_caps: new Set(['push_pull']),
      });
      const decision = evaluatePolicy('push_pull', p);
      expect(decision.allowed).toBe(false);
      expect(decision.reason?.kind).toBe('denied_by_DENY');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // P27.6 #6
  // ─────────────────────────────────────────────────────────────────
  describe('policy_unknown_capability_fatal_with_hint', () => {
    it('unknown name in ALLOW → fatal with "Did you mean" hint', () => {
      const bad: CapabilityPolicy = {
        enabled_tiers: [0, 1],
        allow_caps: new Set(['draw_recttt']),
        deny_caps: new Set(),
      };
      try {
        validatePolicy(bad);
        throw new Error('unreachable');
      } catch (e) {
        expect(e).toBeInstanceOf(UnknownCapabilityInPolicyError);
        const err = e as UnknownCapabilityInPolicyError;
        expect(err.source).toBe('AXIA_MCP_ALLOW_CAPS');
        expect(err.bad_name).toBe('draw_recttt');
        expect(err.suggestion).toBe('draw_rect');
      }
    });

    it('unknown name in DENY also fatals', () => {
      const bad: CapabilityPolicy = {
        enabled_tiers: [0, 1],
        allow_caps: new Set(),
        deny_caps: new Set(['no_such_cap']),
      };
      expect(() => validatePolicy(bad)).toThrow(UnknownCapabilityInPolicyError);
    });

    it('suggestCapability returns null for unrecoverable typos', () => {
      // 모든 capability 와 levenshtein > 2 인 문자열
      expect(suggestCapability('xyzabcdef')).toBeNull();
    });

    it('suggestCapability matches close typos', () => {
      expect(suggestCapability('draw_recct')).toBe('draw_rect');
      expect(suggestCapability('puxh_pull')).toBe('push_pull');
    });

    it('policyFromEnv throws on bad env value', () => {
      expect(() =>
        policyFromEnv({
          AXIA_MCP_TIERS: '0,1',
          AXIA_MCP_DENY_CAPS: 'totally_invalid',
        }),
      ).toThrow(UnknownCapabilityInPolicyError);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // P27.6 #7
  // ─────────────────────────────────────────────────────────────────
  describe('policy_audit_reason_distinguishes_layer', () => {
    it('three reason kinds map to distinct strings', () => {
      const denied = formatDenialReason({ kind: 'denied_by_DENY' });
      const tierOffEmptyAllow = formatDenialReason({
        kind: 'tier_disabled_no_allow',
        tier: 2,
        enabled_tiers: [0, 1],
        allow_caps: [],
      });
      const tierOffWithAllow = formatDenialReason({
        kind: 'tier_disabled_no_allow',
        tier: 2,
        enabled_tiers: [0, 1],
        allow_caps: ['draw_rect'],
      });
      const unknown = formatDenialReason({ kind: 'unknown' });

      expect(denied).toMatch(/DENY/);
      expect(tierOffEmptyAllow).toMatch(/ALLOW is empty/);
      expect(tierOffWithAllow).toMatch(/draw_rect/);
      expect(unknown).toMatch(/Unknown capability/);
      // All four messages must be distinguishable
      expect(
        new Set([denied, tierOffEmptyAllow, tierOffWithAllow, unknown]).size,
      ).toBe(4);
    });

    it('audit log records the layered reason on dispatch denial', async () => {
      const sink = new MemoryAuditSink();
      const p = policy({
        enabled_tiers: [0, 1, 2],
        deny_caps: new Set(['push_pull']),
      });
      await expect(
        dispatch(
          'push_pull',
          { face_id: 1, distance: 5 },
          {
            engine: mockEngine(),
            policy: p,
            auditSink: sink,
            versions: VERSIONS,
          },
        ),
      ).rejects.toThrow();
      await Promise.resolve();
      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0]!.result).toBe('denied');
      expect(sink.entries[0]!.reason).toMatch(/DENY/);
    });

    it('exhaustive-whitelist denial reaches audit with tier_disabled_no_allow reason', async () => {
      const sink = new MemoryAuditSink();
      await expect(
        dispatch(
          'draw_circle',
          { center: [0, 0, 0], radius: 5 },
          {
            engine: mockEngine(),
            policy: policy({
              enabled_tiers: [], // exhaustive whitelist mode
              allow_caps: new Set(['draw_rect']),
            }),
            auditSink: sink,
            versions: VERSIONS,
          },
        ),
      ).rejects.toThrow();
      await Promise.resolve();
      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0]!.reason).toMatch(/Tier 1 not enabled/);
      expect(sink.entries[0]!.reason).toMatch(/draw_rect/);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // P27.6 #8
  // ─────────────────────────────────────────────────────────────────
  describe('policy_tools_list_reflects_actual_enablement', () => {
    it('isVisibleInToolsList = evaluatePolicy().allowed (additive)', () => {
      const p = policy({
        enabled_tiers: [0, 1],
        allow_caps: new Set(['push_pull']),
        deny_caps: new Set(['draw_circle']),
      });
      // Tier 1 default → visible (additive — not affected by ALLOW)
      expect(isVisibleInToolsList('draw_rect', p)).toBe(true);
      // Tier 1 but DENY → not visible (subtractive)
      expect(isVisibleInToolsList('draw_circle', p)).toBe(false);
      // Tier 2 promoted via ALLOW → visible (additive)
      expect(isVisibleInToolsList('push_pull', p)).toBe(true);
      // Tier 2 not promoted → not visible
      expect(isVisibleInToolsList('boolean_union', p)).toBe(false);
    });
  });
});

describe('ADR-042 P27.2 — env var parsing', () => {
  it('empty env → DEFAULT_POLICY equivalent', () => {
    const p = policyFromEnv({});
    expect(p.enabled_tiers).toEqual([0, 1]);
    expect(p.allow_caps.size).toBe(0);
    expect(p.deny_caps.size).toBe(0);
  });

  it('AXIA_MCP_DENY_CAPS comma-separated', () => {
    const p = policyFromEnv({
      AXIA_MCP_TIERS: '0,1,2',
      AXIA_MCP_DENY_CAPS: 'boolean_subtract,boolean_union',
    });
    expect([...p.deny_caps].sort()).toEqual(['boolean_subtract', 'boolean_union']);
  });

  it('AXIA_MCP_ALLOW_CAPS comma-separated', () => {
    const p = policyFromEnv({
      AXIA_MCP_ALLOW_CAPS: 'draw_rect,push_pull',
    });
    expect([...p.allow_caps].sort()).toEqual(['draw_rect', 'push_pull']);
  });

  it('whitespace tolerated in env values', () => {
    const p = policyFromEnv({
      AXIA_MCP_DENY_CAPS: ' push_pull , delete_xia ',
    });
    expect(p.deny_caps.has('push_pull')).toBe(true);
    expect(p.deny_caps.has('delete_xia')).toBe(true);
  });
});
