import initCycleTLS from 'cycletls';
import { CycleTLSOptions, CycleTLSResponse, RequestOptions } from './types';

export class CycleTLS {
    private client: any | null = null;
    private readonly defaultFingerprint: string;
    private readonly defaultTimeout: number;
    private readonly debug: boolean;
    private initialized: boolean = false;

    constructor(options: CycleTLSOptions = {}) {
        this.defaultFingerprint = options.defaultFingerprint || 'chrome';
        this.defaultTimeout = options.timeout || 30000;
        this.debug = options.debug || true;
    }

    async init(): Promise<this> {
        if (!this.initialized) {
            try {
                this.client = await initCycleTLS();
                this.initialized = true;
                if (this.debug) console.log('CycleTLS client initialized');
            } catch (error) {
                console.log(error);
                throw error;
            }
        }
        return this;
    }

    async exit(): Promise<void> {
        if (this.initialized && this.client) {
            try {
                await this.client.exit();
                this.initialized = false;
                this.client = null;
                if (this.debug) console.log('CycleTLS client closed');
            } catch (error) {
                console.error('Error closing CycleTLS client:', error);
            }
        }
    }

    async request(method: string, url: string, options: RequestOptions = {}): Promise<CycleTLSResponse> {
        if (!this.initialized) {
            await this.init();
        }

        if (!this.client) {
            throw new Error('CycleTLS client not initialized');
        }

        const config = {
            headers: options.headers || {},
            body: options.body || '',
            ja3: options.fingerprint || this.defaultFingerprint,
            userAgent: options.userAgent,
            proxy: options.proxy,
            cookies: options.cookies,
            timeout: Math.floor((options.timeout || this.defaultTimeout) / 1000)
        };        try {
            const response = await this.client(url, config, method.toUpperCase() as any);
            return {
                status: response.status,
                body: response.body,
                headers: response.headers
            };
        } catch (error) {
            if (this.debug) console.error(`${(error as Error).message}`);
            throw error;
        }
    }

    async get(url: string, options: RequestOptions = {}): Promise<CycleTLSResponse> {
        return this.request('GET', url, options);
    }

    async post(url: string, options: RequestOptions = {}): Promise<CycleTLSResponse> {
        return this.request('POST', url, options);
    }

    async put(url: string, options: RequestOptions = {}): Promise<CycleTLSResponse> {
        return this.request('PUT', url, options);
    }

    async patch(url: string, options: RequestOptions = {}): Promise<CycleTLSResponse> {
        return this.request('PATCH', url, options);
    }

    async delete(url: string, options: RequestOptions = {}): Promise<CycleTLSResponse> {
        return this.request('DELETE', url, options);
    }
}

export const createCycleTLS = async (options: CycleTLSOptions = {}): Promise<CycleTLS> => {
    const instance = new CycleTLS(options);
    await instance.init();
    return instance;
};

export default createCycleTLS;
