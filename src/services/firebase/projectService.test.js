import { describe, it, expect } from 'vitest';
import { sanitizeUpdatePatch } from './projectService';
import { createBlankProject } from '../../data/mockProjects';

// Sprint FT-9A Section 14: pure-logic unit tests only. These do NOT touch
// Firestore -- they test the same sanitization/shaping functions the real
// Firestore read/write path calls, in isolation. Real Firebase
// read/write/persistence behavior is explicitly NOT covered by these
// tests -- see the final report's "Real Firebase Verification" section.

describe('sanitizeUpdatePatch (Section 6 & 10: createdAt preservation, targeted update)', () => {
  it('strips id, projectId, createdAt, and updatedAt from the patch', () => {
    const patch = { id: 'x', projectId: 'x', createdAt: 'should-not-survive', updatedAt: 'should-not-survive', status: 'Execution' };
    const result = sanitizeUpdatePatch(patch);
    expect(result).toEqual({ status: 'Execution' });
  });

  it('createdAt can never be overwritten via an update patch, even if maliciously/accidentally included', () => {
    const result = sanitizeUpdatePatch({ createdAt: '2020-01-01', projectName: 'Renamed' });
    expect(result.createdAt).toBeUndefined();
    expect(result.projectName).toBe('Renamed');
  });

  it('drops undefined field values (Firestore updateDoc throws on undefined)', () => {
    const result = sanitizeUpdatePatch({ status: 'Execution', description: undefined });
    expect(result).toEqual({ status: 'Execution' });
    expect('description' in result).toBe(false);
  });

  it('preserves every other field untouched -- a targeted update never silently drops unrelated data', () => {
    const patch = { projectName: 'New Name', client: 'New Client', capacity: 50 };
    expect(sanitizeUpdatePatch(patch)).toEqual(patch);
  });

  it('handles an empty patch safely', () => {
    expect(sanitizeUpdatePatch({})).toEqual({});
  });

  it('handles a null/undefined patch safely without throwing', () => {
    expect(sanitizeUpdatePatch(null)).toEqual({});
    expect(sanitizeUpdatePatch(undefined)).toEqual({});
  });
});

describe('createBlankProject (Section 5: project ID generation, shared by LOCAL and FIREBASE mode)', () => {
  it('generates a non-empty, unique id for a new project', () => {
    const a = createBlankProject({ projectName: 'A' });
    const b = createBlankProject({ projectName: 'B' });
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it('never generates a display-name-based or predictable sequential id', () => {
    const p = createBlankProject({ projectName: 'Test Project' });
    expect(p.id.toLowerCase()).not.toContain('test');
    expect(p.id.toLowerCase()).not.toContain('project');
  });

  it('applies sensible operational defaults for a brand-new project', () => {
    const p = createBlankProject({ projectName: 'New Plant', projectManager: 'Andi Wijaya' });
    expect(p.progress).toBe(0);
    expect(p.openIssues).toBe(0);
    expect(p.healthStatus).toBe('Good');
  });

  it('does not overwrite explicitly provided form values with defaults', () => {
    const p = createBlankProject({ projectName: 'Custom', status: 'Execution' });
    expect(p.status).toBe('Execution');
    expect(p.projectName).toBe('Custom');
  });
});
