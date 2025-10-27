import { Request } from "./Request";
import * as speakeasy from "speakeasy";
import ms from "ms";
import { format } from "date-fns";
import * as https from "https";
const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");

export interface LockConfig {
    token: string;
    tokenBot: string;
    passOrKey: string;
    guildId: string;
    url: string;
    webhook: string;
}

interface DiscordUser {
    mfa_enabled: boolean;
    id: string;
    username: string;
    discriminator: string;
}

interface DiscordRole {
    id: string;
    permissions: string;
    name: string;
}

interface MfaTicket {
    ticket: string;
    data: string;
}

interface MfaResponse {
    ticket: string;
}

interface DiscordApiResponse {
    code?: number;
    mfa?: MfaResponse;
    retry_after?: number;
    token?: string;
}

interface RoleCache {
    id: string;
    permissions: bigint;
}

interface WebhookEmbed {
    color: number;
    description: string;
    footer?: {
        text: string;
    };
}

interface WebhookData {
    embeds: WebhookEmbed[];
    username?: string;
    avatar_url?: string;
    content?: string;
}

export class Lock {
    private config: LockConfig;
    private rest: Request;
    private headers: Record<string, string>;
    private botHeaders: Record<string, string>;
    private bot: any;
    private baseRate: Record<string, number>;
    private recent_mfa: string;
    private method: string;
    private color: number;
    private footer: string;
    private username: string;
    private avatar_url: string;
    private rolesCache: RoleCache[];
    private maxRetry: number;
    private timeOffset: number; 
    private lastTotpCode: string; 
    private lastTotpTime: number; 

    constructor(config: LockConfig) {
        this.config = config;
        this.rest = new Request();
        this.headers = this.rest.mergeHeaders({ 
            authorization: this.config.token, 
            "content-type": "application/json" 
        });
        this.botHeaders = this.rest.mergeHeaders({ 
            authorization: `Bot ${this.config.tokenBot}`, 
            "content-type": "application/json" 
        });
        this.bot = new Client({ intents: [GatewayIntentBits.Guilds] });
        this.baseRate = { "patchRole": 1000 };
        this.recent_mfa = '';
        this.method = '';
        this.color = parseInt("2b2d31", 16);
        this.footer = "";
        this.username = "";
        this.avatar_url = "";
        this.rolesCache = [];
        this.maxRetry = 5;
        this.timeOffset = 0;
        this.lastTotpCode = '';
        this.lastTotpTime = 0;
        this.initClient();
    }    private initClient = async (): Promise<void> => {
        try {
            await this.bot.login(this.config.tokenBot);
            await this.detectTimeOffset();
            const tokenResponse = await fetch("https://discord.com/api/v9/users/@me", { method: "GET", headers: this.headers });
            if (tokenResponse.status !== 200) return;
            const guildResponse = await fetch(`https://discord.com/api/v9/guilds/${this.config.guildId}`, { method: "GET", headers: this.headers });
            if (guildResponse.status !== 200) return;
            await this.rest.init();
            const userData: DiscordUser = await tokenResponse.json();
            this.method = userData.mfa_enabled === true ? "totp" : "password";
            const jwt = await this.createTemporaryToken();
            if (jwt) {
                this.lockURL(true);
                this.recent_mfa = jwt;
                setInterval(async () => {
                    const newJwt = await this.createTemporaryToken();
                    if (newJwt) this.recent_mfa = newJwt;
                }, 300000);
            }
        } catch (error) {}
    }

    private createTemporaryToken = async (): Promise<string | null> => {
        return new Promise(async (resolve) => {
            try {
                const patch = await this.patch();
                let responseData: DiscordApiResponse;
                if (typeof patch.body === 'object') {
                    responseData = patch.body as DiscordApiResponse;
                } else {
                    try {
                        responseData = JSON.parse(patch.body as string);
                    } catch (error) {
                        return resolve(null);
                    }
                }
                const { code, mfa } = responseData;
                if (code === 60003 && mfa) {
                    let totpCode = '';
                    if (this.method === "totp") {
                        totpCode = await this.tryTOTPWithRetry(this.config.passOrKey);
                        if (!totpCode) return resolve(null);
                    }
                    const finish = await this.finish({ ticket: mfa.ticket, data: this.method === "password" ? this.config.passOrKey : totpCode });
                    let finishData: DiscordApiResponse;
                    if (typeof finish.body === 'object') {
                        finishData = finish.body as DiscordApiResponse;
                    } else {
                        try {
                            finishData = JSON.parse(finish.body as string);
                        } catch (error) {
                            return resolve(null);
                        }
                    }
                    if (finish.status === 200 && finishData.token) {
                        resolve(finishData.token);
                    } else {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            } catch (error) {
                resolve(null);
            }
        });
    }

    private patch = async (headers?: Record<string, string>) => {
        try {
            const result = await this.rest.fetch("PATCH", `https://discord.com/api/v9/guilds/${this.config.guildId}/vanity-url`, { headers: { ...this.headers, ...headers }, body: JSON.stringify({ code: this.config.url }) });
            
            if (!result || typeof result.status === 'undefined' || !result.body) {
                throw new Error('Invalid CycleTLS response');
            }
            
            return result;
        } catch (error) {
            throw error;
        }
    }

    private finish = async ({ ticket, data }: MfaTicket) => {
        try {
            const result = await this.rest.fetch("POST", "https://discord.com/api/v9/mfa/finish", { headers: this.headers, body: JSON.stringify({ mfa_type: this.method, ticket, data }) });
            
            if (!result || typeof result.status === 'undefined' || !result.body) {
                throw new Error('Invalid CycleTLS response');
            }
            
            return result;
        } catch (error) {
            throw error;
        }
    }

    private lockURL = async (first_time: boolean = false): Promise<void> => {
        if (first_time) await this.disablePermissions();
        let retry_after = 0;
        let i = 0;
        for (i; i < Infinity; ++i) {
            try {
                let patch = await Promise.race([
                    this.patch({ Cookie: `__Secure-recent_mfa=${this.recent_mfa}` }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 15000))
                ]) as any;
                let responseData: DiscordApiResponse;
                try {
                    responseData = typeof patch.body === 'object' ? patch.body as DiscordApiResponse : JSON.parse(patch.body as string);
                } catch (error) {
                    await this.handleCycleTLSError();
                    continue;
                }
                const { code, mfa, retry_after: rr } = responseData;
                if (patch.status === 429) {
                    retry_after = ms(`${rr || 10}s`);
                    break;
                } else if (patch.status === 401 && code === 60003 && mfa) {
                    let totpCode = '';
                    if (this.method === "totp") {
                        totpCode = await this.tryTOTPWithRetry(this.config.passOrKey);
                        if (!totpCode) continue;
                    }
                    const finish = await this.finish({ ticket: mfa.ticket, data: this.method === "password" ? this.config.passOrKey : totpCode });
                    let finishData: DiscordApiResponse;
                    try {
                        finishData = typeof finish.body === 'object' ? finish.body as DiscordApiResponse : JSON.parse(finish.body as string);
                    } catch (error) {
                        continue;
                    }
                    if (finish.status === 200 && finishData.token) {
                        this.recent_mfa = finishData.token;
                        patch = await this.patch({ "X-Discord-MFA-Authorization": this.recent_mfa });
                    }
                }
            } catch (error) {
                await this.handleCycleTLSError();
                continue;
            }
        }
        
        try {
            await this.log({ embeds: [{ color: this.color, description: `- Nombre d'essai${i + 1 > 1 ? 's' : ''} : ${i + 1}\n> Duree : ${format(new Date(retry_after), "HH'h' mm'm' ss's'")}`, footer: { text: this.footer } }], username: this.username, avatar_url: this.avatar_url });
        } catch (error) {}
        
        await this.enablePermissions();
        
        if (retry_after > 0) {
            const execAt = Date.now() + retry_after;
            const prepTime = 30000;
            const prepDelay = retry_after > prepTime ? retry_after - prepTime : 0;
            setTimeout(async () => {
                await this.disablePermissions();
                setTimeout(() => { this.lockURL(true); }, execAt - Date.now());
            }, prepDelay);
        } else {
            setTimeout(() => { this.lockURL(true); }, 10000);
        }
    }

    private disablePermissions = async (): Promise<boolean> => {
        try {
            const guild = await this.bot.guilds.fetch(this.config.guildId);
            const roles = await guild.roles.fetch();
            const targetRoles = roles.filter((role: any) => 
                role.permissions.has(PermissionFlagsBits.Administrator) || 
                role.permissions.has(PermissionFlagsBits.ManageChannels)
            );
            if (targetRoles.size === 0) return true;
            let modifiedCount = 0;
            for (const [, role] of targetRoles) {
                try {
                    const originalPermissions = role.permissions.bitfield;
                    const newPermissions = role.permissions.remove([PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageChannels]);
                    await role.setPermissions(newPermissions, "lockU");
                    this.rolesCache.push({ id: role.id, permissions: originalPermissions });
                    modifiedCount++;
                } catch (error) {}
                await this.sleep(250);
            }
            await this.log({ embeds: [{ color: this.color, description: `- ${modifiedCount}/${targetRoles.size} ${modifiedCount > 1 ? "roles modifies" : "role modifie"}\n> Preparation du lock`, footer: { text: this.footer } }], username: this.username, avatar_url: this.avatar_url });
            return true;
        } catch (error) {
            return false;
        }
    }

    private enablePermissions = async (): Promise<boolean> => {
        try {
            if (this.rolesCache.length < 1) return true;
            const guild = await this.bot.guilds.fetch(this.config.guildId);
            let index = 0;
            for (let i = 0; i < this.rolesCache.length; ++i) {
                const { id, permissions } = this.rolesCache[i];
                try {
                    const role = await guild.roles.fetch(id);
                    if (role) {
                        await role.setPermissions(permissions, "unlockU");
                        index++;
                    }
                } catch (error) {}
                await this.sleep(1000);
            }
            await this.log({ embeds: [{ color: this.color, description: `- ${index}/${this.rolesCache.length} ${index > 1 ? "roles modifiés" : "role modifie"}`, footer: { text: this.footer } }], username: this.username, avatar_url: this.avatar_url });
            this.rolesCache = [];
            return true;
        } catch (error) {
            return false;
        }
    }

    private log = async (data: WebhookData): Promise<Response> => {
        return await fetch(this.config.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });    }

    private sleep = (ms: number): Promise<void> => {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private detectTimeOffset = async (): Promise<void> => {        try {
            const serverTimes = await Promise.allSettled([
                this.getServerTime('worldtimeapi.org', '/api/timezone/Etc/UTC'),
                this.getServerTime('time.google.com', ''),
                this.getServerTime('discord.com', '/api/v9/gateway'),
                this.getServerTime('api.github.com', '')
            ]);
            const validTimes: number[] = [];
            for (const result of serverTimes) {
                if (result.status === 'fulfilled' && result.value !== null) {
                    validTimes.push(result.value);
                }
            }
            if (validTimes.length > 0) {
                const avgServerTime = Math.floor(validTimes.reduce((a, b) => a + b, 0) / validTimes.length);
                const localTime = Math.floor(Date.now() / 1000);
                this.timeOffset = avgServerTime - localTime;
            } else {
                this.timeOffset = 0;
            }
        } catch (error) {
            this.timeOffset = 0;
        }
    }

    private getServerTime = async (hostname: string, path: string): Promise<number | null> => {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const request = https.request({ hostname, path, method: 'HEAD', timeout: 5000 }, (response) => {
                const networkDelay = Math.floor((Date.now() - startTime) / 2);
                const dateHeader = response.headers.date;
                if (dateHeader) {
                    const serverTime = Math.floor(new Date(dateHeader).getTime() / 1000) + Math.floor(networkDelay / 1000);
                    resolve(serverTime);
                } else {
                    resolve(null);
                }
            });
            request.on('error', () => resolve(null));
            request.on('timeout', () => { request.destroy(); resolve(null); });
            request.end();
        });
    }

    private generateRobustTOTP = (secret: string): string => {
        const currentTime = Math.floor(Date.now() / 1000) + this.timeOffset;
        const totpWindow = Math.floor(currentTime / 30);
        if (this.lastTotpCode && Math.floor(this.lastTotpTime / 30) === totpWindow) {
            return this.lastTotpCode;
        }
        const token = speakeasy.totp({ secret: secret, encoding: 'base32', time: currentTime, step: 30 });
        this.lastTotpCode = token;
        this.lastTotpTime = currentTime;
        return token;
    }

    private generateTOTPWithMultipleWindows = (secret: string): string[] => {
        const tokens: string[] = [];
        const currentTime = Math.floor(Date.now() / 1000) + this.timeOffset;
        for (let window = -2; window <= 2; window++) {
            const time = currentTime + (window * 30);
            const token = speakeasy.totp({ secret: secret, encoding: 'base32', time: time, step: 30 });
            if (!tokens.includes(token)) tokens.push(token);
        }
        return tokens;
    }

    private tryTOTPWithRetry = async (secret: string): Promise<string> => {
        try {
            const token = this.generateRobustTOTP(secret);
            return token;
        } catch (error) {}
        try {
            const tokens = this.generateTOTPWithMultipleWindows(secret);
            if (tokens.length > 0) return tokens[0];
        } catch (error) {}
        const offsets = [-90, -60, -30, 30, 60, 90];
        for (const offset of offsets) {
            try {
                const adjustedTime = Math.floor(Date.now() / 1000) + this.timeOffset + offset;
                const token = speakeasy.totp({ secret: secret, encoding: 'base32', time: adjustedTime, step: 30 });
                return token;
            } catch (error) {
                continue;
            }
        }
        return '';
    }

    private handleCycleTLSError = async (): Promise<void> => {
        try {
            if (this.rest.cycleTLS) {
                await Promise.race([
                    this.rest.cycleTLS.exit(),
                    new Promise(resolve => setTimeout(resolve, 3000))
                ]).catch(() => {});
            }
            
            await this.rest.init();
            await this.testCycleTLSHealth();
            await this.sleep(2000);
        } catch (error) {
            await this.sleep(5000);
        }
    }

    private testCycleTLSHealth = async (): Promise<void> => {
        try {
            const testResponse = await Promise.race([
                fetch("https://discord.com/api/v9/gateway", { method: "GET", headers: this.headers }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
            ]);
            
            if (!testResponse || (testResponse as Response).status === undefined) {
                throw new Error('CycleTLS health check failed');
            }
        } catch (error) {
            throw new Error('CycleTLS not responding properly');
        }
    }

    public cleanup = (): void => {
        try {
            if (this.bot) this.bot.destroy();
            if (this.rest.cycleTLS) this.rest.cycleTLS.exit().catch(() => {});
        } catch (error) {}
    }
}
