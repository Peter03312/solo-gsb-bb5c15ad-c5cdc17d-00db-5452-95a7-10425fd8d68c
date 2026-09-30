-- 多抄本校勘应用：数据库结构
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 文献（一篇）
CREATE TABLE documents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                text NOT NULL CHECK (length(btrim(title)) > 0),
  base_manuscript_id   uuid,
  revision             bigint NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 抄本（同一篇文献的至少两份）
CREATE TABLE manuscripts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  ord          int  NOT NULL CHECK (ord >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, name)
);

ALTER TABLE documents
  ADD CONSTRAINT documents_base_fk
  FOREIGN KEY (base_manuscript_id) REFERENCES manuscripts(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- 逐行文字。deleted 为软删除：被归组引用的行不物理删除，
-- 仅令相关对应组转为待修复。
CREATE TABLE lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manuscript_id uuid NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
  line_no       int  NOT NULL CHECK (line_no > 0),
  text          text NOT NULL DEFAULT '',
  deleted       boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manuscript_id, line_no)
);
-- 同一抄本存活行号唯一
CREATE UNIQUE INDEX lines_live_uniq ON lines (manuscript_id, line_no) WHERE deleted = false;

-- 对应组（连续字句的跨抄本对应）
CREATE TABLE corr_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord           int  NOT NULL CHECK (ord >= 0),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'broken')),
  note          text NOT NULL DEFAULT '',
  broken_reason text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX corr_groups_doc_idx ON corr_groups (document_id, ord);

-- 组成员：每个抄本在每组至多一条（PK 约束），
-- 非缺文时记录行内片段区间 [start_cp, end_cp)，偏移按 Unicode 码位计。
CREATE TABLE group_members (
  group_id      uuid NOT NULL REFERENCES corr_groups(id) ON DELETE CASCADE,
  manuscript_id uuid NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
  ord           int  NOT NULL,
  line_id       uuid REFERENCES lines(id) ON DELETE RESTRICT,
  start_cp      int  NOT NULL DEFAULT 0 CHECK (start_cp >= 0),
  end_cp        int  NOT NULL DEFAULT 0 CHECK (end_cp >= 0),
  is_missing    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (group_id, manuscript_id),
  CONSTRAINT fragment_range_chk CHECK (
    is_missing OR (line_id IS NOT NULL AND end_cp > start_cp)
  )
);
CREATE INDEX group_members_line_idx ON group_members (line_id);
CREATE INDEX group_members_ms_idx ON group_members (manuscript_id);

-- 已发布校勘版（不可变快照）
CREATE TABLE editions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no   int  NOT NULL CHECK (version_no > 0),
  label        text NOT NULL DEFAULT '',
  snapshot     jsonb NOT NULL,
  revision     bigint NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_no)
);
