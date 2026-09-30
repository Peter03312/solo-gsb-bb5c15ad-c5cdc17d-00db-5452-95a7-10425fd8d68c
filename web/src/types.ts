export interface DocumentRef {
  id: string;
  title: string;
  revision: string;
  manuscript_count?: number;
  edition_count?: number;
}

export interface DocumentDTO {
  id: string;
  title: string;
  baseManuscriptId: string | null;
  revision: string;
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

export interface MemberDTO {
  manuscriptId: string;
  ord: number;
  missing: boolean;
  lineId: string | null;
  start?: number;
  end?: number;
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
  published?: { editionId: string; versionNo: number };
}

export interface CollationMember {
  manuscriptId: string;
  missing: boolean;
  lineId: string | null;
  lineNo: number | null;
  start: number;
  end: number;
  text: string | null;
  variant: boolean;
  inverted: boolean;
}

export interface CollationGroup {
  id: string;
  ord: number;
  note: string;
  baseLineNo: number;
  baseStart: number;
  baseEnd: number;
  baseText: string;
  isVariant: boolean;
  hasMissing: boolean;
  hasInversion: boolean;
  members: CollationMember[];
}

export interface RawManuscriptView {
  manuscriptId: string;
  segments: { lineId: string; lineNo: number; start: number; end: number; text: string }[];
}

export interface Collation {
  baseManuscriptId: string;
  groups: CollationGroup[];
  brokenGroups: { id: string; ord: number; reason: string; note: string }[];
  rawByManuscript: RawManuscriptView[];
}

export interface EditionRef {
  id: string;
  versionNo: number;
  label: string;
  revision: string;
  publishedAt: string;
}

export interface EditionDetail extends EditionRef {
  snapshot: {
    document: { id: string; title: string };
    baseManuscriptId: string;
    manuscripts: ManuscriptDTO[];
    lines: LineDTO[];
    groups: GroupDTO[];
    collation: Collation;
  };
}
