// src/Request.ts
export interface FetchOptions {
    headers?: Record<string, string>;
    body?: string;
}

export interface CycleTLSResponse {
    status: number;
    body: string | object;
    headers: Record<string, string>;
}

export class Request {
    public cycleTLS: any = null;

    async init(): Promise<void> {
        console.log('✅ Request client initialisé (fetch natif)');
        return Promise.resolve();
    }

    async fetch(method: string, url: string, options: FetchOptions = {}): Promise<CycleTLSResponse> {
        return new Promise(async (resolve, reject) => {
            try {
                console.log(`🔗 ${method} ${url}`);
                
                const response = await fetch(url, {
                    method: method,
                    headers: options.headers,
                    body: options.body
                });

                let body: string | object;
                const contentType = response.headers.get('content-type');
                
                if (contentType && contentType.includes('application/json')) {
                    body = await response.json();
                } else {
                    body = await response.text();
                    // Essayer de parser en JSON si c'est du JSON
                    try {
                        if (typeof body === 'string' && body.trim().startsWith('{')) {
                            body = JSON.parse(body);
                        }
                    } catch (error) {
                        // Reste en string si ce n'est pas du JSON valide
                    }
                }

                const headers: Record<string, string> = {};
                response.headers.forEach((value, key) => {
                    headers[key] = value;
                });

                console.log(`📡 Response status: ${response.status} for ${method} ${url}`);

                resolve({
                    status: response.status,
                    body: body,
                    headers: headers
                });
            } catch (error) {
                console.error(`❌ Erreur fetch ${method} ${url}:`, error);
                reject(error);
            }
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
            "X-Super-Properties": "eyJvcyI6IkxpbnV4IiwiYnJvd3NlciI6IkNocm9tZSIsImRldmljZSI6IiIsInN5c3RlbV9sb2NhbGUiOiJlbi1VUyIsImJyb3dzZXJfdXNlcl9hZ2VudCI6Ik1vemlsbGEvNS4wIChYMTE7IExpbnV4IHg4Nl82NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyNC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3dzZXJfdmVyc2lvbiI6IjEyNC4wLjAuMCIsIm9zX3ZlcnNpb24iOiIiLCJyZWZlcnJlciI6IiIsInJlZmVycmluZ19kb21haW4iOiIiLCJyZWZlcnJlcl9jdXJyZW50IjoiIiwicmVmZXJyaW5nX2RvbWFpbl9jdXJyZW50IjoiIiwicmVsZWFzZV9jaGFubmVsIjoic3RhYmxlIiwiY2xpZW50X2J1aWxkX251bWJlciI6MzM0MjU4LCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ=="
        }, obj);
    }
}