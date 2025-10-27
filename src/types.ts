export interface RequestOptions {
  headers?: Record<string, string>;
  body?: string;
  fingerprint?: string;
  userAgent?: string;
  proxy?: string;
  cookies?: Record<string, string>;
  timeout?: number;
}
