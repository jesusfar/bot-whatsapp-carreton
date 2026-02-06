const { makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const { Boom } = require('@hapi/boom')
const pino = require('pino')

let GRUPO_ORIGEN = null
let GRUPO_DESTINO = null

const PALABRAS_CLAVE = ['solicito', 'solicita', 'fecha', 'hora']
const PALABRAS_CANCELACION = [
  'cancelado', 
  'cancelo', 
  'canceló', 
  'suspendido', 
  'suspende', 
  'anulado', 
  'anula',
  'se suspende',
  'suspender',
  'cancelar'
]

// Almacenar mensajes enviados para poder referenciarlos
const mensajesEnviados = new Map()

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    syncFullHistory: false,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    connectTimeoutMs: 60000,
    qrTimeout: 45000,
    emitOwnEvents: false,
    markOnlineOnConnect: false,
    fireInitQueries: true,
    generateHighQualityLinkPreview: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('\n')
      console.log('='.repeat(50))
      console.log('CÓDIGO QR GENERADO')
      console.log('='.repeat(50))
      console.log('\n📱 Copia el código de abajo y pégalo en https://qr.io/\n')
      console.log(qr)
      console.log('\n')
      console.log('='.repeat(50))
      console.log('\n')
      
      qrcode.generate(qr, { small: true })
      
      console.log('\n⏰ Tienes 45 segundos para escanear\n')
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error instanceof Boom) 
        ? lastDisconnect.error.output?.statusCode 
        : 500

      console.log('❌ Desconectado. Código:', statusCode)

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('🚫 Sesión cerrada. Elimina "auth" y vuelve a escanear')
        return
      }

      console.log('🔄 Reconectando en 10 segundos...')
      await delay(10000)
      iniciarBot()
    }

    if (connection === 'open') {
      console.log('\n')
      console.log('='.repeat(50))
      console.log('✅ WhatsApp conectado')
      console.log('='.repeat(50))
      console.log('\n📋 Comandos disponibles:')
      console.log('   !setorigen  - Configura grupo origen')
      console.log('   !setdestino - Configura grupo destino')
      console.log('   !status     - Ver configuración')
      console.log('   !logout     - Cerrar sesión del bot\n')
      console.log('🔑 Palabras clave (reenvío):', PALABRAS_CLAVE.join(', '))
      console.log('🚫 Palabras clave (cancelación):', PALABRAS_CANCELACION.join(', '))
      console.log('\n🤖 Bot activo - Escuchando mensajes...\n')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log('📥 Evento recibido - Tipo:', type)
    
    if (type !== 'notify') {
      console.log('⏭️  Ignorado: no es tipo notify')
      return
    }

    const msg = messages[0]
    console.log('📨 Mensaje detectado')
    
    if (!msg?.message) {
      console.log('⏭️  Ignorado: sin contenido')
      return
    }

    console.log('📍 Chat ID:', msg.key.remoteJid)
    console.log('👤 De mí:', msg.key.fromMe)
    
    if (!msg.key.remoteJid?.endsWith('@g.us')) {
      console.log('⏭️  Ignorado: no es grupo')
      return
    }

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      ''

    console.log('💬 Texto recibido:', texto)
    console.log('')

    const grupoActual = msg.key.remoteJid
    const comando = texto.toLowerCase().trim()

    // ========================================
    // COMANDOS (RESPONDEN INCLUSO A TUS PROPIOS MENSAJES)
    // ========================================
    
    if (comando === '!setorigen') {
      console.log('⚙️  Ejecutando: !setorigen')
      GRUPO_ORIGEN = grupoActual
      await sock.sendMessage(grupoActual, {
        text: '✅ *Grupo Origen Configurado*\n\n' +
              `ID: ${grupoActual}\n\n` +
              `Palabras clave (reenvío): ${PALABRAS_CLAVE.join(', ')}\n` +
              `Palabras clave (cancelación): ${PALABRAS_CANCELACION.join(', ')}`
      })
      console.log('✅ Grupo origen configurado:', GRUPO_ORIGEN)
      return
    }

    if (comando === '!setdestino') {
      console.log('⚙️  Ejecutando: !setdestino')
      GRUPO_DESTINO = grupoActual
      await sock.sendMessage(grupoActual, {
        text: '✅ *Grupo Destino Configurado*\n\n' +
              `ID: ${grupoActual}\n\n` +
              'Aquí llegarán los mensajes reenviados y notificaciones de cancelación.'
      })
      console.log('✅ Grupo destino configurado:', GRUPO_DESTINO)
      return
    }

    if (comando === '!status') {
      console.log('⚙️  Ejecutando: !status')
      const origenConfig = GRUPO_ORIGEN ? `✅ Configurado` : '❌ No configurado'
      const destinoConfig = GRUPO_DESTINO ? `✅ Configurado` : '❌ No configurado'
      
      await sock.sendMessage(grupoActual, {
        text: `📊 *Estado del Bot*\n\n` +
              `Grupo Origen: ${origenConfig}\n` +
              `Grupo Destino: ${destinoConfig}\n\n` +
              `Palabras clave (reenvío): ${PALABRAS_CLAVE.join(', ')}\n` +
              `Palabras clave (cancelación): ${PALABRAS_CANCELACION.join(', ')}\n\n` +
              `Pedidos registrados: ${mensajesEnviados.size}\n\n` +
              `${GRUPO_ORIGEN && GRUPO_DESTINO ? '🟢 Bot listo para funcionar' : '🔴 Configura ambos grupos'}`
      })
      return
    }

    if (comando === '!logout') {
      console.log('🚪 Cerrando sesión...')
      await sock.sendMessage(grupoActual, {
        text: '👋 Bot desconectado. Elimina la carpeta "auth" si quieres reconectar con otro número.'
      })
      await sock.logout()
      console.log('✅ Sesión cerrada\n')
      process.exit(0)
    }

    // ========================================
    // LÓGICA DE REENVÍO (IGNORA TUS PROPIOS MENSAJES)
    // ========================================
    
    // A partir de aquí SÍ ignoramos mensajes propios
    if (msg.key.fromMe) {
      console.log('⏭️  Ignorado: mensaje propio (no es comando)')
      return
    }

    // Lógica de reenvío y cancelación
    if (!GRUPO_ORIGEN || !GRUPO_DESTINO) {
      console.log('⏭️  Bot no configurado aún')
      return
    }

    if (grupoActual === GRUPO_ORIGEN) {
      try {
        const textoLower = texto.toLowerCase()
        
        // Verificar si es una CANCELACIÓN
        const esCancelacion = PALABRAS_CANCELACION.some(palabra => 
          textoLower.includes(palabra)
        )

        if (esCancelacion) {
          console.log('🚫 Detectada cancelación')
          const nombre = msg.pushName || 'Usuario'
          
          // Buscar si menciona algún pedido anterior
          const match = texto.match(/pedido\s*#?\s*(\d+)|solicitud\s*#?\s*(\d+)/i)
          const numeroPedido = match ? (match[1] || match[2]) : null
          
          await sock.sendMessage(GRUPO_DESTINO, {
            text: `🚫 *PEDIDO CANCELADO/SUSPENDIDO*\n\n` +
                  `👤 Cancelado por: ${nombre}\n` +
                  (numeroPedido ? `🔢 Pedido #${numeroPedido}\n\n` : '\n') +
                  `📝 Motivo/Detalles:\n${texto}`
          })

          // Confirmación en grupo origen
          await sock.sendMessage(GRUPO_ORIGEN, {
            text: '✅ Cancelación notificada correctamente'
          })

          console.log(`🚫 Cancelación notificada - Usuario: ${nombre}`)
          return
        }

        // Verificar si tiene palabras clave de SOLICITUD
        const tieneClaveValida = PALABRAS_CLAVE.some(clave => 
          textoLower.includes(clave)
        )

        console.log('🔍 ¿Tiene palabra clave?', tieneClaveValida)

        if (tieneClaveValida) {
          const nombre = msg.pushName || 'Usuario'
          const timestamp = new Date().toLocaleString('es-AR')
          
          // Generar un ID único para este pedido
          const pedidoId = `${Date.now()}-${msg.key.id.substring(0, 8)}`
          
          await sock.sendMessage(GRUPO_DESTINO, {
            text: `📩 *Mensaje reenviado*\n` +
                  `👤 ${nombre}\n` +
                  `🕐 ${timestamp}\n` +
                  `🔢 ID: ${pedidoId}\n\n` +
                  `${texto}`
          })

          // Confirmación en grupo origen
          await sock.sendMessage(GRUPO_ORIGEN, {
            text: '✅ Se pasó su pedido'
          })

          // Guardar referencia del mensaje
          mensajesEnviados.set(pedidoId, {
            nombre,
            texto,
            timestamp,
            mensajeOriginal: msg.key.id
          })

          console.log(`✅ Mensaje reenviado de ${nombre} - ID: ${pedidoId}`)
        }
      } catch (error) {
        console.error('❌ Error:', error.message)
      }
    }
  })

  console.log('🤖 Iniciando...\n')
}

iniciarBot().catch(err => {
  console.error('❌ Error fatal:', err.message)
})

