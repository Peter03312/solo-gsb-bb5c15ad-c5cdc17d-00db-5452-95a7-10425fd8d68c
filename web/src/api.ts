import type {
  Collation,
  DocState,
  DocumentRef,
  EditionDetail,
  EditionRef,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: { errors?: { location: string; reason: string }[] };

  constructor(
    status: number,
    code: string,
    message: string,
    details?: { errors?: { location: string; reason: string }[] },
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let payload: {
      error?: { code: string; message: string; details?: ApiError['details'] };
    } = {};
    try {
      payload = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(
      res.status,
      payload.error?.code ?? 'error',
      payload.error?.message ?? `请求失败（${res.status}）`,
      payload.error?.details,
    );
  }
  return (await res.json()) as T;
}

export const api = {
  listDocuments: () => request<{ documents: DocumentRef[] }>('GET', '/api/documents'),
  createDocument: (title: string) =>
    request<DocState>('POST', '/api/documents', { title }),
  getDocument: (id: string) => request<DocState>('GET', `/api/documents/${id}`),
  addManuscript: (id: string, name: string, expectedRevision: number) =>
    request<DocState>('POST', `/api/documents/${id}/manuscripts`, {
      name,
      expectedRevision,
    }),
  setBase: (id: string, manuscriptId: string, expectedRevision: number) =>
    request<DocState>('POST', `/api/documents/${id}/base`, {
      manuscriptId,
      expectedRevision,
    }),
  saveLines: (
    manuscriptId: string,
    lines: { lineNo: number; text: string }[],
    expectedRevision: number,
  ) =>
    request<DocState>('PUT', `/api/manuscripts/${manuscriptId}/lines`, {
      lines,
      expectedRevision,
    }),
  createGroup: (
    docId: string,
    members: unknown[],
    note: string,
    expectedRevision: number,
  ) =>
    request<DocState>('POST', `/api/documents/${docId}/groups`, {
      members,
      note,
      expectedRevision,
    }),
  updateGroup: (groupId: string, members: unknown[], note: string, expectedRevision: number) =>
    request<DocState>('PUT', `/api/groups/${groupId}`, {
      members,
      note,
      expectedRevision,
    }),
  repairGroup: (groupId: string, members: unknown[] | undefined, expectedRevision: number) =>
    request<DocState>('POST', `/api/groups/${groupId}/repair`, {
      members,
      expectedRevision,
    }),
  deleteGroup: (groupId: string, expectedRevision: number) =>
    request<DocState>('POST', `/api/groups/${groupId}/delete`, { expectedRevision }),
  collation: (docId: string) =>
    request<{
      document: DocState['document'];
      manuscripts: DocState['manuscripts'];
      collation: Collation;
    }>('GET', `/api/documents/${docId}/collation`),
  publish: (docId: string, label: string, expectedRevision: number) =>
    request<DocState & { published: { editionId: string; versionNo: number } }>(
      'POST',
      `/api/documents/${docId}/publish`,
      { label, expectedRevision },
    ),
  editions: (docId: string) =>
    request<{ editions: EditionRef[] }>('GET', `/api/documents/${docId}/editions`),
  edition: (id: string) => request<EditionDetail>('GET', `/api/editions/${id}`),
};
