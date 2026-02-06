#!/bin/bash

# Script de Deployment Rápido para Fly.io
# Bot WhatsApp Carretón

set -e  # Salir si hay algún error

echo "🚀 Iniciando deployment en Fly.io..."
echo ""

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Verificar que flyctl esté instalado
if ! command -v flyctl &> /dev/null; then
    echo -e "${RED}❌ flyctl no está instalado${NC}"
    echo "Instálalo con: curl -L https://fly.io/install.sh | sh"
    exit 1
fi

echo -e "${GREEN}✅ flyctl encontrado${NC}"

# Verificar que estemos autenticados
if ! flyctl auth whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️  No estás autenticado${NC}"
    echo "Ejecutando: flyctl auth login"
    flyctl auth login
fi

echo -e "${GREEN}✅ Autenticado en Fly.io${NC}"
echo ""

# Preguntar nombre de la app
read -p "Nombre de la app (default: bot-whatsapp-carreton): " APP_NAME
APP_NAME=${APP_NAME:-bot-whatsapp-carreton}

# Preguntar región
echo ""
echo "Regiones disponibles:"
echo "  scl - Santiago, Chile"
echo "  gru - São Paulo, Brasil"
echo "  mia - Miami, USA"
echo "  mad - Madrid, España"
echo "  eze - Buenos Aires, Argentina"
read -p "Región (default: scl): " REGION
REGION=${REGION:-scl}

echo ""
echo -e "${YELLOW}📋 Resumen:${NC}"
echo "  App: $APP_NAME"
echo "  Región: $REGION"
echo ""
read -p "¿Continuar? (s/n): " CONFIRM

if [ "$CONFIRM" != "s" ] && [ "$CONFIRM" != "S" ]; then
    echo "Cancelado"
    exit 0
fi

# Crear app (si no existe)
echo ""
echo -e "${YELLOW}📦 Creando aplicación...${NC}"
if flyctl apps list | grep -q "$APP_NAME"; then
    echo -e "${YELLOW}⚠️  App $APP_NAME ya existe, usando existente${NC}"
else
    flyctl apps create "$APP_NAME" --org personal
    echo -e "${GREEN}✅ App creada${NC}"
fi

# Actualizar fly.toml con el nombre de la app
sed -i.bak "s/app = 'bot-whatsapp-carreton'/app = '$APP_NAME'/" fly.toml
sed -i.bak "s/primary_region = 'scl'/primary_region = '$REGION'/" fly.toml
rm fly.toml.bak 2>/dev/null || true

echo -e "${GREEN}✅ fly.toml actualizado${NC}"

# Crear volumen (si no existe)
echo ""
echo -e "${YELLOW}💾 Creando volumen persistente...${NC}"
if flyctl volumes list -a "$APP_NAME" | grep -q "whatsapp_data"; then
    echo -e "${YELLOW}⚠️  Volumen ya existe${NC}"
else
    flyctl volumes create whatsapp_data --region "$REGION" --size 1 -a "$APP_NAME"
    echo -e "${GREEN}✅ Volumen creado${NC}"
fi

# Desplegar
echo ""
echo -e "${YELLOW}🚢 Desplegando aplicación...${NC}"
flyctl deploy -a "$APP_NAME"

echo ""
echo -e "${GREEN}✅ Deployment completado!${NC}"
echo ""
echo -e "${YELLOW}📱 Próximos pasos:${NC}"
echo ""
echo "1. Ver logs en tiempo real:"
echo -e "   ${GREEN}flyctl logs -a $APP_NAME${NC}"
echo ""
echo "2. Abrir la app en el navegador:"
echo -e "   ${GREEN}flyctl open -a $APP_NAME${NC}"
echo ""
echo "3. Ver el código QR para conectar WhatsApp:"
echo -e "   ${GREEN}https://$APP_NAME.fly.dev/qr${NC}"
echo ""
echo "4. Verificar estado:"
echo -e "   ${GREEN}flyctl status -a $APP_NAME${NC}"
echo ""
echo "5. SSH a la máquina (para debugging):"
echo -e "   ${GREEN}flyctl ssh console -a $APP_NAME${NC}"
echo ""
echo -e "${GREEN}🎉 ¡Listo! Tu bot está corriendo en Fly.io${NC}"
