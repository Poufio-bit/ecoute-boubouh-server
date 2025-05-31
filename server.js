// server.js - Serveur WebSocket pour Render.com - VERSION COMPLÈTE AVEC AUDIO + BERNARD_LISTENING
const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware pour parser JSON
app.use(express.json());

// Créer le serveur HTTP
const server = http.createServer(app);

// État des connexions
const connections = {
    bernard: "disconnected",
    liliann: "disconnected",
    active_sessions: 0
};

// Map pour stocker les WebSockets par client
const clientSockets = new Map();

// Route HTTP pour vérifier l'état
app.get('/', (req, res) => {
    res.json({
        service: "Ecoute Boubouh Server",
        version: "2.1.0 - Audio Support + Bernard Listening",
        status: "running",
        connections: connections,
        features: ["identification", "audio_streaming", "real_time_communication", "bernard_listening"],
        timestamp: new Date().toISOString()
    });
});

// Route de santé pour Render
app.get('/health', (req, res) => {
    res.status(200).json({ status: "healthy" });
});

// Créer le serveur WebSocket sur le MÊME port que HTTP
const wss = new WebSocket.Server({ 
    server: server,
    path: '/'
});

console.log('🚀 Serveur WebSocket configuré sur le même port que HTTP');

// Fonction pour mettre à jour les statistiques
function updateStats() {
    connections.active_sessions = clientSockets.size;
    console.log('📊 Stats mises à jour:', connections);
}

// FONCTION: Gérer les données audio
function handleAudioData(data, fromClient) {
    console.log(`🎵 Traitement audio de ${fromClient}`);
    
    const { from, to, data: audioData, sampleRate, format, channels } = data;
    
    // Validation des données
    if (!audioData || audioData.length === 0) {
        console.error('❌ Données audio vides');
        return;
    }
    
    if (!to || (to !== 'bernard' && to !== 'liliann')) {
        console.error(`❌ Destinataire invalide: ${to}`);
        return;
    }
    
    // Vérifier que l'expéditeur correspond au client connecté
    if (from !== fromClient) {
        console.error(`❌ Expéditeur incohérent: ${from} vs ${fromClient}`);
        return;
    }
    
    console.log(`🎵 Audio de ${from} vers ${to} - Taille: ${audioData.length} caractères`);
    
    // Préparer le message audio pour le destinataire
    const audioMessage = {
        type: 'audio_data',
        from: from,
        to: to,
        data: audioData,
        sampleRate: sampleRate || 44100,
        format: format || 'PCM_16BIT',
        channels: channels || 1,
        timestamp: new Date().toISOString()
    };
    
    // Envoyer l'audio au destinataire
    const targetSocket = clientSockets.get(to);
    if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
        try {
            targetSocket.send(JSON.stringify(audioMessage));
            console.log(`✅ Audio transféré de ${from} vers ${to}`);
        } catch (error) {
            console.error(`❌ Erreur envoi audio vers ${to}:`, error.message);
        }
    } else {
        console.log(`⚠️ ${to} non connecté - audio ignoré`);
        
        // Informer l'expéditeur que le destinataire n'est pas disponible
        const notificationMessage = {
            type: 'delivery_failed',
            target: to,
            reason: 'Client non connecté',
            timestamp: new Date().toISOString()
        };
        
        const senderSocket = clientSockets.get(fromClient);
        if (senderSocket && senderSocket.readyState === WebSocket.OPEN) {
            try {
                senderSocket.send(JSON.stringify(notificationMessage));
            } catch (error) {
                console.error(`❌ Erreur notification vers ${fromClient}:`, error.message);
            }
        }
    }
}

// FONCTION: Broadcaster le statut des utilisateurs
function broadcastUserStatus() {
    const userStatusMessage = {
        type: "user_status",
        users: {
            bernard: connections.bernard,
            liliann: connections.liliann
        },
        timestamp: new Date().toISOString()
    };
    
    clientSockets.forEach((socket, name) => {
        if (socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify(userStatusMessage));
            } catch (error) {
                console.error(`❌ Erreur broadcast status vers ${name}:`, error.message);
            }
        }
    });
}

// Gestion des connexions WebSocket
wss.on('connection', (ws, req) => {
    console.log('📱 Nouvelle connexion WebSocket');
    console.log('🔍 IP:', req.socket.remoteAddress);
    console.log('🔍 User-Agent:', req.headers['user-agent']);
    
    let clientName = null;
    let connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Envoyer un message de bienvenue
    ws.send(JSON.stringify({
        type: "welcome",
        message: "Connexion WebSocket établie! Envoyez 'bernard' ou 'liliann' pour vous identifier.",
        server: "Ecoute Boubouh Server v2.1",
        features: ["audio_streaming", "real_time_communication", "bernard_listening"],
        connectionId: connectionId,
        timestamp: new Date().toISOString()
    }));
    
    ws.on('message', (message) => {
        const messageStr = message.toString();
        console.log('📥 Message reçu:', messageStr.length > 100 ? messageStr.substring(0, 100) + '...' : messageStr);
        console.log('📥 De:', clientName || 'non-identifié');
        
        // Essayer de parser en JSON d'abord
        try {
            const data = JSON.parse(messageStr);
            console.log('📄 JSON parsé - Type:', data.type);
            
            // NOUVEAU: Gérer bernard_listening
            if (data.type === "bernard_listening") {
                const listening = data.listening;
                console.log(`🎧 Bernard listening: ${listening}`);
                
                // Envoyer le message à Liliann
                const liliannSocket = clientSockets.get("liliann");
                if (liliannSocket && liliannSocket.readyState === WebSocket.OPEN) {
                    try {
                        liliannSocket.send(JSON.stringify({
                            type: "bernard_listening",
                            listening: listening,
                            from: "bernard",
                            timestamp: new Date().toISOString()
                        }));
                        console.log(`✅ Message listening envoyé à Liliann: ${listening}`);
                    } catch (error) {
                        console.error(`❌ Erreur envoi vers Liliann:`, error.message);
                    }
                } else {
                    console.log(`⚠️ Liliann non connectée`);
                }
                return;
            }
            
            // Gérer les différents types de messages
            if (data.type === "audio_data") {
                // Traitement des données audio
                if (clientName) {
                    handleAudioData(data, clientName);
                } else {
                    console.error('❌ Tentative d\'envoi audio sans identification');
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Vous devez d'abord vous identifier avant d'envoyer de l'audio",
                        timestamp: new Date().toISOString()
                    }));
                }
                return; // Sortir ici pour éviter le traitement d'identification
            } else if (data.type === "ping") {
                // Répondre aux pings
                ws.send(JSON.stringify({
                    type: "pong",
                    timestamp: new Date().toISOString()
                }));
                return;
            } else if (data.type === "status_request") {
                // Envoyer le statut des utilisateurs
                ws.send(JSON.stringify({
                    type: "user_status",
                    users: {
                        bernard: connections.bernard,
                        liliann: connections.liliann
                    },
                    timestamp: new Date().toISOString()
                }));
                return;
            }
            
            // Traitement de l'identification
            if (data.type === "connect" && data.user) {
                clientName = data.user;
            } else if (data.action === "identify" && data.device) {
                clientName = data.device;
            } else if (data.type === "identify" && data.role) {
                clientName = data.role;
            }
        } catch (e) {
            // Si ce n'est pas du JSON, peut-être juste le nom
            console.log('📄 Message texte simple:', messageStr);
            if (messageStr === "bernard" || messageStr === "liliann") {
                clientName = messageStr;
            }
        }
        
        // Si on a identifié un client valide
        if (clientName && (clientName === "bernard" || clientName === "liliann")) {
            console.log(`✅ Client identifié: ${clientName}`);
            
            // Déconnecter l'ancien client s'il existe
            if (clientSockets.has(clientName)) {
                const oldSocket = clientSockets.get(clientName);
                if (oldSocket !== ws && oldSocket.readyState === WebSocket.OPEN) {
                    oldSocket.send(JSON.stringify({
                        type: "disconnected",
                        reason: "Nouvelle connexion du même client",
                        timestamp: new Date().toISOString()
                    }));
                    oldSocket.close();
                }
            }
            
            // Enregistrer le nouveau client
            clientSockets.set(clientName, ws);
            connections[clientName] = "connected";
            updateStats();
            
            // Confirmer la connexion
            const confirmationMessage = {
                type: "connection_confirmed",
                client: clientName,
                status: "connected",
                message: `Bonjour ${clientName}! Connexion réussie. Audio streaming + bernard_listening disponibles.`,
                connectionId: connectionId,
                timestamp: new Date().toISOString()
            };
            
            ws.send(JSON.stringify(confirmationMessage));
            console.log('✅ Confirmation envoyée à', clientName);
            
            // Broadcaster le statut des utilisateurs à tous les clients
            broadcastUserStatus();
            
        } else if (clientName) {
            // Le client est déjà identifié, traiter d'autres messages
            console.log(`📨 Message de ${clientName}:`, messageStr.substring(0, 50) + '...');
            
        } else {
            // Message de debug pour comprendre ce qui arrive
            const debugMessage = {
                type: "debug",
                received: messageStr.substring(0, 100),
                message: "Message reçu mais format non reconnu. Essayez 'bernard' ou 'liliann'",
                expectedFormats: [
                    "bernard",
                    "liliann", 
                    '{"type":"connect","user":"bernard"}',
                    '{"action":"identify","device":"bernard"}'
                ],
                timestamp: new Date().toISOString()
            };
            
            ws.send(JSON.stringify(debugMessage));
            console.log('🐛 Message de debug envoyé');
        }
    });
    
    ws.on('close', (code, reason) => {
        console.log(`👋 Connexion fermée pour: ${clientName || 'non-identifié'}`);
        console.log(`👋 Code: ${code}, Raison: ${reason}`);
        
        if (clientName && clientSockets.get(clientName) === ws) {
            clientSockets.delete(clientName);
            connections[clientName] = "disconnected";
            updateStats();
            console.log(`🔌 ${clientName} marqué comme déconnecté`);
            
            // Broadcaster le nouveau statut
            broadcastUserStatus();
        }
    });
    
    ws.on('error', (error) => {
        console.error('❌ Erreur WebSocket:', error);
        if (clientName && clientSockets.get(clientName) === ws) {
            clientSockets.delete(clientName);
            connections[clientName] = "disconnected";
            updateStats();
            broadcastUserStatus();
        }
    });
    
    // Ping périodique pour maintenir la connexion
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        } else {
            clearInterval(pingInterval);
        }
    }, 30000); // Ping toutes les 30 secondes
});

// Nettoyage périodique des connexions fermées
setInterval(() => {
    let cleanupNeeded = false;
    
    clientSockets.forEach((socket, clientName) => {
        if (socket.readyState !== WebSocket.OPEN) {
            console.log(`🧹 Nettoyage connexion fermée: ${clientName}`);
            clientSockets.delete(clientName);
            connections[clientName] = "disconnected";
            cleanupNeeded = true;
        }
    });
    
    if (cleanupNeeded) {
        updateStats();
        broadcastUserStatus();
    }
}, 60000); // Vérification toutes les minutes

// Ping serveur périodique pour tous les clients
setInterval(() => {
    const serverPingMessage = {
        type: "server_ping",
        timestamp: new Date().toISOString()
    };
    
    clientSockets.forEach((socket, clientName) => {
        if (socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify(serverPingMessage));
            } catch (error) {
                console.error(`❌ Erreur ping vers ${clientName}:`, error.message);
            }
        }
    });
}, 25000); // Ping toutes les 25 secondes (sync avec l'app Android)

// Démarrer le serveur
server.listen(PORT, () => {
    console.log(`🌐 Serveur démarré sur le port ${PORT}`);
    console.log(`📡 HTTP: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    console.log('✅ WebSocket et HTTP sur le MÊME port (requis par Render)');
    console.log('📋 Clients supportés: bernard, liliann');
    console.log('🎵 Fonctionnalités: identification + streaming audio temps réel + bernard_listening');
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
    console.log('🛑 Arrêt du serveur...');
    
    // Fermer toutes les connexions WebSocket proprement
    clientSockets.forEach((socket, clientName) => {
        try {
            socket.send(JSON.stringify({
                type: "server_shutdown",
                message: "Serveur en cours d'arrêt",
                timestamp: new Date().toISOString()
            }));
            socket.close(1001, 'Serveur en cours d\'arrêt');
        } catch (error) {
            console.error(`❌ Erreur fermeture ${clientName}:`, error.message);
        }
    });
    
    server.close(() => {
        console.log('✅ Serveur arrêté proprement');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\n🛑 Interruption reçue - Arrêt du serveur...');
    process.emit('SIGTERM');
});

// Logging des statistiques périodiques
setInterval(() => {
    const connectedClients = Array.from(clientSockets.keys());
    console.log(`📊 Clients connectés: [${connectedClients.join(', ')}] - Total: ${connectedClients.length}`);
}, 300000); // Toutes les 5 minutes
