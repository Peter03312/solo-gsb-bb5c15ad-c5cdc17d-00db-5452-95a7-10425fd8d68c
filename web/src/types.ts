export interface CellView {
  msId: number;
  missing: boolean;
  broken: boolean;
  lineNo?: number;
  startCp?: number;
  endCp?: number;
  text?: string;
  oobEnd?: number;
}

export interface GroupView {
  id: number;
  ord: number;
  broken: boolean;
  baseText: string;
  inverted: boolean;
  cells: CellView[];
  variant: boolean;
  hasMissing: boolean;
}

export interface CoveredSpan {
  startCp: number;
  endCp: number;
  groupId: number;
  broken: boolean;
}

export interface RawLineView {
  lineId: number;
  lineNo: number;
  content: string;
  covered: CoveredSpan[];
}

export interface CollationView {
  document: {
    id: number;
    title: string;
    version: number;
    baseMsId: number | null;
    publishedVer: number;
  };
  manuscripts: Array<{ id: number; name: string; position: number; isBase: boolean }>;
  groups: GroupView[];
  rawByMs: Array<{ msId: number; lines: RawLineView[] }>;
  stats: { manuscriptCount: number; lineCount: number; groupCount: number; brokenCount: number };
}

export interface FragmentDraft {
  msId: number;
  missing: boolean;
  lineId?: number | null;
  startCp?: number | null;
  endCp?: number | null;
}

export interface GroupDraft {
  key: string;            // 前端临时键
  ord: number;
  serverId?: number;      // 已保存组的服务端 id
  serverBroken?: boolean; // 该已保存组当前是否待修复
  fragments: FragmentDraft[];
}

export interface DocumentSummary {
  id: number;
  title: string;
  version: number;
  published_ver: number;
  base_ms_id: number | null;
  ms_count: number;
  broken_count: number;
}

export interface EditionSummary {
  id: number;
  edition_no: number;
  created_at: string;
}
