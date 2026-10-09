import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getNavItemsForRole } from '../../constants/nav';
import { ROLES } from '../../constants/roles';

// SECURITY POLICY TESTS -- firestore.rules audit (MP#5 corrective).
//
// WHAT THIS FILE IS, honestly: it reads firestore.rules and the client source
// as TEXT and asserts on their structure. It proves the rules are WRITTEN as
// the policy requires and that the client's queries are CONSISTENT with them.
// It does NOT prove Firestore enforces the rules at runtime -- only the
// Emulator can (tests/rules/securityPolicy.emu.mjs, which was written but
// could not be executed where it was authored). Never read a pass here as
// "Firestore Rules verified".
const RULES = fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
const SRC_DIR = new URL('../../', import.meta.url);

const stripComments = (t) => t.split('\n').map((l) => l.replace(/\s*\/\/.*$/, '')).filter((l) => l.trim()).join('\n');
const CODE = stripComments(RULES);

// Text of a match block, found by brace matching from `marker` (which must end with the block's opening '{').
function block(marker, text = CODE) {
  const i = text.indexOf(marker);
  if (i < 0) throw new Error(`rules block not found: ${marker}`);
  let depth = 0;
  for (let j = i + marker.length - 1; j < text.length; j += 1) {
    if (text[j] === '{') depth += 1;
    if (text[j] === '}') { depth -= 1; if (depth === 0) return text.slice(i, j + 1); }
  }
  throw new Error(`unbalanced block: ${marker}`);
}
// allow statements -> [{ ops: ['create','update'], cond: '...' }]
function allows(text) {
  return [...text.matchAll(/allow\s+([a-z, ]+?):\s*if\s+([\s\S]*?);/g)].map((m) => ({ ops: m[1].split(',').map((o) => o.trim()), cond: m[2] }));
}
const WRITE_OPS = ['write', 'create', 'update', 'delete'];
const isWrite = (a) => a.ops.some((o) => WRITE_OPS.includes(o));
const isRead = (a) => a.ops.some((o) => ['read', 'get', 'list'].includes(o));

const NESTED = {
  assignments: 'match /projectAssignments/{assignmentId} {',
  progressHistory: 'match /progressHistory/{snapshotId} {',
  engineering: 'match /engineeringDocuments/{docId} {',
  hse: 'match /hseItems/{itemId} {',
  procurement: 'match /procurementMilestones/{milestoneId} {',
  construction: 'match /constructionActivities/{activityId} {',
  commissioning: 'match /commissioningItems/{itemId} {',
  issues: 'match /issues/{issueId} {',
  costs: 'match /costTransactions/{transactionId} {',
  projections: 'match /paymentProjections/{projectionId} {',
};
const nested = (k) => block(NESTED[k]);
const projectDocStatements = () => allows(CODE.slice(CODE.indexOf('match /projects/{projectId} {'), CODE.indexOf(NESTED.assignments)));

describe('No blanket access (the previous permissive ruleset must never return)', () => {
  it('no `allow ...: if true`, and no time-limited unrestricted rule (request.time)', () => {
    expect(CODE).not.toMatch(/if\s+true\s*;/);
    expect(CODE).not.toMatch(/request\.time/);
    expect(CODE).not.toMatch(/allow\s+[a-z, ]+;/); // an allow with no condition at all
  });

  it('every allow condition is gated by authentication, a role, or an assignment (or is a literal `false`)', () => {
    const all = allows(CODE);
    expect(all.length).toBeGreaterThan(20);
    for (const a of all) {
      expect(a.cond, `ungated allow: ${a.ops.join(',')}: ${a.cond}`).toMatch(/isSignedIn\(|isAuthorized\(|hasRole\(|isAssignedToProject\(|isSuperAdmin\(|^\s*false\s*$/);
    }
  });

  it('unauthenticated, inactive and profile-less users: every helper chain starts at isSignedIn()/isAuthorized()', () => {
    expect(CODE).toMatch(/function isSignedIn\(\) \{\s*return request\.auth != null;/);
    expect(CODE).toMatch(/function amActive\(\) \{[\s\S]*?exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)[\s\S]*?status == 'ACTIVE'/); // profile must exist AND be ACTIVE
    expect(CODE).toMatch(/function isAuthorized\(\) \{\s*return isSignedIn\(\) && amActive\(\);/);
    expect(CODE).toMatch(/function hasRole\(roles\) \{\s*return isAuthorized\(\)/);
    expect(CODE).toMatch(/function isAssignedToProject\(projectId\) \{\s*return isAuthorized\(\)/);
  });
});

describe('Collection-group query vs rule (the verified root cause of "read collectionGroup(projectAssignments) failed")', () => {
  // Every collectionGroup() read in the client, with the fields it filters on.
  function collectionGroupCalls() {
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
          const src = fs.readFileSync(p, 'utf8');
          for (const m of src.matchAll(/getCollectionGroupDocs\(([^;]*?)\)\s*;?\s*\n/g)) {
            const args = m[1];
            if (/function|collectionId/.test(args)) continue; // the helper's own definition
            const coll = /ASSIGNMENTS/.test(args) ? 'projectAssignments' : (args.match(/'([A-Za-z]+)'/) || [])[1];
            const fields = [...args.matchAll(/where\('([A-Za-z.]+)'/g)].map((x) => x[1]);
            out.push({ file: e.name, coll, fields });
          }
        }
      }
    };
    walk(SRC_DIR);
    return out;
  }

  it('the client does issue a filtered collection-group query on projectAssignments (otherwise this contract test is vacuous)', () => {
    const calls = collectionGroupCalls();
    expect(calls.some((c) => c.coll === 'projectAssignments' && c.fields.includes('userId'))).toBe(true);
  });

  it('CONTRACT: for every collection-group query, the matching rule constrains the SAME field the query filters on (rules are not filters)', () => {
    for (const call of collectionGroupCalls()) {
      const rule = block(`match /{path=**}/${call.coll}/{assignmentId} {`);
      expect(call.fields.length, `${call.file}: collection-group query on ${call.coll} has no where() filter`).toBeGreaterThan(0);
      for (const f of call.fields) {
        expect(rule, `${call.file}: query filters ${f} but the rule never reads resource.data.${f}`).toMatch(new RegExp(`resource\\.data\\.${f}\\s*==\\s*request\\.auth\\.uid`));
      }
    }
  });

  it('the collection-group rule is NOT keyed to the document-id wildcard (unprovable from a field filter)', () => {
    const rule = block('match /{path=**}/projectAssignments/{assignmentId} {');
    expect(rule).not.toMatch(/request\.auth\.uid\s*==\s*assignmentId/);
    expect(rule).not.toMatch(/assignmentId\s*==\s*request\.auth\.uid/);
    expect(rule).not.toMatch(/\{userId\}/);
  });

  it('it grants only OWN assignments to an authorized (active, profiled) user, read-only', () => {
    const rule = allows(block('match /{path=**}/projectAssignments/{assignmentId} {'));
    expect(rule).toHaveLength(1);
    expect(rule[0].ops).toEqual(['read']);
    expect(rule[0].cond.replace(/\s+/g, ' ').trim()).toBe('isAuthorized() && resource.data.userId == request.auth.uid');
  });
});

describe('Project assignments: document id and userId field cannot disagree (impersonation guard)', () => {
  const a = () => allows(nested('assignments'));

  it('create/update require request.resource.data.userId == the document id', () => {
    const w = a().find((s) => s.ops.includes('create') && s.ops.includes('update'));
    expect(w).toBeTruthy();
    expect(w.cond).toMatch(/request\.resource\.data\.userId == assignmentId/);
  });

  it('only Super Admin, Head PM, and an ASSIGNED Project Manager may write assignments -- no other role', () => {
    for (const s of a().filter(isWrite)) {
      const roles = [...s.cond.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
      expect(roles.every((r) => ['SUPER_ADMIN', 'HEAD_PM', 'PROJECT_MANAGER'].includes(r))).toBe(true);
      if (roles.includes('PROJECT_MANAGER')) expect(s.cond).toMatch(/hasRole\(\['PROJECT_MANAGER'\]\) && isAssignedToProject\(projectId\)/);
    }
  });

  it('nested read stays Super Admin / Head PM or an assigned user of THAT project', () => {
    const r = a().find(isRead);
    expect(r.cond.replace(/\s+/g, ' ')).toBe("hasRole(['SUPER_ADMIN', 'HEAD_PM']) || isAssignedToProject(projectId)");
  });
});

describe('Project document and users: the two reads the reported errors came from', () => {
  it('assigned (or Super Admin/Head PM/BOD/SCM) may read projects/{id}; nobody else', () => {
    const r = projectDocStatements().find(isRead);
    expect(r.cond.replace(/\s+/g, ' ')).toBe("hasRole(['SUPER_ADMIN', 'HEAD_PM', 'BOD', 'SCM']) || isAssignedToProject(projectId)");
  });

  it('isAssignedToProject keys on the assignment DOCUMENT id under the SAME project path', () => {
    expect(CODE).toMatch(/exists\(\s*\/databases\/\$\(database\)\/documents\/projects\/\$\(projectId\)\/projectAssignments\/\$\(request\.auth\.uid\)\s*\)/);
  });

  it('users: a signed-in user reads their OWN profile FIRST (before any role helper); Super Admin and Head PM read all; only Super Admin writes', () => {
    const u = allows(block('match /users/{userId} {'));
    const read = u.find(isRead);
    expect(read.cond.replace(/\s+/g, ' ').trim()).toBe("(isSignedIn() && request.auth.uid == userId) || hasRole(['SUPER_ADMIN', 'HEAD_PM'])");
    const writes = u.filter(isWrite);
    expect(writes).toHaveLength(1);
    expect(writes[0].cond.trim()).toBe('isSuperAdmin()');
  });
});

describe('Role boundaries preserved', () => {
  it('Super Admin and Head PM keep project administration (create/update); only Super Admin deletes', () => {
    const p = projectDocStatements();
    expect(p.find((s) => s.ops.includes('create')).cond).toMatch(/hasRole\(\['SUPER_ADMIN', 'HEAD_PM'\]\)/);
    expect(p.find((s) => s.ops.includes('update')).cond).toMatch(/hasRole\(\['SUPER_ADMIN', 'HEAD_PM'\]\)/);
    expect(p.find((s) => s.ops.includes('delete')).cond.trim()).toBe('isSuperAdmin()');
  });

  it('a Project Manager may update the project document ONLY for progressWeights/updatedAt (no master identity fields)', () => {
    const upd = projectDocStatements().find((s) => s.ops.includes('update')).cond;
    expect(upd).toMatch(/hasRole\(\['PROJECT_MANAGER'\]\) && isAssignedToProject\(projectId\)[\s\S]*?hasOnly\(\['progressWeights', 'updatedAt'\]\)/);
  });

  it('BOD: read-only everywhere -- never in any create/update/write/delete, and absent from the cost rules entirely', () => {
    const everything = Object.values(NESTED).flatMap((m) => allows(block(m))).concat(projectDocStatements(), allows(block('match /users/{userId} {')));
    for (const s of everything.filter(isWrite)) expect(s.cond, `BOD in a write: ${s.cond}`).not.toMatch(/'BOD'/);
    for (const k of ['costs', 'projections']) expect(nested(k)).not.toMatch(/'BOD'/);
  });

  it('SCM is global for read of projects/procurement/cost/projections, and writes ONLY: procurement ACTUAL, CT create/allocation, projection create', () => {
    const writesByBlock = { projectDoc: projectDocStatements(), ...Object.fromEntries(Object.keys(NESTED).map((k) => [k, allows(nested(k))])) };
    const scmWrites = Object.entries(writesByBlock).flatMap(([k, list]) => list.filter(isWrite).filter((s) => /'SCM'/.test(s.cond)).map(() => k));
    expect([...new Set(scmWrites)].sort()).toEqual(['costs', 'procurement', 'projections']);
    for (const k of ['projectDoc', 'assignments', 'progressHistory', 'engineering', 'hse', 'construction', 'commissioning', 'issues']) {
      expect(writesByBlock[k].filter(isWrite).every((s) => !/'SCM'/.test(s.cond)), `SCM must not write ${k}`).toBe(true);
    }
    // procurement: SCM may touch ACTUAL fields only, never PLAN fields
    const proc = nested('procurement');
    expect(proc).toMatch(/hasRole\(\['SCM'\]\)\s*&& request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['progressContribution', 'actualDate', 'status'\]\)/);
    // projections: SCM creates; only Super Admin / assigned Finance update
    expect(allows(nested('projections')).find((s) => s.ops.includes('update')).cond).not.toMatch(/'SCM'/);
  });

  it('Finance is project-scoped: it appears only in cost/projection writes, always with isAssignedToProject, and in NO read blanket list', () => {
    for (const [k, m] of Object.entries(NESTED)) {
      for (const s of allows(block(m))) {
        if (!/'FINANCE'/.test(s.cond)) continue;
        expect(['costs', 'projections'], `FINANCE appears in ${k}`).toContain(k);
        expect(isRead(s), `FINANCE in a read statement of ${k}`).toBe(false);
        expect(s.cond, `${k}: FINANCE clause lacks isAssignedToProject`).toMatch(/hasRole\(\[[^\]]*'FINANCE'[^\]]*\]\)[^|]*isAssignedToProject\(projectId\)/);
      }
    }
  });

  it('plan-vs-actual field ownership is intact (procurement, construction, commissioning)', () => {
    expect(nested('procurement')).toMatch(/hasOnly\(\['name', 'weight', 'plannedDate'\]\)/);
    expect(nested('construction')).toMatch(/hasOnly\(\['activity', 'plannedQuantity', 'unit', 'weight', 'updatedAt'\]\)/);
    expect(nested('construction')).toMatch(/hasRole\(\['SITE_MANAGER'\]\)[\s\S]*?hasOnly\(\['actualQuantity', 'history', 'updatedAt'\]\)/);
    expect(nested('commissioning')).toMatch(/hasOnly\(\['item', 'weight'\]\)/);
    expect(nested('commissioning')).toMatch(/hasOnly\(\['completionStatus'\]\)/);
  });

  it('cost transactions: sourceRole must equal the caller\'s own role; allocated CTs are frozen; projections carry no totalAmount/costTransactionIds', () => {
    const c = nested('costs');
    expect(c).toMatch(/request\.resource\.data\.sourceRole == myRole\(\)/);
    expect(c).toMatch(/allow update: if \(!isAllocated\(\) \|\| !touchesFrozenFields\(\)\)/);
    expect(allows(nested('projections')).find((s) => s.ops.includes('create')).cond).not.toMatch(/totalAmount|costTransactionIds/);
  });
});

describe('Menu label: "Project Master" for every role, including SCM', () => {
  it.each(Object.values(ROLES))('%s sees the /projects item labelled exactly "Project Master" (when it is visible to that role)', (role) => {
    const item = getNavItemsForRole(role).find((i) => i.path === '/projects');
    if (item) expect(item.label).toBe('Project Master');
  });

  it('SCM does see /projects, and under the canonical label', () => {
    expect(getNavItemsForRole(ROLES.SCM).find((i) => i.path === '/projects')?.label).toBe('Project Master');
  });
});

// Verified application/rules mismatches that are DELIBERATELY not "fixed" by loosening rules.
// Each needs a decision from the technical lead; see the README "Known Limitations".
describe('Open decisions (documented, not silently resolved)', () => {
  it.todo('plannedCost: UI (CostOverviewTab CAN_EDIT) lets SCM/HC/FINANCE edit it, but the projects update rule allows only Super Admin/Head PM -- no approved document grants the other roles; decide: narrow the UI or add a field-scoped rule clause');
  it.todo('users directory: IssuesTab/TeamTab call getUsers() for Project Manager/Site Manager/Engineering/HSE; SPMS-DOC-07 grants that read only to Super Admin and Head PM; decide the policy (do not grant by default)');
  it.todo('portfolio aggregations (Dashboard, Cost Control list, S-Curve) call getProjects() unscoped and read every project\'s subcollections for every role; roles without blanket read cannot satisfy that under assigned-scope rules -- needs an application change, not a rules change');
  it.todo('Project Master for SCM lists ALL projects and computes progress from engineering/HSE/construction/commissioning data that SCM may not read -- needs per-project isolation in the page');
});
