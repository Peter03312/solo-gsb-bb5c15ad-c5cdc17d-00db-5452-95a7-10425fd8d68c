/** API 对外的数据类型（camelCase，由 snake_case 行映射而来） */

export interface DocumentDTO {
  id: string;
  title: string;
  baseManuscriptId: string | null;
  revision: string; // bigint 序列化为字符串
}

export interface ManuscriptDTO {
  id: string;
  documentId: string;
  name: string;
  ord: number;
}

export interface LineDTO {
  id: string;
  manuscriptId: string;
  lineNo: number;
  text: string;
  deleted: boolean;
}

export interface MemberInput {
  manuscriptId: string;
  missing: boolean;
  lineId?: string | null;
  start?: number;
  end?: number;
}

export interface MemberDTO extends MemberInput {
  ord: number;
}

export interface GroupDTO {
  id: string;
  documentId: string;
  ord: number;
  status: 'active' | 'broken';
  note: string;
  brokenReason: string;
  members: MemberDTO[];
}

export interface DocState {
  document: DocumentDTO;
  manuscripts: ManuscriptDTO[];
  lines: LineDTO[];
  groups: GroupDTO[];
}

export interface EditionDTO {
  id: string;
  documentId: string;
  versionNo: number;
  label: string;
  revision: string;
  publishedAt: string;
  snapshot?: CollationSnapshot;
}

export interface CollationSnapshot {
  document: { id: string; title: string };
  manuscripts: ManuscriptDTO[];
  collation: unknown;
}
