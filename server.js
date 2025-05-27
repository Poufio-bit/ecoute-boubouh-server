const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configuration CORS
app.use(cors());
app.use(express.json());

// Configuration base de données PostgreSQL (Railway l'injecte automatiquement)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// WebSocket Server pour audio streaming
const wss = new WebSocket.Server({ server });

// Stockage des connexions actives
const connections = {
  bernard: null,    // App d'écoute
  liliann: null,    // App source audio
  sessions: new Map() // Sessions d'écoute actives
};

// ===== INITIALISATION BASE DE DONNÉES =====
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        start_time TIMESTAMP DEFAULT NOW(),
        end_time TIMESTAMP,
        duration_seconds INTEGER,
        is_recording BOOLEAN DEFAULT FALSE,
        recording_path TEXT,
        battery_level INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audio_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES sessions(id),
        chunk_data BYTEA,
        timestamp TIMESTAMP DEFAULT NOW(),
        chunk_order INTEGER
      )
    `);
    
    console.log('✅ Base de données initialisée');
  } catch (error) {
    console.error('❌ Erreur init BDD:', error);
  }
}

// ===== GESTION WEBSOCKET =====
wss.on('connection', (ws, req) => {
  console.log('🔌 Nouvelle connexion WebSocket');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'register':
          handleClientRegistration(ws, data);
          break;
          
        case 'start_listening':
          handleStartListening(data);
          break;
          
        case 'stop_listening':
          handleStopListening(data);
          break;
          
        case 'start_recording':
          handleStartRecording(data);
          break;
          
        case 'audio_chunk':
          handleAudioChunk(data);
          break;
          
        case 'battery_update':
          handleBatteryUpdate(data);
          break;
          
        default:
          console.log('❓ Type de message inconnu:', data.type);
      }
    } catch (error) {
      console.error('❌ Erreur traitement message:', error);
    }
  });
  
  ws.on('close', () => {
    handleClientDisconnection(ws);
  });
  
  ws.on('error', (error) => {
    console.error('❌ Erreur WebSocket:', error);
  });
});

// ===== HANDLERS WEBSOCKET =====
function handleClientRegistration(ws, data) {
  const clientType = data.client_type; // 'bernard' ou 'liliann'
  
  connections[clientType] = ws;
  ws.clientType = clientType;
  ws.clientId = data.client_id || uuidv4();
  
  console.log(`✅ Client ${clientType} connecté (ID: ${ws.clientId})`);
  
  // Confirmer la connexion
  ws.send(JSON.stringify({
    type: 'registered',
    client_type: clientType,
    client_id: ws.clientId,
    timestamp: Date.now()
  }));
  
  // Notifier l'autre client si connecté
  const otherClient = clientType === 'bernard' ? connections.liliann : connections.bernard;
  if (otherClient) {
    otherClient.send(JSON.stringify({
      type: 'peer_connected',
      peer_type: clientType,
      timestamp: Date.now()
    }));
  }
}

async function handleStartListening(data) {
  try {
    // Créer nouvelle session
    const result = await pool.query(
      'INSERT INTO sessions (start_time, is_recording) VALUES (NOW(), $1) RETURNING id',
      [false]
    );
    
    const sessionId = result.rows[0].id;
    connections.sessions.set(sessionId, {
      id: sessionId,
      startTime: Date.now(),
      isRecording: false,
      isListening: true
    });
    
    console.log(`🎧 Session d'écoute démarrée: ${sessionId}`);
    
    // Notifier Bernard
    if (connections.bernard) {
      connections.bernard.send(JSON.stringify({
        type: 'listening_started',
        session_id: sessionId,
        timestamp: Date.now()
      }));
    }
    
    // Demander à Liliann de commencer l'envoi audio
    if (connections.liliann) {
      connections.liliann.send(JSON.stringify({
        type: 'start_audio_capture',
        session_id: sessionId,
        timestamp: Date.now()
      }));
    }
    
  } catch (error) {
    console.error('❌ Erreur start listening:', error);
  }
}

async function handleStopListening(data) {
  try {
    const sessionId = data.session_id;
    const session = connections.sessions.get(sessionId);
    
    if (session) {
      const duration = Math.floor((Date.now() - session.startTime) / 1000);
      
      // Mettre à jour la session en BDD
      await pool.query(
        'UPDATE sessions SET end_time = NOW(), duration_seconds = $1 WHERE id = $2',
        [duration, sessionId]
      );
      
      connections.sessions.delete(sessionId);
      
      console.log(`⏹️ Session terminée: ${sessionId} (durée: ${duration}s)`);
      
      // Notifier les clients
      [connections.bernard, connections.liliann].forEach(client => {
        if (client) {
          client.send(JSON.stringify({
            type: 'listening_stopped',
            session_id: sessionId,
            duration_seconds: duration,
            timestamp: Date.now()
          }));
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur stop listening:', error);
  }
}

async function handleStartRecording(data) {
  try {
    const sessionId = data.session_id;
    const session = connections.sessions.get(sessionId);
    
    if (session) {
      session.isRecording = true;
      
      // Mettre à jour en BDD
      await pool.query(
        'UPDATE sessions SET is_recording = TRUE WHERE id = $1',
        [sessionId]
      );
      
      console.log(`🎙️ Enregistrement démarré pour session: ${sessionId}`);
      
      // Notifier Bernard
      if (connections.bernard) {
        connections.bernard.send(JSON.stringify({
          type: 'recording_started',
          session_id: sessionId,
          timestamp: Date.now()
        }));
      }
    }
    
  } catch (error) {
    console.error('❌ Erreur start recording:', error);
  }
}

function handleAudioChunk(data) {
  const { session_id, audio_data, timestamp, chunk_order } = data;
  
  // Relayer l'audio vers Bernard pour écoute en temps réel
  if (connections.bernard) {
    connections.bernard.send(JSON.stringify({
      type: 'audio_chunk',
      session_id: session_id,
      audio_data: audio_data,
      timestamp: timestamp,
      chunk_order: chunk_order
    }));
  }
  
  // Sauvegarder en BDD si enregistrement actif
  const session = connections.sessions.get(session_id);
  if (session && session.isRecording) {
    saveAudioChunk(session_id, audio_data, chunk_order);
  }
}

async function saveAudioChunk(sessionId, audioData, chunkOrder) {
  try {
    await pool.query(
      'INSERT INTO audio_chunks (session_id, chunk_data, chunk_order) VALUES ($1, $2, $3)',
      [sessionId, Buffer.from(audioData, 'base64'), chunkOrder]
    );
  } catch (error) {
    console.error('❌ Erreur sauvegarde audio chunk:', error);
  }
}

function handleBatteryUpdate(data) {
  const { battery_level, session_id } = data;
  
  // Notifier Bernard du niveau de batterie
  if (connections.bernard) {
    connections.bernard.send(JSON.stringify({
      type: 'battery_update',
      battery_level: battery_level,
      session_id: session_id,
      timestamp: Date.now()
    }));
  }
  
  // Mettre à jour en BDD
  if (session_id) {
    pool.query(
      'UPDATE sessions SET battery_level = $1 WHERE id = $2',
      [battery_level, session_id]
    ).catch(console.error);
  }
}

function handleClientDisconnection(ws) {
  const clientType = ws.clientType;
  console.log(`🔌 Client ${clientType} déconnecté`);
  
  if (connections[clientType] === ws) {
    connections[clientType] = null;
  }
  
  // Notifier l'autre client
  const otherClient = clientType === 'bernard' ? connections.liliann : connections.bernard;
  if (otherClient) {
    otherClient.send(JSON.stringify({
      type: 'peer_disconnected',
      peer_type: clientType,
      timestamp: Date.now()
    }));
  }
}

// ===== API REST =====
app.get('/', (req, res) => {
  res.json({
    service: 'Ecoute Boubouh Server',
    version: '1.0.0',
    status: 'running',
    connections: {
      bernard: connections.bernard ? 'connected' : 'disconnected',
      liliann: connections.liliann ? 'connected' : 'disconnected',
      active_sessions: connections.sessions.size
    }
  });
});

app.get('/api/sessions', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM sessions ORDER BY start_time DESC LIMIT 50'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erreur récupération sessions:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ===== DÉMARRAGE SERVEUR =====
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDatabase();
    
    server.listen(PORT, () => {
      console.log(`🚀 Serveur Ecoute Boubouh démarré sur port ${PORT}`);
      console.log(`🌐 WebSocket disponible sur ws://localhost:${PORT}`);
      console.log(`📡 API REST disponible sur http://localhost:${PORT}`);
    });
    
  } catch (error) {
    console.error('❌ Erreur démarrage serveur:', error);
    process.exit(1);
  }
}

startServer();

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
  console.log('⏹️ Arrêt du serveur...');
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});
