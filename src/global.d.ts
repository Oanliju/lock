declare module 'node-2fa' {
    interface GenerateTokenResult {
        token: string;
        remaining: number;
    }

    interface GenerateSecretResult {
        secret: string;
        uri: string;
        qr: string;
    }

    export function generateToken(secret: string): GenerateTokenResult | null;
    export function generateSecret(options?: {
        name?: string;
        account?: string;
        length?: number;
    }): GenerateSecretResult;
    export function verifyToken(secret: string, token: string, window?: number): boolean | null;
}

declare module 'cycletls' {
    interface CycleTLSOptions {
        port?: number;
        debug?: boolean;
    }

    interface CycleTLSResponse {
        status: number;
        body: string;
        headers: Record<string, string>;
    }

    interface CycleTLSClient {
        (url: string, options: any, method: string): Promise<CycleTLSResponse>;
        exit(): Promise<void>;
    }

    function initCycleTLS(options?: CycleTLSOptions): Promise<CycleTLSClient>;
    export = initCycleTLS;
}
