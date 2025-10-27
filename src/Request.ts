import cycle from "./Cycle";
import { CycleTLS } from "./Cycle";
import { CycleTLSResponse } from './types';

export interface FetchOptions {
    headers?: Record<string, string>;
    body?: string;
}

export class Request {
    public cycleTLS: CycleTLS | null = null;

    async init(): Promise<void> {
        this.cycleTLS = await cycle();
    }

    async fetch(method: string, url: string, options: FetchOptions = {}): Promise<CycleTLSResponse> {
        return new Promise(async (resolve) => {
            if (!this.cycleTLS) {
                throw new Error('Request not initialized. Call init() first.');
            }

            const response = await this.cycleTLS.request(method, url, {
                fingerprint: "772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,45-0-16-35-23-65281-13-27-65037-18-51-43-11-5-10,25497-29-23-24,0",
                userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                body: options.body,
                headers: options.headers
            });

            if (response.headers && (
                response.headers['content-type']?.includes('application/json') || 
                (typeof response.body === 'string' && response.body.trim().startsWith('{'))
            )) {
                try {
                    JSON.parse(response.body as string);
                } catch (error) {
                    if (typeof response.body === 'object') {
                        response.body = JSON.stringify(response.body);
                    }
                }
            }

            resolve(response);
        });
    }

    mergeHeaders(obj: Record<string, string>): Record<string, string> {
        return Object.assign({
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Priority": "u=1, i",
            "Sec-Ch-Ua": "\"Chromium\";v=\"124\", \"Not;A=Brand\";v=\"24\", \"Google Chrome\";v=\"124\"",
            "Sec-Ch-Ua-mobile": "?0",
            "Sec-Ch-Ua-platform": "\"Windows\"",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Gpc": "1",
            "X-Debug-Options": "bugReporterEnabled",
            "X-Discord-Locale": "en-US",
            "X-Discord-Timezone": "Europe/Paris",
            "X-Super-Properties": "eyJvcyI6IkxpbnV4IiwiYnJvd3NlciI6IkNocm9tZSIsImRldmljZSI6IiIsInN5c3RlbV9sb2NhbGUiOiJlbi1VUyIsImJyb3dzZXJfdXNlcl9hZ2VudCI6Ik1vemlsbGEvNS4wIChYMTE7IExpbnV4IHg4Nl82NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyNC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTI0LjAuMC4wIiwib3NfdmVyc2lvbiI6IiIsInJlZmVycmVyIjoiIiwicmVmZXJyaW5nX2RvbWFpbiI6IiIsInJlZmVycmVyX2N1cnJlbnQiOiIiLCJyZWZlcnJpbmdfZG9tYWluX2N1cnJlbnQiOiIiLCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjozMzQyNTgsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGx9"
        }, obj);
    }
}
