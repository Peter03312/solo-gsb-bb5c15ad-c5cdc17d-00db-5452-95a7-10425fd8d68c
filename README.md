# 多抄本校勘 Web 应用

为古籍整理团队制作的多抄本（异本）逐行录文与行内对应组校勘工具。

技术栈：Node.js + TypeScript（Express / pg）、React + TypeScript（Vite）、PostgreSQL 16。

## 功能

- 同一篇文献可录入 **至少两份抄本** 的逐行文字，并选定 **底本**。
- 将行内连续字句编为 **对应组**：
  - 每组必须且仅含一个 **底本片段**，底本不得标为缺文；
  - 其他抄本在每组中至多占一个片段，或显式标为 **缺文**；
  - 同一抄本的片段不得跨组重叠；片段不得越界。
  - 任一校验不通过都会整体拒绝（事务内处理，**不会部分保存**），错误信息指明抄本、行号与区间。
- **对照页** 依底本顺序展示各组，标注 **异文、缺文、倒置片段**；未归组文字仍按各抄本原始行序在下方完整可见。
- 修改原文后，只有引用受影响行的对应组变为 **待修复（broken）**；存在待修复组时 **不能发布新校勘版**；旧发布版为不可变快照，仍可阅读。
- 所有写操作携带 `expectedRevision`，遇到过期版本返回 `409` 拒绝并发覆盖。

## 一键启动（Docker Compose）

需要 Docker 与 Docker Compose。

```bash
docker compose up --build
```

启动后访问：

| 服务 | 地址 |
| --- | --- |
| Web 界面 | http://localhost:8080 |
| API | http://localhost:3000/api |
| PostgreSQL | localhost:5432 |

数据库容器首次启动时自动执行 `db/init/01_schema.sql`（建表）与 `db/init/02_seed.sql`（内置《论语·学而》三抄本示例，含异文、缺文与倒置）。

停止并清理数据：

```bash
docker compose down -v
```

## 本地开发（不用 Docker）

```bash
# 1. 启动 PostgreSQL（或用 compose 只起数据库）
docker compose up -d db

# 2. 后端
cd server
npm install
DATABASE_URL=postgres://collation:collation@localhost:5432/collation npm run dev
# API: http://localhost:3000

# 3. 前端（新终端）
cd web
npm install
npm run dev
# Web: http://localhost:5173 （/api 自动代理到 3000）
```

## 配置（环境变量）

后端（`server`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `DATABASE_URL` | `postgres://collation:collation@localhost:5432/collation` | PostgreSQL 连接串 |

数据库（`db`，compose 内）：`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`，默认均为 `collation`。
如改动它们，请同步修改 `api` 服务的 `DATABASE_URL`。

前端容器内 Nginx 监听容器 80 端口，compose 映射到宿主机 **8080**；`/api` 反向代理到 `api:3000`。

## 主要 API

- `GET/POST /api/documents`
- `GET /api/documents/:id`（完整工作状态：抄本、行、对应组及成员）
- `POST /api/documents/:id/manuscripts`（新增抄本）
- `POST /api/documents/:id/base`（选定/更换底本）
- `PUT /api/manuscripts/:id/lines`（整表替换逐行文字，仅受影响组转为待修复）
- `POST /api/documents/:id/groups` / `PUT /api/groups/:id` / `POST /api/groups:/id/repair` / `POST /api/groups/:id/delete`
- `GET /api/documents/:id/collation`（工作区对照结果）
- `POST /api/documents/:id/publish`（发布不可变校勘版）
- `GET /api/documents/:id/editions`、`GET /api/editions/:id`

所有写请求体需带整数 `expectedRevision`（取自最近一次读取的 `document.revision`），过期返回 `409 {error.code=stale_revision}`；语义校验失败返回 `422` 且带定位信息；整个请求在单个数据库事务内执行，不会部分保存。
