import { Router, Request, Response, NextFunction } from 'express';
import { query } from './db';
import { loadState } from './state';
import { notFound, badRequest } from './errors';
import {
  addManuscript,
  createDocument,
  createGroup,
  deleteGroup,
  publish,
  repairGroup,
  replaceLines,
  setBase,
  updateGroup,
} from './service';
import { buildCollation } from './collation';

export const apiRouter = Router();

function expectRevision(body: Record<string, unknown>): number {
  const v = Number(body?.expectedRevision);
  if (!Number.isInteger(v)) throw badRequest('请求缺少 expectedRevision（整数版本号）', 'missing_revision');
  return v;
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/* 文档 */

apiRouter.get(
  '/documents',
  wrap(async (_req, res) => {
    const r = await query<{ id: string; title: string; revision: string }>(
      `SELECT d.id::text, d.title, d.revision::text,
              (SELECT count(*) FROM manuscripts m WHERE m.document_id = d.id)::int AS manuscript_count,
              (SELECT count(*) FROM editions e WHERE e.document_id = d.id)::int AS edition_count
       FROM documents d ORDER BY d.created_at DESC`,
    );
    res.json({ documents: r.rows });
  }),
);

apiRouter.post(
  '/documents',
  wrap(async (req, res) => {
    const state = await createDocument(String(req.body?.title ?? ''));
    res.status(201).json(state);
  }),
);

apiRouter.get(
  '/documents/:id',
  wrap(async (req, res) => {
    const state = await loadState(req.params.id);
    if (!state) throw notFound('文献不存在');
    res.json(state);
  }),
);

/* 抄本与底本 */

apiRouter.post(
  '/documents/:id/manuscripts',
  wrap(async (req, res) => {
    const rev = expectRevision(req.body);
    const state = await addManuscript(req.params.id, String(req.body?.name ?? ''), rev);
    res.json(state);
  }),
);

apiRouter.post(
  '/documents/:id/base',
  wrap(async (req, res) => {
    const rev = expectRevision(req.body);
    const state = await setBase(req.params.id, String(req.body?.manuscriptId ?? ''), rev);
    res.json(state);
  }),
);

/* 逐行原文 */

apiRouter.put(
  '/manuscripts/:id/lines',
  wrap(async (req, res) => {
    const rev = expectRevision(req.body);
    const { state } = await replaceLines(req.params.id, req.body?.lines ?? [], rev);
    res.json(state);
  }),
);

/* 对应组 */

apiRouter.post(
  '/documents/:id/groups',
  wrap(async (req, res) => {
    const rev = expectRevision(req.body);
    const state = await createGroup(
      req.params.id,
      Array.isArray(req.body?.members) ? req.body.members : [],
      req.body?.note,
      rev,
    );
    res.status(201).json(state);
  }),
);

apiRouter.put(
  '/groups/:id',
  wrap(async (req, res) => {
    const rev = expectRevision(req.body);
    const state = await updateGroup(
      req.params.id,
      Array.isArray(req.body?.members) ? req.body.members : [],
      req.body?.note,
      rev,
    );
    res.json(state);
  }),
);

apiRouter.post(
  '/groups/:id/repair',
  wrap(async (req, res) => {
    const rev = expectRevision(req.body);
    const state = await repairGroup(
      req.params.id,
      Array.isArray(req.body?.members) ? req.body.members : undefined,
      rev,
    );
    res.json(state);
  }),
);

apiRouter.post(
  '/groups/:id/delete',
  wrap(async (req, res) => {
    const rev = expectRevision(req.body);
    const state = await deleteGroup(req.params.id, rev);
    res.json(state);
  }),
);

/* 对照 */

apiRouter.get(
  '/documents/:id/collation',
  wrap(async (req, res) => {
    const state = await loadState(req.params.id);
    if (!state) throw notFound('文献不存在');
    if (!state.document.baseManuscriptId) {
      throw badRequest('尚未选定底本', 'no_base');
    }
    const collation = buildCollation(
      state.manuscripts,
      state.lines,
      state.groups,
      state.document.baseManuscriptId,
    );
    res.json({
      document: state.document,
      manuscripts: state.manuscripts,
      collation,
    });
  }),
);

/* 发布与版本 */

apiRouter.post(
  '/documents/:id/publish',
  wrap(async (req, res) => {
    const rev = expectRevision(req.body);
    const result = await publish(req.params.id, req.body?.label, rev);
    res.status(201).json({
      ...result.state,
      published: { editionId: result.editionId, versionNo: result.versionNo },
    });
  }),
);

apiRouter.get(
  '/documents/:id/editions',
  wrap(async (req, res) => {
    const exists = await query('SELECT 1 FROM documents WHERE id = $1', [req.params.id]);
    if (exists.rowCount === 0) throw notFound('文献不存在');
    const r = await query(
      `SELECT id::text, document_id::text, version_no, label, revision::text, published_at
       FROM editions WHERE document_id = $1 ORDER BY version_no DESC`,
      [req.params.id],
    );
    res.json({
      editions: r.rows.map((x) => ({
        id: x.id,
        documentId: x.document_id,
        versionNo: x.version_no,
        label: x.label,
        revision: x.revision,
        publishedAt: x.published_at,
      })),
    });
  }),
);

apiRouter.get(
  '/editions/:id',
  wrap(async (req, res) => {
    const r = await query(
      `SELECT id::text, document_id::text, version_no, label, revision::text,
              published_at, snapshot
       FROM editions WHERE id = $1`,
      [req.params.id],
    );
    if (r.rowCount === 0) throw notFound('校勘版不存在');
    const x = r.rows[0] as Record<string, unknown>;
    res.json({
      id: x.id,
      documentId: x.document_id,
      versionNo: x.version_no,
      label: x.label,
      revision: x.revision,
      publishedAt: x.published_at,
      snapshot: x.snapshot,
    });
  }),
);
