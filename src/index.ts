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
    code?: string;
    password?: string;
}

interface MfaResponse {
    ticket: string;
}

interface DiscordApiResponse {
    code?: number;
    message?: string;
    mfa?: boolean;
    mfa_ticket?: string;
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
        this.bot = new Client({ 
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] 
        });
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
            
            // Vérifier le token utilisateur
            const tokenResponse = await fetch("https://discord.com/api/v9/users/@me", { 
                method: "GET", 
                headers: this.headers 
            });
            
            if (tokenResponse.status !== 200) {
                console.log('❌ Token utilisateur invalide - Statut:', tokenResponse.status);
                const errorText = await tokenResponse.text();
                console.log('❌ Erreur détaillée:', errorText);
                return;
            }
            
            const userData: DiscordUser = await tokenResponse.json();
            console.log('👤 Utilisateur connecté:', userData.username);
            this.method = userData.mfa_enabled ? "totp" : "password";
            console.log(`🔐 Méthode d'authentification: ${this.method}`);
            
            // Vérifier l'accès au serveur
            const guildResponse = await fetch(`https://discord.com/api/v9/guilds/${this.config.guildId}`, { 
                method: "GET", 
                headers: this.headers 
            });
            
            if (guildResponse.status !== 200) {
                console.log('❌ Serveur inaccessible - Statut:', guildResponse.status);
                const errorText = await guildResponse.text();
                console.log('❌ Erreur détaillée:', errorText);
                return;
            }
            
            console.log('✅ Serveur accessible');
            await this.rest.init();

            // Créer le token temporaire et démarrer le lock
            const jwt = await this.createTemporaryToken();
            if (jwt) {
                console.log('✅ Token temporaire créé avec succès');
                this.recent_mfa = jwt;
                this.lockURL(true);
                
                // Renouveler le token périodiquement
                setInterval(async () => {
                    console.log('🔄 Renouvellement du token temporaire...');
                    const newJwt = await this.createTemporaryToken();
                    if (newJwt) {
                        this.recent_mfa = newJwt;
                        console.log('✅ Token temporaire renouvelé');
                    } else {
                        console.log('❌ Échec du renouvellement du token');
                    }
                }, 300000); // 5 minutes
            } else {
                console.log('❌ Impossible de créer le token temporaire, réessai dans 10s');
                setTimeout(() => this.initClient(), 10000);
            }
        } catch (error) {
            console.error('❌ Erreur lors de l\'initialisation:', error);
            setTimeout(() => this.initClient(), 10000);
        }
    }

    private createTemporaryToken = async (): Promise<string | null> => {
        return new Promise(async (resolve) => {
            try {
                console.log('🔑 Tentative de création du token temporaire...');
                
                // D'abord, essayer de récupérer l'URL vanity pour déclencher le MFA
                const patchResponse = await this.patch();
                
                if (patchResponse.status === 200) {
                    console.log('✅ URL déjà lockée, pas besoin de MFA');
                    resolve("no-mfa-needed");
                    return;
                }

                let responseData: DiscordApiResponse;
                if (typeof patchResponse.body === 'object') {
                    responseData = patchResponse.body as DiscordApiResponse;
                } else {
                    try {
                        responseData = JSON.parse(patchResponse.body as string);
                    } catch (error) {
                        console.log('❌ Erreur parsing réponse patch:', patchResponse.body);
                        return resolve(null);
                    }
                }

                console.log('📋 Réponse patch:', responseData);

                // Vérifier si MFA est requis
                if (responseData.code === 60003 || responseData.mfa) {
                    console.log('🔐 MFA requis, traitement...');
                    
                    let mfaTicket = responseData.mfa_ticket;
                    if (!mfaTicket && (responseData as any).ticket) {
                        mfaTicket = (responseData as any).ticket;
                    }

                    if (!mfaTicket) {
                        console.log('❌ Ticket MFA non trouvé dans la réponse');
                        return resolve(null);
                    }

                    console.log('🎫 Ticket MFA obtenu:', mfaTicket);

                    let mfaData: any = {};
                    if (this.method === "totp") {
                        const totpCode = await this.tryTOTPWithRetry(this.config.passOrKey);
                        if (!totpCode) {
                            console.log('❌ Impossible de générer le code TOTP');
                            return resolve(null);
                        }
                        mfaData.code = totpCode;
                    } else {
                        // Mode password
                        mfaData.password = this.config.passOrKey;
                    }

                    // Utiliser le bon endpoint MFA
                    const finishResponse = await this.finishMFA(mfaTicket, mfaData);
                    
                    if (finishResponse.status === 200) {
                        let finishData: DiscordApiResponse;
                        if (typeof finishResponse.body === 'object') {
                            finishData = finishResponse.body as DiscordApiResponse;
                        } else {
                            try {
                                finishData = JSON.parse(finishResponse.body as string);
                            } catch (error) {
                                console.log('❌ Erreur parsing réponse finish');
                                return resolve(null);
                            }
                        }

                        if (finishData.token) {
                            console.log('✅ Token MFA obtenu avec succès');
                            resolve(finishData.token);
                        } else {
                            console.log('❌ Token non trouvé dans la réponse finish');
                            resolve(null);
                        }
                    } else {
                        console.log(`❌ Échec de l'authentification MFA - Statut: ${finishResponse.status}`);
                        console.log('📋 Réponse finish:', finishResponse.body);
                        resolve(null);
                    }
                } else {
                    console.log('❌ Pas de MFA requis ou code différent:', responseData.code);
                    resolve(null);
                }
            } catch (error) {
                console.error('❌ Erreur création token temporaire:', error);
                resolve(null);
            }
        });
    }

    private patch = async (headers?: Record<string, string>): Promise<any> => {
        try {
            console.log('🔄 Tentative de lock de l\'URL...');
            const result = await this.rest.fetch(
                "PATCH", 
                `https://discord.com/api/v9/guilds/${this.config.guildId}/vanity-url`, 
                { 
                    headers: { ...this.headers, ...headers }, 
                    body: JSON.stringify({ code: this.config.url }) 
                }
            );
            
            return result;
        } catch (error) {
            console.error('❌ Erreur lors du patch:', error);
            throw error;
        }
    }

    private finishMFA = async (ticket: string, mfaData: any): Promise<any> => {
        try {
            console.log('✅ Finalisation MFA...');
            
            const payload: any = {
                ticket: ticket
            };

            if (this.method === "totp") {
                payload.code = mfaData.code;
            } else {
                payload.password = mfaData.password;
            }

            console.log('📦 Payload MFA:', payload);

            const result = await this.rest.fetch(
                "POST", 
                "https://discord.com/api/v9/auth/mfa/totp", 
                { 
                    headers: this.headers, 
                    body: JSON.stringify(payload) 
                }
            );
            
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
        const maxAttempts = 50; // Limite pour éviter les boucles infinies
        
        console.log('🎯 Début de la boucle de lock...');
        
        for (i = 0; i < maxAttempts; ++i) {
            try {
                console.log(`🔄 Tentative ${i + 1}/${maxAttempts}...`);
                
                let patchResponse = await Promise.race([
                    this.patch({ 
                        Cookie: `__Secure-recent_mfa=${this.recent_mfa}`,
                        "X-Discord-MFA-Authorization": this.recent_mfa 
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 30000))
                ]) as any;
                
                let responseData: DiscordApiResponse;
                try {
                    responseData = typeof patchResponse.body === 'object' 
                        ? patchResponse.body as DiscordApiResponse 
                        : JSON.parse(patchResponse.body as string);
                } catch (error) {
                    console.log('❌ Erreur parsing réponse patch');
                    continue;
                }

                console.log(`📊 Statut: ${patchResponse.status}, Code: ${responseData.code}`);

                if (patchResponse.status === 200) {
                    console.log('🎉 SUCCÈS: URL lockée avec succès!');
                    break;
                } else if (patchResponse.status === 429) {
                    console.log(`⏰ Rate limit - attente: ${responseData.retry_after || 10}s`);
                    retry_after = ms(`${responseData.retry_after || 10}s`);
                    break;
                } else if (patchResponse.status === 401 && (responseData.code === 60003 || responseData.mfa)) {
                    console.log('🔐 MFA requis pendant le lock...');
                    
                    let mfaTicket = responseData.mfa_ticket;
                    if (!mfaTicket && (responseData as any).ticket) {
                        mfaTicket = (responseData as any).ticket;
                    }

                    if (mfaTicket) {
                        let mfaData: any = {};
                        if (this.method === "totp") {
                            const totpCode = await this.tryTOTPWithRetry(this.config.passOrKey);
                            if (!totpCode) continue;
                            mfaData.code = totpCode;
                        } else {
                            mfaData.password = this.config.passOrKey;
                        }

                        const finishResponse = await this.finishMFA(mfaTicket, mfaData);
                        
                        if (finishResponse.status === 200) {
                            let finishData: DiscordApiResponse;
                            try {
                                finishData = typeof finishResponse.body === 'object' 
                                    ? finishResponse.body as DiscordApiResponse 
                                    : JSON.parse(finishResponse.body as string);
                            } catch (error) {
                                console.log('❌ Erreur parsing réponse finish');
                                continue;
                            }
                            
                            if (finishData.token) {
                                console.log('✅ Nouveau token MFA obtenu');
                                this.recent_mfa = finishData.token;
                                // Réessayer avec le nouveau token
                                patchResponse = await this.patch({ 
                                    "X-Discord-MFA-Authorization": this.recent_mfa 
                                });
                            }
                        }
                    }
                }
                
                // Petite pause entre les tentatives
                await this.sleep(1000);
                
            } catch (error) {
                console.error('❌ Erreur dans la boucle de lock:', error);
                await this.sleep(2000);
            }
        }
        
        // Log des résultats
        try {
            const attemptsText = i + 1 > maxAttempts ? maxAttempts : i + 1;
            console.log(`📊 Résumé - ${attemptsText} tentatives effectuées`);
            
            await this.log({ 
                embeds: [{ 
                    color: this.color, 
                    description: `- Tentatives: ${attemptsText}\n- Durée: ${format(new Date(retry_after), "HH'h' mm'm' ss's'")}\n- Statut: ${retry_after > 0 ? '⏰ En attente' : '✅ Terminé'}`,
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
        
        // Planifier le prochain lock
        if (retry_after > 0) {
            console.log(`⏰ Prochain lock dans ${retry_after}ms`);
            setTimeout(() => {
                console.log('🎯 Relance du lock après rate limit...');
                this.lockURL(true);
            }, retry_after);
        } else {
            const nextDelay = 30000; // 30 secondes
            console.log(`⏰ Prochain lock dans ${nextDelay}ms`);
            setTimeout(() => {
                console.log('🎯 Relance du lock...');
                this.lockURL(true);
            }, nextDelay);
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
                    const newPermissions = role.permissions.remove([
                        PermissionFlagsBits.Administrator, 
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageGuild
                    ]);
                    await role.setPermissions(newPermissions, "LockURL - Security");
                    this.rolesCache.push({ id: role.id, permissions: originalPermissions });
                    modifiedCount++;
                    console.log(`🔓 Rôle "${role.name}" modifié`);
                } catch (error) {
                    console.error(`❌ Erreur modification rôle ${role.name}:`, error);
                }
                await this.sleep(500);
            }
            
            await this.log({ 
                embeds: [{ 
                    color: this.color, 
                    description: `- ${modifiedCount}/${targetRoles.size} rôles désactivés\n- Préparation du lock`, 
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
            let restoredCount = 0;
            
            for (let i = 0; i < this.rolesCache.length; ++i) {
                const { id, permissions } = this.rolesCache[i];
                try {
                    const role = await guild.roles.fetch(id);
                    if (role) {
                        await role.setPermissions(permissions, "LockURL - Restauration");
                        restoredCount++;
                        console.log(`🔓 Rôle "${role.name}" réactivé`);
                    }
                } catch (error) {
                    console.error(`❌ Erreur réactivation rôle ID ${id}:`, error);
                }
                await this.sleep(1000);
            }
            
            await this.log({ 
                embeds: [{ 
                    color: this.color, 
                    description: `- ${restoredCount}/${this.rolesCache.length} rôles réactivés\n- Lock terminé`, 
                    footer: { text: this.footer } 
                }], 
                username: this.username, 
                avatar_url: this.avatar_url 
            });
            
            console.log(`✅ ${restoredCount}/${this.rolesCache.length} rôles réactivés`);
            this.rolesCache = [];
            return true;
        } catch (error) {
            console.error('❌ Erreur réactivation permissions:', error);
            return false;
        }
    }

    private log = async (data: WebhookData): Promise<Response> => {
        try {
            console.log('📨 Envoi webhook...');
            const response = await fetch(this.config.webhook, { 
                method: "POST", 
                headers: { "content-type": "application/json" }, 
                body: JSON.stringify(data) 
            });
            
            if (!response.ok) {
                console.log('❌ Erreur envoi webhook:', response.status);
            } else {
                console.log('✅ Webhook envoyé avec succès');
            }
            
            return response;
        } catch (error) {
            console.error('❌ Erreur envoi webhook:', error);
            throw error;
        }
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
                this.getServerTime('discord.com', '/api/v9/gateway')
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
                console.log(`⏰ Décalage horaire calculé: ${this.timeOffset}s`);
            } else {
                this.timeOffset = 0;
                console.log('⏰ Décalage horaire: 0s (valeur par défaut)');
            }
        } catch (error) {
            console.error('❌ Erreur détection décalage horaire:', error);
            this.timeOffset = 0;
        }
    }

    private getServerTime = async (hostname: string, path: string): Promise<number | null> => {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const request = https.request({ 
                hostname, 
                path, 
                method: 'HEAD', 
                timeout: 5000 
            }, (response) => {
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
            request.on('timeout', () => { 
                request.destroy(); 
                resolve(null); 
            });
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
        
        const token = speakeasy.totp({ 
            secret: secret, 
            encoding: 'base32', 
            time: currentTime, 
            step: 30 
        });
        
        this.lastTotpCode = token;
        this.lastTotpTime = currentTime;
        console.log('🔐 Nouveau code TOTP généré');
        return token;
    }

    private tryTOTPWithRetry = async (secret: string): Promise<string> => {
        try {
            const token = this.generateRobustTOTP(secret);
            console.log('🔐 Code TOTP généré:', token);
            return token;
        } catch (error) {
            console.error('❌ Erreur génération TOTP:', error);
        }
        
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