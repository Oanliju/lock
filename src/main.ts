import { Lock, LockConfig } from './index';
import express from 'express';
import http from 'http';

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration middleware de base
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route health check pour Render
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        message: 'LockURL service is running',
        timestamp: new Date().toISOString(),
        method: process.env.DISCORD_PASSWORD ? 'password_auth' : 'token_only'
    });
});

// Route principale
app.get('/', (req, res) => {
    res.json({
        service: 'Discord Vanity URL Locker',
        status: 'active',
        auth_method: process.env.DISCORD_PASSWORD ? 'password_based' : 'token_only',
        endpoints: ['/health', '/status']
    });
});

// Configuration avec support du mot de passe
const config: LockConfig = {
    token: process.env.DISCORD_TOKEN || "",
    tokenBot: process.env.DISCORD_BOT_TOKEN || "",
    guildId: process.env.GUILD_ID || "",
    url: process.env.VANITY_URL || "",
    webhook: process.env.WEBHOOK_URL || "",
    password: process.env.DISCORD_PASSWORD || undefined
};

let lockInstance: Lock;

const createLockInstance = () => {
    try {
        console.log('🔄 Initialisation du Lock...');
        console.log(`🔐 Méthode d'authentification: ${config.password ? 'MOT DE PASSE + TOKEN' : 'TOKEN SEUL'}`);
        
        lockInstance = new Lock(config);
        console.log('✅ Lock initialisé avec succès');
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation du Lock:', error);
        setTimeout(createLockInstance, 10000);
    }
};

// Démarrer le serveur
const server = http.createServer(app);

server.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur le port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`🔐 Authentification: ${config.password ? 'AVEC MOT DE PASSE' : 'TOKEN SEUL'}`);
    
    // Démarrer l'instance Lock après le démarrage du serveur
    createLockInstance();
});

// Gestion propre de la fermeture
process.on('SIGINT', () => { 
    console.log('🛑 Arrêt du service...');
    if (lockInstance) lockInstance.cleanup(); 
    server.close(() => {
        console.log('✅ Serveur arrêté proprement');
        process.exit(0); 
    });
});

process.on('SIGTERM', () => { 
    console.log('🛑 Arrêt du service (SIGTERM)...');
    if (lockInstance) lockInstance.cleanup(); 
    server.close(() => {
        console.log('✅ Serveur arrêté proprement');
        process.exit(0); 
    });
});

process.on('uncaughtException', (error) => { 
    console.error('❌ Exception non gérée:', error);
    if (lockInstance) lockInstance.cleanup(); 
    setTimeout(createLockInstance, 10000);
});

process.on('unhandledRejection', (reason) => { 
    console.error('❌ Rejet de promesse non géré:', reason);
    if (lockInstance) lockInstance.cleanup(); 
    setTimeout(createLockInstance, 10000);
});