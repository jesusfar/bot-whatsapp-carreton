/**
 * Bot de WhatsApp para Fly.io
 * Bot de reenvío configurado para deployment en Fly.io
 * 
 * Características:
 * - Conexión persistente con WhatsApp usando Baileys
 * - Almacenamiento de sesión en volumen persistente (/data)
 * - Endpoints web para monitoreo y QR code
 * - Reconexión automática
 * - Health checks
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURACIÓN
// ============================================

const app = express();
const PORT = process.env.PORT || 8080;

// Directorio para guardar la sesión (montado desde volumen de Fly.io)
const AUTH_DIR = process.env.AUTH_DIR || '/data/auth';

// Logger configurado
const logger = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

// Variables globales
let sock = null;
let qrCode = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// ============================================
// INICIALIZACIÓN
// ============================================

// Crear directorio de autenticación si no existe
function initializeAuthDirectory() {
  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      logger.info(`📁 Directorio de autenticación creado: ${AUTH_DIR}`);
    } else {
      logger.info(`📁 Directorio de autenticación encontrado: ${AUTH_DIR}`);
    }
    
    // Verificar permisos de escritura
    fs.accessSync(AUTH_DIR, fs.constants.W_OK);
    logger.info('✅ Permisos de escritura verificados');
  } catch (error) {
    logger.error(`❌ Error al crear/verificar directorio de autenticación: ${error.message}`);
    process.exit(1);
  }
}

// ============================================
// FUNCIÓN PRINCIPAL DEL BOT
// ============================================

async function startWhatsAppBot() {
  try {
    // Obtener la última versión de Baileys
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`🔄 Usando Baileys versión: ${version.join('.')}, ${isLatest ? 'última versión' : 'versión anterior'}`);

    // Cargar estado de autenticación
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    // Crear socket de WhatsApp
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false, // Lo mostraremos en el endpoint web
      logger: pino({ level: 'silent' }), // Reducir logs de Baileys
      browser: ['Bot Carretón', 'Chrome', '1.0.0'],
      defaultQueryTimeoutMs: undefined,
    });

    // ============================================
    // EVENT HANDLERS
    // ============================================

    // Guardar credenciales cuando se actualicen
    sock.ev.on('creds.update', saveCreds);

    // Manejar actualizaciones de conexión
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Mostrar código QR
      if (qr) {
        qrCode = qr;
        logger.info('📱 Código QR generado - Visita /qr para escanearlo');
      }

      // Manejar conexión cerrada
      if (connection === 'close') {
        isConnected = false;
        qrCode = null;
        
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        logger.warn(`⚠️  Conexión cerrada. Código: ${statusCode}`);
        logger.warn(`Razón: ${getDisconnectReason(statusCode)}`);

        if (shouldReconnect) {
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff
            logger.info(`🔄 Reintentando conexión en ${delay/1000}s (intento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            setTimeout(() => startWhatsAppBot(), delay);
          } else {
            logger.error('❌ Máximo de reintentos alcanzado. Reinicia manualmente el servicio.');
          }
        } else {
          logger.error('❌ Sesión cerrada. Escanea el código QR nuevamente.');
        }
      }

      // Manejar conexión abierta
      if (connection === 'open') {
        isConnected = true;
        qrCode = null;
        reconnectAttempts = 0;
        logger.info('✅ WhatsApp conectado exitosamente!');
        logger.info(`📞 Bot: ${sock.user?.id || 'Desconocido'}`);
      }

      // Manejar conexión en proceso
      if (connection === 'connecting') {
        logger.info('🔄 Conectando a WhatsApp...');
      }
    });

    // Manejar mensajes entrantes
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Ignorar mensajes propios y mensajes sin contenido
        if (msg.key.fromMe || !msg.message) continue;

        try {
          await handleIncomingMessage(msg);
        } catch (error) {
          logger.error(`Error procesando mensaje: ${error.message}`);
        }
      }
    });

    // Manejar actualizaciones de grupos
    sock.ev.on('groups.update', (updates) => {
      logger.info(`Actualización de grupos: ${JSON.stringify(updates)}`);
    });

    // Manejar errores no capturados
    sock.ev.on('error', (error) => {
      logger.error(`Error en socket: ${error.message}`);
    });

  } catch (error) {
    logger.error(`❌ Error al iniciar bot: ${error.message}`);
    logger.error(error.stack);
    
    // Reintentar después de un error
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(() => startWhatsAppBot(), 5000);
    }
  }
}

// ============================================
// LÓGICA DE MENSAJES
// ============================================

async function handleIncomingMessage(msg) {
  const messageType = Object.keys(msg.message)[0];
  const from = msg.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  
  logger.info(`📨 Mensaje de: ${from} | Tipo: ${messageType} | Grupo: ${isGroup}`);

  // Obtener el texto del mensaje
  let text = '';
  if (msg.message.conversation) {
    text = msg.message.conversation;
  } else if (msg.message.extendedTextMessage) {
    text = msg.message.extendedTextMessage.text;
  } else if (msg.message.imageMessage && msg.message.imageMessage.caption) {
    text = msg.message.imageMessage.caption;
  } else if (msg.message.videoMessage && msg.message.videoMessage.caption) {
    text = msg.message.videoMessage.caption;
  }

  logger.info(`💬 Texto: ${text}`);

  // ============================================
  // AQUÍ VA TU LÓGICA DE REENVÍO
  // ============================================
  
  // Ejemplo básico de respuesta automática
  if (text.toLowerCase() === 'ping') {
    await sendMessage(from, '🏓 Pong!');
  }
  
  // Ejemplo de reenvío a otro número o grupo
  // const DESTINATION = '5491234567890@s.whatsapp.net'; // Cambia esto
  // await forwardMessage(msg, DESTINATION);
  
  // Comando de estado
  if (text.toLowerCase() === '/estado') {
    const status = `✅ Bot activo\n📊 Conectado: ${isConnected ? 'Sí' : 'No'}\n⏰ Uptime: ${process.uptime().toFixed(0)}s`;
    await sendMessage(from, status);
  }

  // Comando de ayuda
  if (text.toLowerCase() === '/ayuda' || text.toLowerCase() === '/help') {
    const help = `🤖 *Bot Carretón*\n\nComandos disponibles:\n• ping - Verifica si el bot responde\n• /estado - Ver estado del bot\n• /ayuda - Muestra este mensaje`;
    await sendMessage(from, help);
  }
}

// Función para enviar mensajes
async function sendMessage(to, text) {
  if (!sock || !isConnected) {
    logger.warn('⚠️  No se puede enviar mensaje: bot no conectado');
    return;
  }

  try {
    await sock.sendMessage(to, { text });
    logger.info(`✅ Mensaje enviado a: ${to}`);
  } catch (error) {
    logger.error(`❌ Error enviando mensaje: ${error.message}`);
  }
}

// Función para reenviar mensajes
async function forwardMessage(msg, destination) {
  if (!sock || !isConnected) {
    logger.warn('⚠️  No se puede reenviar mensaje: bot no conectado');
    return;
  }

  try {
    await sock.sendMessage(destination, {
      forward: msg
    });
    logger.info(`✅ Mensaje reenviado a: ${destination}`);
  } catch (error) {
    logger.error(`❌ Error reenviando mensaje: ${error.message}`);
  }
}

// ============================================
// ENDPOINTS EXPRESS
// ============================================

// Middleware para parsear JSON
app.use(express.json());

// Página principal
app.get('/', (req, res) => {
  const uptime = process.uptime();
  const uptimeStr = formatUptime(uptime);
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bot WhatsApp Carretón</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          padding: 40px;
          max-width: 500px;
          width: 100%;
        }
        h1 {
          color: #333;
          margin-bottom: 10px;
          font-size: 2em;
        }
        .status {
          display: inline-block;
          padding: 8px 16px;
          border-radius: 20px;
          font-weight: bold;
          margin: 20px 0;
        }
        .status.connected {
          background: #d4edda;
          color: #155724;
        }
        .status.disconnected {
          background: #f8d7da;
          color: #721c24;
        }
        .info {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 10px;
          margin: 20px 0;
        }
        .info p {
          margin: 10px 0;
          color: #555;
        }
        .links {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .btn {
          display: inline-block;
          padding: 12px 24px;
          background: #667eea;
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          transition: all 0.3s;
        }
        .btn:hover {
          background: #5568d3;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        .btn.secondary {
          background: #6c757d;
        }
        .btn.secondary:hover {
          background: #5a6268;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Bot WhatsApp Carretón</h1>
        <span class="status ${isConnected ? 'connected' : 'disconnected'}">
          ${isConnected ? '✅ Conectado' : '⚠️ Desconectado'}
        </span>
        
        <div class="info">
          <p><strong>⏰ Uptime:</strong> ${uptimeStr}</p>
          <p><strong>📊 Estado:</strong> ${isConnected ? 'Activo' : 'Esperando conexión'}</p>
          <p><strong>🔌 Intentos de reconexión:</strong> ${reconnectAttempts}</p>
          <p><strong>📱 Código QR:</strong> ${qrCode ? 'Disponible' : 'No necesario'}</p>
        </div>

        <div class="links">
          ${!isConnected && qrCode ? '<a href="/qr" class="btn">📱 Ver Código QR</a>' : ''}
          <a href="/health" class="btn secondary">🏥 Health Check</a>
          <a href="/status" class="btn secondary">📊 Estado JSON</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Endpoint para ver el código QR
app.get('/qr', (req, res) => {
  if (!qrCode) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>QR Code - Bot WhatsApp</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            text-align: center;
            max-width: 500px;
          }
          h1 { color: #333; margin-bottom: 20px; }
          p { color: #666; margin: 20px 0; }
          a {
            display: inline-block;
            padding: 12px 24px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Bot Ya Está Conectado</h1>
          <p>No necesitas escanear el código QR.</p>
          <p>El bot está funcionando correctamente.</p>
          <a href="/">← Volver al inicio</a>
        </div>
      </body>
      </html>
    `);
  }

  // Generar imagen QR
  const QRCode = require('qrcode');
  QRCode.toDataURL(qrCode, (err, url) => {
    if (err) {
      return res.status(500).send('Error generando código QR');
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>QR Code - Bot WhatsApp</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            text-align: center;
            max-width: 500px;
          }
          h1 { color: #333; margin-bottom: 20px; }
          img { 
            width: 300px; 
            height: 300px; 
            border: 3px solid #667eea;
            border-radius: 15px;
            margin: 20px 0;
          }
          .steps {
            text-align: left;
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
          }
          .steps li {
            margin: 10px 0;
            color: #555;
          }
          .refresh {
            color: #667eea;
            font-size: 0.9em;
            margin-top: 10px;
          }
        </style>
        <script>
          // Auto-refresh cada 5 segundos
          setTimeout(() => location.reload(), 5000);
        </script>
      </head>
      <body>
        <div class="container">
          <h1>📱 Escanea este Código QR</h1>
          <img src="${url}" alt="QR Code">
          
          <div class="steps">
            <strong>Pasos para conectar:</strong>
            <ol>
              <li>Abre WhatsApp en tu teléfono</li>
              <li>Ve a <strong>Configuración</strong> > <strong>Dispositivos vinculados</strong></li>
              <li>Toca <strong>Vincular un dispositivo</strong></li>
              <li>Escanea este código QR</li>
            </ol>
          </div>
          
          <p class="refresh">🔄 Esta página se actualizará automáticamente</p>
        </div>
      </body>
      </html>
    `);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  const healthStatus = {
    status: isConnected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connected: isConnected,
    hasQR: !!qrCode,
    reconnectAttempts
  };

  const statusCode = isConnected ? 200 : 503;
  res.status(statusCode).json(healthStatus);
});

// Status endpoint (más detallado)
app.get('/status', (req, res) => {
  const status = {
    bot: {
      connected: isConnected,
      phoneNumber: sock?.user?.id || null,
      hasQRCode: !!qrCode,
      reconnectAttempts,
    },
    server: {
      uptime: process.uptime(),
      uptimeFormatted: formatUptime(process.uptime()),
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
    },
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
    },
    authDirectory: {
      path: AUTH_DIR,
      exists: fs.existsSync(AUTH_DIR),
      files: fs.existsSync(AUTH_DIR) ? fs.readdirSync(AUTH_DIR).length : 0,
    }
  };

  res.json(status);
});

// ============================================
// UTILIDADES
// ============================================

function getDisconnectReason(statusCode) {
  const reasons = {
    [DisconnectReason.badSession]: 'Sesión inválida',
    [DisconnectReason.connectionClosed]: 'Conexión cerrada',
    [DisconnectReason.connectionLost]: 'Conexión perdida',
    [DisconnectReason.connectionReplaced]: 'Conexión reemplazada',
    [DisconnectReason.loggedOut]: 'Sesión cerrada',
    [DisconnectReason.restartRequired]: 'Reinicio requerido',
    [DisconnectReason.timedOut]: 'Tiempo de espera agotado',
  };
  return reasons[statusCode] || 'Razón desconocida';
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

// ============================================
// MANEJO DE ERRORES Y SEÑALES
// ============================================

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
  logger.error(`❌ Excepción no capturada: ${error.message}`);
  logger.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Promesa rechazada no manejada:', reason);
});

// Manejar señales de terminación
process.on('SIGINT', async () => {
  logger.info('⚠️  SIGINT recibido, cerrando bot...');
  if (sock) {
    await sock.logout();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('⚠️  SIGTERM recibido, cerrando bot...');
  if (sock) {
    await sock.logout();
  }
  process.exit(0);
});

// ============================================
// INICIO DE LA APLICACIÓN
// ============================================

async function main() {
  logger.info('🚀 Iniciando Bot de WhatsApp Carretón...');
  logger.info(`📁 Directorio de autenticación: ${AUTH_DIR}`);
  logger.info(`🌐 Puerto: ${PORT}`);
  logger.info(`🔧 Entorno: ${process.env.NODE_ENV || 'development'}`);

  // Inicializar directorio de autenticación
  initializeAuthDirectory();

  // Iniciar servidor Express
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`✅ Servidor Express corriendo en puerto ${PORT}`);
    logger.info(`🌐 Endpoints disponibles:`);
    logger.info(`   - http://0.0.0.0:${PORT}/`);
    logger.info(`   - http://0.0.0.0:${PORT}/qr`);
    logger.info(`   - http://0.0.0.0:${PORT}/health`);
    logger.info(`   - http://0.0.0.0:${PORT}/status`);
  });

  // Iniciar bot de WhatsApp
  await startWhatsAppBot();
}

// Ejecutar aplicación
main().catch((error) => {
  logger.error(`❌ Error fatal: ${error.message}`);
  logger.error(error.stack);
  process.exit(1);
});
