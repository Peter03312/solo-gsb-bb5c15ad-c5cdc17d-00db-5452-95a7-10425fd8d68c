import express, { Request, Response, NextFunction } from 'express';
import { ApiError } from './errors';
import { apiRouter } from './routes';
import { waitForDatabase } from './db';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', apiRouter);

// 统一错误输出
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  // pg 错误（如唯一约束）兜底，不回显内部细节
  const e = err as { code?: string; detail?: string };
  if (e?.code === '23505') {
    res.status(409).json({ error: { code: 'unique_violation', message: '数据冲突（唯一约束）' } });
    return;
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'internal', message: '服务器内部错误' } });
});

const port = Number(process.env.PORT ?? 3000);

waitForDatabase(60)
  .then(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`校勘 API 已启动: http://localhost:${port}/api`);
    });
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
