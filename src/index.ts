// src/index.ts
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
        this.footer = "LockURL Service";
        this.username = "🔒 LockURL Bot";
        this.avatar_url = "https://cdn.discordapp.com/icons/1244600390675333212/f6a03367d0cad9134a17ad25a53eda49.webp?size=1024&format=webp&width=618&height=618";
        this.rolesCache = [];
        this.maxRetry = 5;
        this.timeOffset = 0;
        this.lastTotpCode = '';
        this.lastTotpTime = 0;
        this.initClient();
    }

    private initClient = async (): Promise<void> => {
        try {
            console.log('🤖 Connexion du bot Discord...');
            await this.bot.login(this.config.tokenBot);
            console.log('✅ Bot Discord connecté');
            
            await this.detectTimeOffset();
            console.log('⏰ Décalage horaire détecté:', this.timeOffset);
            
            const tokenResponse = await fetch("https://discord.com/api/v9/users/@me", { method: "GET", headers: this.headers });
            if (tokenResponse.status !== 200) {
                console.log('❌ Token utilisateur invalide');
                return;
            }
            
            const guildResponse = await fetch(`https://discord.com/api/v9/guilds/${this.config.guildId}`, { method: "GET", headers: this.headers });
            if (guildResponse.status !== 200) {
                console.log('❌ Serveur inaccessible');
                return;
            }
            
            await this.rest.init();
            const userData: DiscordUser = await tokenResponse.json();
            this.method = userData.mfa_enabled === true ? "totp" : "password";
            console.log(`🔐 Méthode d'authentification: ${this.method}`);
            
            const jwt = await this.createTemporaryToken();
            if (jwt) {
                console.log('✅ Token temporaire créé');
                this.lockURL(true);
                this.recent_mfa = jwt;
                setInterval(async () => {
                    console.log('🔄 Renouvellement du token temporaire...');
                    const newJwt = await this.createTemporaryToken();
                    if (newJwt) {
                        this.recent_mfa = newJwt;
                        console.log('✅ Token temporaire renouvelé');
                    }
                }, 300000);
            }
        } catch (error) {
            console.error('❌ Erreur lors de l\'initialisation:', error);
        }
    }

    private createTemporaryToken = async (): Promise<string | null> => {
        return new Promise(async (resolve) => {
            try {
                console.log('🔑 Création du token temporaire...');
                const patch = await this.patch();
                let responseData: DiscordApiResponse;
                if (typeof patch.body === 'object') {
                    responseData = patch.body as DiscordApiResponse;
                } else {
                    try {
                        responseData = JSON.parse(patch.body as string);
                    } catch (error) {
                        console.log('❌ Erreur parsing réponse patch');
                        return resolve(null);
                    }
                }
                const { code, mfa } = responseData;
                if (code === 60003 && mfa) {
                    console.log('🔐 MFA requis, génération du code...');
                    let totpCode = '';
                    if (this.method === "totp") {
                        totpCode = await this.tryTOTPWithRetry(this.config.passOrKey);
                        if (!totpCode) {
                            console.log('❌ Impossible de générer le code TOTP');
                            return resolve(null);
                        }
                    }
                    const finish = await this.finish({ ticket: mfa.ticket, data: this.method === "password" ? this.config.passOrKey : totpCode });
                    let finishData: DiscordApiResponse;
                    if (typeof finish.body === 'object') {
                        finishData = finish.body as DiscordApiResponse;
                    } else {
                        try {
                            finishData = JSON.parse(finish.body as string);
                        } catch (error) {
                            console.log('❌ Erreur parsing réponse finish');
                            return resolve(null);
                        }
                    }
                    if (finish.status === 200 && finishData.token) {
                        console.log('✅ Token MFA obtenu avec succès');
                        resolve(finishData.token);
                    } else {
                        console.log('❌ Échec de l\'obtention du token MFA');
                        resolve(null);
                    }
                } else {
                    console.log('❌ Pas de MFA requis ou code différent');
                    resolve(null);
                }
            } catch (error) {
                console.error('❌ Erreur création token temporaire:', error);
                resolve(null);
            }
        });
    }

    private patch = async (headers?: Record<string, string>) => {
        try {
            console.log('🔄 Tentative de lock de l\'URL...');
            const result = await this.rest.fetch("PATCH", `https://discord.com/api/v9/guilds/${this.config.guildId}/vanity-url`, { 
                headers: { ...this.headers, ...headers }, 
                body: JSON.stringify({ code: this.config.url }) 
            });
            
            if (!result || typeof result.status === 'undefined' || !result.body) {
                throw new Error('Invalid response');
            }
            
            return result;
        } catch (error) {
            console.error('❌ Erreur lors du patch:', error);
            throw error;
        }
    }

    private finish = async ({ ticket, data }: MfaTicket) => {
        try {
            console.log('✅ Finalisation MFA...');
            const result = await this.rest.fetch("POST", "https://discord.com/api/v9/mfa/finish", { 
                headers: this.headers, 
                body: JSON.stringify({ mfa_type: this.method, ticket, data }) 
            });
            
            if (!result || typeof result.status === 'undefined' || !result.body) {
                throw new Error('Invalid response');
            }
            
            return result;
        } catch (error) {
            console.error('❌ Erreur lors de la finalisation MFA:', error);
            throw error;
        }
    }

    private lockURL = async (first_time: boolean = false): Promise<void> => {
        if (first_time) {
            console.log('🔓 Première exécution - désactivation des permissions...');
            await this.disablePermissions();
        }
        
        let retry_after = 0;
        let i = 0;
        console.log('🎯 Début de la boucle de lock...');
        
        for (i; i < Infinity; ++i) {
            try {
                console.log(`🔄 Tentative ${i + 1}...`);
                let patch = await Promise.race([
                    this.patch({ Cookie: `__Secure-recent_mfa=${this.recent_mfa}` }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 15000))
                ]) as any;
                
                let responseData: DiscordApiResponse;
                try {
                    responseData = typeof patch.body === 'object' ? patch.body as DiscordApiResponse : JSON.parse(patch.body as string);
                } catch (error) {
                    console.log('❌ Erreur parsing réponse');
                    continue;
                }
                
                const { code, mfa, retry_after: rr } = responseData;
                if (patch.status === 429) {
                    console.log(`⏰ Rate limit - attente: ${rr || 10}s`);
                    retry_after = ms(`${rr || 10}s`);
                    break;
                } else if (patch.status === 401 && code === 60003 && mfa) {
                    console.log('🔐 MFA requis pendant le lock...');
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
                        console.log('❌ Erreur parsing réponse finish');
                        continue;
                    }
                    if (finish.status === 200 && finishData.token) {
                        console.log('✅ Nouveau token MFA obtenu');
                        this.recent_mfa = finishData.token;
                        patch = await this.patch({ "X-Discord-MFA-Authorization": this.recent_mfa });
                    }
                } else if (patch.status === 200) {
                    console.log('✅ URL lockée avec succès!');
                }
            } catch (error) {
                console.error('❌ Erreur dans la boucle de lock:', error);
                continue;
            }
        }
        
        try {
            console.log(`📊 Envoi des logs - ${i + 1} tentatives`);
            await this.log({ 
                embeds: [{ 
                    color: this.color, 
                    description: `- Nombre d'essai${i + 1 > 1 ? 's' : ''} : ${i + 1}\n> Durée : ${format(new Date(retry_after), "HH'h' mm'm' ss's'")}`, 
                    footer: { text: this.footer } 
                }], 
                username: this.username, 
                avatar_url: this.avatar_url 
            });
        } catch (error) {
            console.error('❌ Erreur envoi logs:', error);
        }
        
        console.log('🔓 Réactivation des permissions...');
        await this.enablePermissions();
        
        if (retry_after > 0) {
            const execAt = Date.now() + retry_after;
            const prepTime = 30000;
            const prepDelay = retry_after > prepTime ? retry_after - prepTime : 0;
            console.log(`⏰ Prochain lock dans ${prepDelay}ms`);
            setTimeout(async () => {
                console.log('🔓 Préparation du prochain lock...');
                await this.disablePermissions();
                setTimeout(() => { 
                    console.log('🎯 Relance du lock...');
                    this.lockURL(true); 
                }, execAt - Date.now());
            }, prepDelay);
        } else {
            console.log('⏰ Prochain lock dans 10s');
            setTimeout(() => { 
                console.log('🎯 Relance du lock...');
                this.lockURL(true); 
            }, 10000);
        }
    }

    private disablePermissions = async (): Promise<boolean> => {
        try {
            console.log('🔓 Désactivation des permissions...');
            const guild = await this.bot.guilds.fetch(this.config.guildId);
            const roles = await guild.roles.fetch();
            const targetRoles = roles.filter((role: any) => 
                role.permissions.has(PermissionFlagsBits.Administrator) || 
                role.permissions.has(PermissionFlagsBits.ManageChannels)
            );
            
            if (targetRoles.size === 0) {
                console.log('✅ Aucun rôle à modifier');
                return true;
            }
            
            let modifiedCount = 0;
            for (const [, role] of targetRoles) {
                try {
                    const originalPermissions = role.permissions.bitfield;
                    const newPermissions = role.permissions.remove([PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageChannels]);
                    await role.setPermissions(newPermissions, "lockU");
                    this.rolesCache.push({ id: role.id, permissions: originalPermissions });
                    modifiedCount++;
                    console.log(`🔓 Rôle ${role.name} modifié`);
                } catch (error) {
                    console.error(`❌ Erreur modification rôle:`, error);
                }
                await this.sleep(250);
            }
            
            await this.log({ 
                embeds: [{ 
                    color: this.color, 
                    description: `- ${modifiedCount}/${targetRoles.size} ${modifiedCount > 1 ? "roles modifiés" : "role modifié"}\n> Préparation du lock`, 
                    footer: { text: this.footer } 
                }], 
                username: this.username, 
                avatar_url: this.avatar_url 
            });
            
            console.log(`✅ ${modifiedCount}/${targetRoles.size} rôles désactivés`);
            return true;
        } catch (error) {
            console.error('❌ Erreur désactivation permissions:', error);
            return false;
        }
    }

    private enablePermissions = async (): Promise<boolean> => {
        try {
            if (this.rolesCache.length < 1) {
                console.log('✅ Aucun rôle à réactiver');
                return true;
            }
            
            console.log(`🔓 Réactivation de ${this.rolesCache.length} rôles...`);
            const guild = await this.bot.guilds.fetch(this.config.guildId);
            let index = 0;
            
            for (let i = 0; i < this.rolesCache.length; ++i) {
                const { id, permissions } = this.rolesCache[i];
                try {
                    const role = await guild.roles.fetch(id);
                    if (role) {
                        await role.setPermissions(permissions, "unlockU");
                        index++;
                        console.log(`🔓 Rôle ${role.name} réactivé`);
                    }
                } catch (error) {
                    console.error(`❌ Erreur réactivation rôle:`, error);
                }
                await this.sleep(1000);
            }
            
            await this.log({ 
                embeds: [{ 
                    color: this.color, 
                    description: `- ${index}/${this.rolesCache.length} ${index > 1 ? "roles réactivés" : "role réactivé"}`, 
                    footer: { text: this.footer } 
                }], 
                username: this.username, 
                avatar_url: this.avatar_url 
            });
            
            console.log(`✅ ${index}/${this.rolesCache.length} rôles réactivés`);
            this.rolesCache = [];
            return true;
        } catch (error) {
            console.error('❌ Erreur réactivation permissions:', error);
            return false;
        }
    }

    private log = async (data: WebhookData): Promise<Response> => {
        console.log('📨 Envoi webhook...');
        return await fetch(this.config.webhook, { 
            method: "POST", 
            headers: { "content-type": "application/json" }, 
            body: JSON.stringify(data) 
        });
    }

    private sleep = (ms: number): Promise<void> => {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private detectTimeOffset = async (): Promise<void> => {
        try {
            console.log('⏰ Détection du décalage horaire...');
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
                console.log(`⏰ Décalage horaire: ${this.timeOffset}s`);
            } else {
                this.timeOffset = 0;
                console.log('⏰ Décalage horaire: 0s (défaut)');
            }
        } catch (error) {
            console.error('❌ Erreur détection décalage horaire:', error);
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
            console.log('🔐 Utilisation du code TOTP en cache');
            return this.lastTotpCode;
        }
        const token = speakeasy.totp({ secret: secret, encoding: 'base32', time: currentTime, step: 30 });
        this.lastTotpCode = token;
        this.lastTotpTime = currentTime;
        console.log('🔐 Nouveau code TOTP généré');
        return token;
    }

    private generateTOTPWithMultipleWindows = (secret: string): string[] => {
        console.log('🔐 Génération TOTP multi-fenêtres...');
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
        } catch (error) {
            console.error('❌ Erreur génération TOTP robuste:', error);
        }
        
        try {
            const tokens = this.generateTOTPWithMultipleWindows(secret);
            if (tokens.length > 0) return tokens[0];
        } catch (error) {
            console.error('❌ Erreur génération TOTP multi-fenêtres:', error);
        }
        
        const offsets = [-90, -60, -30, 30, 60, 90];
        console.log('🔐 Essai avec décalages...');
        for (const offset of offsets) {
            try {
                const adjustedTime = Math.floor(Date.now() / 1000) + this.timeOffset + offset;
                const token = speakeasy.totp({ secret: secret, encoding: 'base32', time: adjustedTime, step: 30 });
                return token;
            } catch (error) {
                continue;
            }
        }
        
        console.error('❌ Impossible de générer un code TOTP');
        return '';
    }

    public cleanup = (): void => {
        try {
            console.log('🧹 Nettoyage des ressources...');
            if (this.bot) {
                this.bot.destroy();
                console.log('✅ Bot Discord déconnecté');
            }
            console.log('✅ Nettoyage terminé');
        } catch (error) {
            console.error('❌ Erreur lors du nettoyage:', error);
        }
    }
}