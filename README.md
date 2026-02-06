# 🤖 Bot WhatsApp Carretón

Bot de reenvío de WhatsApp optimizado para deployment en Fly.io.

## 📋 Características

- ✅ Conexión persistente 24/7 con WhatsApp
- ✅ Almacenamiento de sesión en volumen persistente
- ✅ Interfaz web para escanear código QR
- ✅ Reconexión automática
- ✅ Health checks y monitoreo
- ✅ Logs estructurados con Pino
- ✅ Manejo robusto de errores

## 🚀 Deployment en Fly.io

### 1. Prerrequisitos

```bash
# Instalar Fly.io CLI
curl -L https://fly.io/install.sh | sh

# Autenticarse
flyctl auth login
```

### 2. Crear la aplicación

```bash
# Inicializar proyecto (NO deployar aún)
flyctl launch --no-deploy

# Responder las preguntas:
# - App name: bot-whatsapp-carreton (o el que prefieras)
# - Region: scl (Santiago, Chile) o la más cercana
# - PostgreSQL: No
# - Redis: No
```

### 3. Crear volumen persistente

```bash
# Crear volumen de 1GB (IMPORTANTE para guardar sesión)
flyctl volumes create whatsapp_data --region scl --size 1
```

### 4. Configurar fly.toml

El archivo `fly.toml` debe verse así:

```toml
app = 'bot-whatsapp-carreton'
primary_region = 'scl'

[build]

[env]
  PORT = '8080'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = true
  min_machines_running = 1
  processes = ['app']

  [http_service.concurrency]
    type = 'connections'
    hard_limit = 25
    soft_limit = 20

[[vm]]
  memory = '256mb'
  cpu_kind = 'shared'
  cpus = 1

[mounts]
  source = 'whatsapp_data'
  destination = '/data'
```

### 5. Deployar

```bash
flyctl deploy
```

### 6. Ver logs y obtener URL

```bash
# Ver logs en tiempo real
flyctl logs

# Abrir la aplicación en el navegador
flyctl open
```

## 📱 Conectar WhatsApp

1. Ve a: `https://tu-app.fly.dev/qr`
2. Escanea el código QR con WhatsApp:
   - Abre WhatsApp en tu teléfono
   - Ve a **Configuración** > **Dispositivos vinculados**
   - Toca **Vincular un dispositivo**
   - Escanea el código QR

## 🌐 Endpoints Disponibles

- `/` - Página principal con estado del bot
- `/qr` - Ver código QR para conectar WhatsApp
- `/health` - Health check (200 si conectado, 503 si no)
- `/status` - Estado detallado en JSON

## 🛠️ Comandos del Bot

Envía estos mensajes al bot en WhatsApp:

- `ping` - Verifica que el bot responde
- `/estado` - Ver estado del bot
- `/ayuda` - Muestra lista de comandos

## 🔧 Personalización

### Agregar lógica de reenvío

En `index.js`, busca la sección `handleIncomingMessage()`:

```javascript
// Ejemplo: Reenviar mensajes a un número específico
const DESTINATION = '5491234567890@s.whatsapp.net'; // Cambia esto

async function handleIncomingMessage(msg) {
  // ... código existente ...
  
  // Reenviar mensaje
  await forwardMessage(msg, DESTINATION);
}
```

### Agregar comandos personalizados

```javascript
// En la función handleIncomingMessage()
if (text.toLowerCase() === '/micomando') {
  await sendMessage(from, 'Respuesta personalizada');
}
```

### Variables de entorno

```bash
# Agregar secretos en Fly.io
flyctl secrets set MI_VARIABLE=valor
```

Luego úsalas en el código:
```javascript
const miVariable = process.env.MI_VARIABLE;
```

## 📊 Monitoreo

### Ver estado en tiempo real

```bash
flyctl status
```

### Ver logs

```bash
flyctl logs
```

### Ver uso de recursos

```bash
flyctl dashboard metrics
```

### SSH a la máquina

```bash
flyctl ssh console

# Dentro de la máquina:
ls -la /data/auth  # Ver archivos de sesión
df -h              # Ver uso de disco
```

## 🔄 Actualizar el Bot

```bash
# 1. Hacer cambios en el código
# 2. Commit
git add .
git commit -m "Actualización"
git push

# 3. Redeploy
flyctl deploy
```

## 🐛 Solución de Problemas

### Bot se desconecta constantemente

```bash
# Ver logs para identificar el problema
flyctl logs

# Verificar que el volumen esté montado
flyctl ssh console
ls -la /data/auth
```

### No veo el código QR

1. Ve a: `https://tu-app.fly.dev/qr`
2. O mira los logs: `flyctl logs`

### Sesión se pierde después de redeploy

Verifica:
1. Volumen creado: `flyctl volumes list`
2. `fly.toml` tiene sección `[mounts]`
3. Código usa `/data/auth` no `./auth`

### App no responde

```bash
# Reiniciar
flyctl apps restart

# Ver salud
flyctl status
```

## 💰 Costos

Con esta configuración (1 VM de 256MB + 1GB volumen):

- **Estimado:** $0-3/mes
- **Límite gratuito:** Hasta $5/mes sin cargo

Ver uso actual:
```bash
flyctl dashboard
```

## 📚 Estructura del Proyecto

```
bot-whatsapp-carreton/
├── index.js          # Código principal del bot
├── package.json      # Dependencias
├── .gitignore       # Archivos a ignorar
├── fly.toml         # Configuración de Fly.io
├── Dockerfile       # Auto-generado por Fly.io
└── README.md        # Este archivo
```

## 🔒 Seguridad

- ✅ Nunca subas archivos de la carpeta `auth/` a Git
- ✅ Usa variables de entorno para datos sensibles
- ✅ El `.gitignore` ya excluye archivos sensibles
- ✅ Fly.io encripta volúmenes automáticamente

## 🆘 Soporte

- **Documentación Fly.io:** https://fly.io/docs
- **Baileys GitHub:** https://github.com/WhiskeySockets/Baileys
- **Comunidad Fly.io:** https://community.fly.io

## 📝 Licencia

MIT

---

**Hecho con ❤️ para Fly.io**
