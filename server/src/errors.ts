export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message = '资源不存在') =>
  new ApiError(404, 'not_found', message);

export const badRequest = (message: string, code = 'bad_request') =>
  new ApiError(400, code, message);

export const staleRevision = () =>
  new ApiError(409, 'stale_revision', '数据版本已过期，请刷新后重试（并发修改冲突）');

/** 422：语义校验失败，errors 携带定位信息 */
export function validationFailed(errors: ValidationError[]) {
  return new ApiError(422, 'validation_failed', '校验未通过，未保存任何内容', {
    errors,
  });
}

export interface ValidationError {
  location: string;
  reason: string;
}
