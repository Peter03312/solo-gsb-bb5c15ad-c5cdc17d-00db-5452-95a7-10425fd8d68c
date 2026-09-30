import { PoolClient } from 'pg';
import { withTransaction } from './db';
import { notFound, staleRevision, validationFailed, badRequest } from './errors';
import { DocState, MemberInput } from './types';
import { loadState } from './state';
import {
  NormalizedMember,
  publishPreconditions,
  reasonGroupBrokenByLines,
  validateMembers,
} from './validation';
import { buildCollation } from './collation';
import { codePointSlice } from './util';

interface Locked {
  state: DocState;
}

/** 锁文档行并校验乐观版本号，返回事务内最新状态 */
async function lockDoc(client: PoolClient, docId: string, expectedRevision: number): Promise<Locked> {
  const res = await client.query<{ id: string }>(
    'SELECT id FROM documents WHERE id = $1 FOR UPDATE',
    [docId],
  );
  if (res.rowCount === 0) throw notFound('文献不存在');

  const state = await loadState(docId, client);
  if (!state) throw notFound('文献不存在');
  const current = Number(state.document.revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current) {
    throw staleRevision();
  }
  return { state };
}

async function bumpRevision(client: PoolClient, docId: string): Promise<void> {
  await client.query(
    `UPDATE documents SET revision = revision + 1, updated_at = now() WHERE id = $1`,
    [docId],
  );
}

async function saveMembers(
  client: PoolClient,
  groupId: string,
  members: NormalizedMember[],
): Promise<void> {
  await client.query('DELETE FROM group_members WHERE group_id = $1', [groupId]);
  for (const m of members) {
    await client.query(
      `INSERT INTO group_members
         (group_id, manuscript_id, ord, line_id, start_cp, end_cp, is_missing)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [groupId, m.manuscriptId, m.ord, m.lineId, m.start, m.end, m.missing],
    );
  }
}

async function nextOrd(client: PoolClient, docId: string): Promise<number> {
  const r = await client.query<{ next: number | null }>(
    `SELECT COALESCE(MAX(ord) + 10, 0)::int AS next FROM corr_groups WHERE document_id = $1`,
    [docId],
  );
  return r.rows[0].next ?? 0;
}

/* ---------------- 文档 ---------------- */

export async function createDocument(title: string): Promise<DocState> {
  return withTransaction(async (client) => {
    const t = String(title ?? '').trim();
    if (!t) throw badRequest('标题不能为空');
    const ins = await client.query<{ id: string }>(
      'INSERT INTO documents (title) VALUES ($1) RETURNING id::text',
      [t],
    );
    const state = await loadState(ins.rows[0].id, client);
    return state!;
  });
}

export async function addManuscript(
  docId: string,
  name: string,
  expectedRevision: number,
): Promise<DocState> {
  return withTransaction(async (client) => {
    const { state } = await lockDoc(client, docId, expectedRevision);
    const n = String(name ?? '').trim();
    if (!n) throw badRequest('抄本名称不能为空');
    if (state.manuscripts.some((m) => m.name === n)) {
      throw badRequest(`已存在同名抄本「${n}」`, 'duplicate_manuscript');
    }
    const ord = state.manuscripts.length;
    await client.query(
      'INSERT INTO manuscripts (document_id, name, ord) VALUES ($1, $2, $3)',
      [docId, n, ord],
    );
    // 第一份抄本自动成为底本
    if (!state.document.baseManuscriptId && ord === 0) {
      const r = await client.query<{ id: string }>(
        'SELECT id::text FROM manuscripts WHERE document_id = $1 ORDER BY ord LIMIT 1',
        [docId],
      );
      await client.query('UPDATE documents SET base_manuscript_id = $1 WHERE id = $2', [
        r.rows[0].id,
        docId,
      ]);
    }
    await bumpRevision(client, docId);
    return (await loadState(docId, client))!;
  });
}

export async function setBase(
  docId: string,
  manuscriptId: string,
  expectedRevision: number,
): Promise<DocState> {
  return withTransaction(async (client) => {
    const { state } = await lockDoc(client, docId, expectedRevision);
    if (!state.manuscripts.some((m) => m.id === manuscriptId)) {
      throw badRequest('该抄本不存在或不属于本文档', 'unknown_manuscript');
    }
    const prevBase = state.document.baseManuscriptId;
    await client.query('UPDATE documents SET base_manuscript_id = $1 WHERE id = $2', [
      manuscriptId,
      docId,
    ]);

    // 更换底本：组内底本约束变化，所有现有组进入待修复（不删除，可逐一修复）
    if (prevBase && prevBase !== manuscriptId && state.groups.length > 0) {
      await client.query(
        `UPDATE corr_groups
           SET status = 'broken',
               broken_reason = '底本已更换，请按新底本重新指定对应片段',
               updated_at = now()
         WHERE document_id = $1 AND status = 'active'`,
        [docId],
      );
    }
    await bumpRevision(client, docId);
    return (await loadState(docId, client))!;
  });
}

/* ---------------- 逐行原文 ---------------- */

export interface LineInput {
  lineNo: number;
  text: string;
}

export async function replaceLines(
  manuscriptId: string,
  incoming: LineInput[],
  expectedRevision: number,
): Promise<{ docId: string; state: DocState }> {
  return withTransaction(async (client) => {
    const msRes = await client.query<{ document_id: string }>(
      'SELECT document_id::text FROM manuscripts WHERE id = $1 FOR UPDATE',
      [manuscriptId],
    );
    if (msRes.rowCount === 0) throw notFound('抄本不存在');
    const docId = msRes.rows[0].document_id;

    const { state } = await lockDoc(client, docId, expectedRevision);

    // 请求体基本校验（整体拒绝）
    const errors: { location: string; reason: string }[] = [];
    if (!Array.isArray(incoming)) {
      throw badRequest('lines 必须为数组');
    }
    const seenNo = new Set<number>();
    incoming.forEach((l, i) => {
      const loc = `第 ${i + 1} 项`;
      if (!l || !Number.isInteger(l.lineNo) || l.lineNo <= 0) {
        errors.push({ location: loc, reason: 'lineNo 必须为正整数' });
        return;
      }
      if (seenNo.has(l.lineNo)) {
        errors.push({ location: `第 ${l.lineNo} 行`, reason: '行号重复' });
        return;
      }
      seenNo.add(l.lineNo);
      if (typeof l.text !== 'string') {
        errors.push({ location: `第 ${l.lineNo} 行`, reason: 'text 必须为字符串' });
      }
    });
    if (errors.length) throw validationFailed(errors);

    const existing = state.lines.filter((l) => l.manuscriptId === manuscriptId);
    const msName = state.manuscripts.find((m) => m.id === manuscriptId)?.name ?? '';
    const incomingMap = new Map(incoming.map((l) => [l.lineNo, l.text]));

    // 1) 更新 / 恢复 已提交的行；记录变化行（文字变化/恢复/删除）
    const changedLineIds = new Set<string>();
    for (const lineNo of incomingMap.keys()) {
      const text = incomingMap.get(lineNo)!;
      const live = existing.find((l) => l.lineNo === lineNo && !l.deleted);
      if (live) {
        if (live.text !== text) {
          await client.query(
            'UPDATE lines SET text = $1, updated_at = now() WHERE id = $2',
            [text, live.id],
          );
          changedLineIds.add(live.id);
        }
      } else {
        const deleted = existing.find((l) => l.lineNo === lineNo && l.deleted);
        if (deleted) {
          await client.query(
            'UPDATE lines SET text = $1, deleted = false, updated_at = now() WHERE id = $2',
            [text, deleted.id],
          );
          changedLineIds.add(deleted.id);
        } else {
          const ins = await client.query<{ id: string }>(
            'INSERT INTO lines (manuscript_id, line_no, text) VALUES ($1, $2, $3) RETURNING id::text',
            [manuscriptId, lineNo, text],
          );
          changedLineIds.add(ins.rows[0].id);
        }
      }
    }

    // 2) 未出现在提交中的存活行 -> 软删除
    for (const l of existing) {
      if (!l.deleted && !incomingMap.has(l.lineNo)) {
        await client.query('UPDATE lines SET deleted = true, updated_at = now() WHERE id = $1', [
          l.id,
        ]);
        changedLineIds.add(l.id);
      }
    }

    // 3) 仅令引用受影响行的组待修复
    if (changedLineIds.size > 0) {
      const affected = new Set(
        state.groups
          .filter((g) => g.members.some((m) => m.lineId && changedLineIds.has(m.lineId)))
          .map((g) => g.id),
      );
      if (affected.size > 0) {
        const newState = await loadState(docId, client);
        const oldLineById = new Map(existing.map((l) => [l.id, l]));
        for (const gid of affected) {
          const g = newState!.groups.find((x) => x.id === gid)!;

          // 3a) 结构性问题优先（行被删除、越界、归属变化等）
          const structuralReason = reasonGroupBrokenByLines(g, newState!);

          // 3b) 结构通过时，再看片段文字本身是否改变
          // （即使区间仍有效，字句已不同也须研究者重新校定）
          let contentReason: string | null = null;
          if (!structuralReason) {
            for (const m of g.members) {
              if (!m.lineId || !changedLineIds.has(m.lineId)) continue;
              const oldLine = oldLineById.get(m.lineId);
              const newLine = newState!.lines.find((l) => l.id === m.lineId);
              if (!oldLine || !newLine) continue;
              const oldSlice = codePointSlice(oldLine.text, m.start ?? 0, m.end ?? 0);
              const newSlice = codePointSlice(newLine.text, m.start ?? 0, m.end ?? 0);
              if (oldLine.text !== newLine.text && oldSlice !== newSlice) {
                contentReason = `第 ${newLine.lineNo} 行原文字句改动，组内片段由「${oldSlice}」变为「${newSlice}」，请重新校定`;
                break;
              }
            }
          }

          const reason = structuralReason
            ? `${msName}原文改动：${structuralReason}`
            : contentReason;

          if (reason) {
            // 已是 broken 的组也要刷新原因（如“已删除”→“越界”）
            await client.query(
              `UPDATE corr_groups SET status = 'broken', broken_reason = $1, updated_at = now()
               WHERE id = $2`,
              [reason, gid],
            );
          } else if (g.status === 'broken' && !g.brokenReason.includes('原文字句改动')) {
            // 本次改动未影响组内片段，且此前仅因结构问题待修复：自动恢复有效；
            // 因字句改动待修复的组仍须研究者显式修复。
            await client.query(
              `UPDATE corr_groups SET status = 'active', broken_reason = '', updated_at = now()
               WHERE id = $1`,
              [gid],
            );
          }
        }
      }
    }

    await bumpRevision(client, docId);
    return { docId, state: (await loadState(docId, client))! };
  });
}

/* ---------------- 对应组 ---------------- */

export async function createGroup(
  docId: string,
  members: MemberInput[],
  note: string | undefined,
  expectedRevision: number,
): Promise<DocState> {
  return withTransaction(async (client) => {
    const { state } = await lockDoc(client, docId, expectedRevision);
    const { members: normalized, errors } = validateMembers(state, members, null);
    if (errors.length) throw validationFailed(errors);

    const ord = await nextOrd(client, docId);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO corr_groups (document_id, ord, note)
       VALUES ($1, $2, $3) RETURNING id::text`,
      [docId, ord, String(note ?? '')],
    );
    await saveMembers(client, ins.rows[0].id, normalized!);
    await bumpRevision(client, docId);
    return (await loadState(docId, client))!;
  });
}

export async function updateGroup(
  groupId: string,
  members: MemberInput[],
  note: string | undefined,
  expectedRevision: number,
): Promise<DocState> {
  return withTransaction(async (client) => {
    const gRes = await client.query<{ document_id: string }>(
      'SELECT document_id::text FROM corr_groups WHERE id = $1 FOR UPDATE',
      [groupId],
    );
    if (gRes.rowCount === 0) throw notFound('对应组不存在');
    const docId = gRes.rows[0].document_id;

    const { state } = await lockDoc(client, docId, expectedRevision);
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) throw notFound('对应组不存在');

    const { members: normalized, errors } = validateMembers(state, members, groupId);
    if (errors.length) throw validationFailed(errors);

    await saveMembers(client, groupId, normalized!);
    await client.query(
      `UPDATE corr_groups
         SET note = $1,
             status = 'active',
             broken_reason = '',
             updated_at = now()
       WHERE id = $2`,
      [String(note ?? ''), groupId],
    );
    await bumpRevision(client, docId);
    return (await loadState(docId, client))!;
  });
}

/** 修复：用当前数据重新校验现有成员区间（也允许提交修改后的成员） */
export async function repairGroup(
  groupId: string,
  members: MemberInput[] | undefined,
  expectedRevision: number,
): Promise<DocState> {
  return withTransaction(async (client) => {
    const gRes = await client.query<{ document_id: string }>(
      'SELECT document_id::text FROM corr_groups WHERE id = $1 FOR UPDATE',
      [groupId],
    );
    if (gRes.rowCount === 0) throw notFound('对应组不存在');
    const docId = gRes.rows[0].document_id;

    const { state } = await lockDoc(client, docId, expectedRevision);
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) throw notFound('对应组不存在');

    const input: MemberInput[] =
      members ??
      group.members.map((m) => ({
        manuscriptId: m.manuscriptId,
        missing: m.missing,
        lineId: m.lineId,
        start: m.start,
        end: m.end,
      }));

    const { members: normalized, errors } = validateMembers(state, input, groupId);
    if (errors.length) throw validationFailed(errors);

    await saveMembers(client, groupId, normalized!);
    await client.query(
      `UPDATE corr_groups SET status = 'active', broken_reason = '', updated_at = now()
       WHERE id = $1`,
      [groupId],
    );
    await bumpRevision(client, docId);
    return (await loadState(docId, client))!;
  });
}

export async function deleteGroup(
  groupId: string,
  expectedRevision: number,
): Promise<DocState> {
  return withTransaction(async (client) => {
    const gRes = await client.query<{ document_id: string }>(
      'SELECT document_id::text FROM corr_groups WHERE id = $1 FOR UPDATE',
      [groupId],
    );
    if (gRes.rowCount === 0) throw notFound('对应组不存在');
    const docId = gRes.rows[0].document_id;

    await lockDoc(client, docId, expectedRevision);
    await client.query('DELETE FROM corr_groups WHERE id = $1', [groupId]);
    await bumpRevision(client, docId);
    return (await loadState(docId, client))!;
  });
}

/* ---------------- 发布 ---------------- */

export async function publish(
  docId: string,
  label: string | undefined,
  expectedRevision: number,
): Promise<{ state: DocState; editionId: string; versionNo: number }> {
  return withTransaction(async (client) => {
    const { state } = await lockDoc(client, docId, expectedRevision);

    const errors = publishPreconditions(state);
    if (errors.length) throw validationFailed(errors);

    const baseId = state.document.baseManuscriptId!;
    const collation = buildCollation(state.manuscripts, state.lines, state.groups, baseId);

    const vRes = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_no) + 1, 1)::int AS next FROM editions WHERE document_id = $1`,
      [docId],
    );
    const versionNo = vRes.rows[0].next;

    const snapshot = {
      document: { id: state.document.id, title: state.document.title },
      baseManuscriptId: baseId,
      publishedFromRevision: Number(state.document.revision),
      manuscripts: state.manuscripts,
      lines: state.lines,
      groups: state.groups,
      collation,
    };

    const ins = await client.query<{ id: string }>(
      `INSERT INTO editions (document_id, version_no, label, snapshot, revision)
       VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
      [docId, versionNo, String(label ?? ''), JSON.stringify(snapshot), state.document.revision],
    );

    await bumpRevision(client, docId);
    return {
      state: (await loadState(docId, client))!,
      editionId: ins.rows[0].id,
      versionNo,
    };
  });
}
