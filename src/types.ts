export interface CycleTLSOptions {
  defaultFingerprint?: string;
  timeout?: number;
  debug?: boolean;
}

export interface CycleTLSResponse {
  status: number;
  body: string | object;
  headers: Record<string, string>;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  body?: string;
  fingerprint?: string;
  userAgent?: string;
  proxy?: string;
  cookies?: Record<string, string>;
  timeout?: number;
}
