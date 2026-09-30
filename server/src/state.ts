import { PoolClient } from 'pg';
import { query } from './db';
import { GroupDTO, DocState, LineDTO, ManuscriptDTO, MemberDTO, DocumentDTO } from './types';

export async function loadState(
  docId: string,
  client?: PoolClient,
): Promise<DocState | null> {
  const exec = client
    ? <R extends Record<string, unknown>>(text: string, params: unknown[]) =>
        client.query<R>(text, params)
    : <R extends Record<string, unknown>>(text: string, params: unknown[]) =>
        query<R>(text, params);

  const docRes = await exec<Record<string, unknown>>(
    `SELECT id::text, title, base_manuscript_id::text, revision::text
     FROM documents WHERE id = $1`,
    [docId],
  );
  if (docRes.rowCount === 0) return null;

  const document: DocumentDTO = {
    id: docRes.rows[0].id as string,
    title: docRes.rows[0].title as string,
    baseManuscriptId: (docRes.rows[0].base_manuscript_id as string | null) ?? null,
    revision: docRes.rows[0].revision as string,
  };

  const msRes = await exec<{
    id: string; document_id: string; name: string; ord: number;
  }>(
    `SELECT id::text, document_id::text, name, ord FROM manuscripts
     WHERE document_id = $1 ORDER BY ord, name`,
    [docId],
  );
  const manuscripts: ManuscriptDTO[] = msRes.rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    name: r.name,
    ord: r.ord,
  }));

  const lineRes = await exec<{
    id: string; manuscript_id: string; line_no: number; text: string; deleted: boolean;
  }>(
    `SELECT id::text, manuscript_id::text, line_no, text, deleted
     FROM lines WHERE manuscript_id IN (SELECT id FROM manuscripts WHERE document_id = $1)
     ORDER BY manuscript_id, line_no`,
    [docId],
  );
  const lines: LineDTO[] = lineRes.rows.map((r) => ({
    id: r.id,
    manuscriptId: r.manuscript_id,
    lineNo: r.line_no,
    text: r.text,
    deleted: r.deleted,
  }));

  const grpRes = await exec<{
    id: string; document_id: string; ord: number; status: 'active' | 'broken';
    note: string; broken_reason: string;
  }>(
    `SELECT id::text, document_id::text, ord, status, note, broken_reason
     FROM corr_groups WHERE document_id = $1`,
    [docId],
  );

  const memberRes = await exec<{
    group_id: string; manuscript_id: string; ord: number;
    line_id: string | null; start_cp: number; end_cp: number; is_missing: boolean;
  }>(
    `SELECT group_id::text, manuscript_id::text, ord, line_id::text,
            start_cp, end_cp, is_missing
     FROM group_members
     WHERE group_id IN (SELECT id FROM corr_groups WHERE document_id = $1)
     ORDER BY group_id, ord`,
    [docId],
  );
  const membersByGroup = new Map<string, MemberDTO[]>();
  for (const r of memberRes.rows) {
    const arr = membersByGroup.get(r.group_id) ?? [];
    arr.push({
      manuscriptId: r.manuscript_id,
      ord: r.ord,
      missing: r.is_missing,
      lineId: r.line_id ?? null,
      start: r.start_cp,
      end: r.end_cp,
    });
    membersByGroup.set(r.group_id, arr);
  }

  const groups: GroupDTO[] = grpRes.rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    ord: r.ord,
    status: r.status,
    note: r.note,
    brokenReason: r.broken_reason,
    members: membersByGroup.get(r.id) ?? [],
  }));

  return { document, manuscripts, lines, groups };
}
