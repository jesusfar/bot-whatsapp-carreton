const { makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const { Boom } = require('@hapi/boom')
const pino = require('pino')

let GRUPO_ORIGEN = null
let GRUPO_DESTINO = null

const PALABRAS_CLAVE = ['solicito', 'solicita', 'fecha', 'hora']

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
      console.clear()
      qrcode.generate(qr, { small: true })
      console.log('\n📱 Escaneá este QR con WhatsApp')
      console.log('⏰ Tienes 45 segundos\n')
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
      console.clear()
      console.log('✅ WhatsApp conectado\n')
      console.log('📋 Comandos disponibles:')
      console.log('   !setorigen  - Configura grupo origen')
      console.log('   !setdestino - Configura grupo destino')
      console.log('   !status     - Ver configuración\n')
      console.log('🔑 Palabras clave:', PALABRAS_CLAVE.join(', '))
      console.log('\n🤖 Bot activo - Escuchando mensajes...\n')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log('📥 Evento recibido - Tipo:', type) // DEBUG
    
    if (type !== 'notify') {
      console.log('⏭️  Ignorado: no es tipo notify')
      return
    }

    const msg = messages[0]
    console.log('📨 Mensaje detectado') // DEBUG
    
    if (!msg?.message) {
      console.log('⏭️  Ignorado: sin contenido')
      return
    }

    console.log('📍 Chat ID:', msg.key.remoteJid) // DEBUG
    console.log('👤 De mí:', msg.key.fromMe) // DEBUG
    
    if (!msg.key.remoteJid?.endsWith('@g.us')) {
      console.log('⏭️  Ignorado: no es grupo')
      return
    }

    if (msg.key.fromMe) {
      console.log('⏭️  Ignorado: mensaje propio')
      return
    }

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      ''

    console.log('💬 Texto recibido:', texto) // DEBUG
    console.log('') // Línea en blanco

    const grupoActual = msg.key.remoteJid

    // Comandos de configuración
    if (texto.toLowerCase().trim() === '!setorigen') {
      console.log('⚙️  Ejecutando: !setorigen')
      GRUPO_ORIGEN = grupoActual
      await sock.sendMessage(grupoActual, {
        text: '✅ *Grupo Origen Configurado*\n\n' +
              `ID: ${grupoActual}\n\n` +
              `Palabras clave: ${PALABRAS_CLAVE.join(', ')}`
      })
      console.log('✅ Grupo origen configurado:', GRUPO_ORIGEN)
      return
    }

    if (texto.toLowerCase().trim() === '!setdestino') {
      console.log('⚙️  Ejecutando: !setdestino')
      GRUPO_DESTINO = grupoActual
      await sock.sendMessage(grupoActual, {
        text: '✅ *Grupo Destino Configurado*\n\n' +
              `ID: ${grupoActual}\n\n` +
              'Aquí llegarán los mensajes reenviados.'
      })
      console.log('✅ Grupo destino configurado:', GRUPO_DESTINO)
      return
    }

    if (texto.toLowerCase().trim() === '!status') {
      console.log('⚙️  Ejecutando: !status')
      const origenConfig = GRUPO_ORIGEN ? `✅ ${GRUPO_ORIGEN}` : '❌ No configurado'
      const destinoConfig = GRUPO_DESTINO ? `✅ ${GRUPO_DESTINO}` : '❌ No configurado'
      
      await sock.sendMessage(grupoActual, {
        text: `📊 *Estado del Bot*\n\n` +
              `Grupo Origen:\n${origenConfig}\n\n` +
              `Grupo Destino:\n${destinoConfig}\n\n` +
              `Palabras clave: ${PALABRAS_CLAVE.join(', ')}\n\n` +
              `${GRUPO_ORIGEN && GRUPO_DESTINO ? '🟢 Bot listo para funcionar' : '🔴 Configura ambos grupos'}`
      })
      return
    }

    // Lógica de reenvío
    if (!GRUPO_ORIGEN || !GRUPO_DESTINO) {
      console.log('⏭️  Bot no configurado aún')
      return
    }

    if (grupoActual === GRUPO_ORIGEN) {
      try {
        const textoLower = texto.toLowerCase()
        const tieneClaveValida = PALABRAS_CLAVE.some(clave => 
          textoLower.includes(clave)
        )

        console.log('🔍 ¿Tiene palabra clave?', tieneClaveValida)

        if (tieneClaveValida) {
          const nombre = msg.pushName || 'Usuario'
          
          // Reenviar al grupo destino
          await sock.sendMessage(GRUPO_DESTINO, {
            text: `📩 *Mensaje reenviado*\n👤 ${nombre}\n\n${texto}`
          })

          console.log(`✅ Mensaje reenviado de ${nombre}`)

          // Confirmar en el grupo origen
          await sock.sendMessage(GRUPO_ORIGEN, {
            text: '✅ Su pedido fue pasado'
          }, {
            quoted: msg // Responde al mensaje original
          })

          console.log('✅ Confirmación enviada al grupo origen')
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
