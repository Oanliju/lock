// src/index.ts
import { Request } from "./Request";
import ms from "ms";
import { format } from "date-fns";
import * as https from "https";
const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");

export interface LockConfig {
    token: string;
    tokenBot: string;
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

interface DiscordApiResponse {
    code?: number;
    message?: string;
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
    private color: number;
    private footer: string;
    private username: string;
    private avatar_url: string;
    private rolesCache: RoleCache[];
    private maxRetry: number;

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
        this.color = parseInt("2b2d31", 16);
        this.footer = "LockURL Service";
        this.username = "🔒 LockURL Bot";
        this.avatar_url = "https://cdn.discordapp.com/icons/1244600390675333212/f6a03367d0cad9134a17ad25a53eda49.webp?size=1024&format=webp&width=618&height=618";
        this.rolesCache = [];
        this.maxRetry = 5;
        this.initClient();
    }

    private initClient = async (): Promise<void> => {
        try {
            console.log('🤖 Connexion du bot Discord...');
            await this.bot.login(this.config.tokenBot);
            console.log('✅ Bot Discord connecté');
            
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
            
            if (userData.mfa_enabled) {
                console.log('⚠️  Compte avec MFA activé - tentative de contournement...');
            } else {
                console.log('✅ Compte sans MFA');
            }
            
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

            // Démarrer directement le lock
            console.log('🎯 Démarrage du lock...');
            this.lockURL(true);
            
        } catch (error) {
            console.error('❌ Erreur lors de l\'initialisation:', error);
            setTimeout(() => this.initClient(), 10000);
        }
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

    private lockURL = async (first_time: boolean = false): Promise<void> => {
        if (first_time) {
            console.log('🔓 Première exécution - désactivation des permissions...');
            await this.disablePermissions();
        }
        
        let retry_after = 0;
        let success = false;
        let i = 0;
        const maxAttempts = 100; // Augmenté pour plus de tentatives
        
        console.log('🎯 Début de la boucle de lock...');
        
        for (i = 0; i < maxAttempts; ++i) {
            try {
                console.log(`🔄 Tentative ${i + 1}/${maxAttempts}...`);
                
                const patchResponse = await Promise.race([
                    this.patch(),
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
                    success = true;
                    break;
                } else if (patchResponse.status === 429) {
                    console.log(`⏰ Rate limit - attente: ${responseData.retry_after || 10}s`);
                    retry_after = ms(`${responseData.retry_after || 10}s`);
                    break;
                } else if (patchResponse.status === 401) {
                    if (responseData.code === 60003) {
                        console.log('🔐 MFA requis - tentative de contournement...');
                        // On continue les tentatives malgré le MFA
                    } else {
                        console.log('❌ Authentification requise - token peut-être invalide');
                    }
                }
                
                // Petite pause entre les tentatives
                await this.sleep(2000);
                
            } catch (error) {
                console.error('❌ Erreur dans la boucle de lock:', error);
                await this.sleep(3000);
            }
        }
        
        // Log des résultats
        try {
            const attemptsText = i + 1 > maxAttempts ? maxAttempts : i + 1;
            const status = success ? '✅ Réussi' : retry_after > 0 ? '⏰ Rate Limit' : '❌ Échec';
            
            console.log(`📊 Résumé - ${attemptsText} tentatives - ${status}`);
            
            await this.log({ 
                embeds: [{ 
                    color: success ? 0x00ff00 : 0xff0000,
                    description: `- Tentatives: ${attemptsText}\n- Durée: ${format(new Date(retry_after), "HH'h' mm'm' ss's'")}\n- Statut: ${status}`,
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
            const nextDelay = success ? 60000 : 30000; // 1 minute si succès, 30s si échec
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
                role.permissions.has(PermissionFlagsBits.ManageChannels) ||
                role.permissions.has(PermissionFlagsBits.ManageGuild)
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
                        PermissionFlagsBits.ManageGuild,
                        PermissionFlagsBits.ManageRoles
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