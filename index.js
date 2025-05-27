const { Client, LocalAuth, MessageMedia, Location } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const app = express();

// Configuración de Express
app.use(express.json());
const PORT = 3000;

// URL del servidor FastAPI
const FASTAPI_URL = 'http://localhost:8080';

const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Relámpago Express - Escanea el QR</title>
  <script src="/socket.io/socket.io.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"></script>
  <style>
    body {
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      height:100vh;
      margin:0;
      font-family:sans-serif;
      background:#f5f5f5;
    }
    #qr { margin:20px; }
    h1 { color:#333; }
    p { color:#666; }
  </style>
</head>
<body>
  <h1>Escanea el QR con tu WhatsApp</h1>
  <canvas id="qr"></canvas>
  <p id="status">Esperando QR...</p>

  <script>
    const socket = io();
    const statusEl = document.getElementById('status');
    const canvasEl = document.getElementById('qr');

    socket.on('qr', qrData => {
      statusEl.innerText = '¡QR recibido! Generando imagen...';
      QRCode.toCanvas(canvasEl, qrData, { width: 300 }, err => {
        if (err) {
          console.error(err);
          statusEl.innerText = 'Error generando el QR';
        } else {
          statusEl.innerText = 'Escanea con WhatsApp';
        }
      });
    });

    socket.on('ready', () => {
      statusEl.innerText = '✅ Bot listo';
    });

    socket.on('authenticated', () => {
      statusEl.innerText = '🔒 Autenticado';
    });
  </script>
</body>
</html>
`;

app.get('/', (req, res) => {
  res.send(html);
});

// Inicializar el servidor HTTP y el socket
const server = http.createServer(app);
const io = socketIo(server);

// Inicializar el cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox']
    }
});

// Manejar la generación del código QR
client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, { small: true });
    console.log('Escanea este código QR con tu WhatsApp para iniciar sesión');
    // Emitir el QR al cliente web
    io.emit('qr', qr);
});

// Conexión establecida
client.on('authenticated', () => {
    console.log('Cliente autenticado');
    io.emit('authenticated');
});

// Cuando el cliente está listo
client.on('ready', () => {
    console.log('🚚 Relámpago Express - Bot de WhatsApp está listo!');
    io.emit('ready');
});

// Funciones auxiliares para el manejo de pedidos
async function handleOrderConfirmation(msg, orderId) {
    try {
        console.log(`Procesando confirmación para el pedido: ${orderId}`);
        const response = await axios.post(`${FASTAPI_URL}/restaurant-response/${orderId}`, {
            action: 'confirm'
        });
        
        if (response.data.status === 'success') {
            await msg.reply(`✅ *RELÁMPAGO EXPRESS*: Pedido ${orderId} confirmado exitosamente. El cliente ha sido notificado.`);
        } else {
            await msg.reply(`❌ *RELÁMPAGO EXPRESS*: Hubo un problema al confirmar el pedido ${orderId}.`);
        }
        return response.data;
    } catch (error) {
        console.error('Error al confirmar pedido:', error);
        await msg.reply(`❌ *RELÁMPAGO EXPRESS*: Error al confirmar el pedido ${orderId}: ${error.message}`);
        throw error;
    }
}

async function handleOrderRejection(msg, orderId) {
    try {
        console.log(`Procesando rechazo para el pedido: ${orderId}`);
        const response = await axios.post(`${FASTAPI_URL}/restaurant-response/${orderId}`, {
            action: 'reject'
        });
        
        if (response.data.status === 'success') {
            await msg.reply(`✅ *RELÁMPAGO EXPRESS*: Pedido ${orderId} rechazado. El cliente ha sido notificado.`);
        } else {
            await msg.reply(`❌ *RELÁMPAGO EXPRESS*: Hubo un problema al rechazar el pedido ${orderId}.`);
        }
        return response.data;
    } catch (error) {
        console.error('Error al rechazar pedido:', error);
        await msg.reply(`❌ *RELÁMPAGO EXPRESS*: Error al rechazar el pedido ${orderId}: ${error.message}`);
        throw error;
    }
}

// Logo de Relámpago Express (se podría implementar)
const sendWelcomeMessage = async (chat) => {
    try {
        // Aquí podría enviarse un logo o imagen de bienvenida
        const welcomeText = `
*🚚 ¡BIENVENIDO A RELÁMPAGO EXPRESS! 🚚*

Tu servicio de entrega rápido y confiable.
`;
        await chat.sendMessage(welcomeText);
    } catch (error) {
        console.error('Error al enviar mensaje de bienvenida:', error);
    }
};

// Manejar mensajes entrantes
client.on('message', async msg => {
    try {
        // Ignorar mensajes de grupos
        if (msg.isGroupMsg) return;

        const chat = await msg.getChat();
        const contact = await msg.getContact();
        const phone = formatPhoneNumber(contact.number);
        
        // Si es el primer mensaje del usuario, enviar mensaje de bienvenida
        if (!chat.lastMessage || chat.lastMessage.fromMe) {
            await sendWelcomeMessage(chat);
        }
        
        // Detectar si el mensaje es una ubicación
        if (msg.location || msg.type === 'location') {
            console.log('Ubicación recibida:', msg.location);
            
            try {
                // Extraer la latitud y longitud
                const latitude = msg.location.latitude;
                const longitude = msg.location.longitude;
                
                // Enviar la ubicación al backend
                const response = await axios.post(`${FASTAPI_URL}/location`, {
                    phone_number: phone,
                    latitude: latitude,
                    longitude: longitude
                });
                
                // Responder con la ubicación recibida del backend
                if (response.data.answer) {
                    await chat.sendMessage(response.data.answer);
                } else {
                    await chat.sendMessage('📍 Tu ubicación ha sido recibida y enviada a nuestro sistema.');
                }
                
                return;
            } catch (error) {
                console.error('Error al procesar ubicación:', error);
                await msg.reply('❌ *RELÁMPAGO EXPRESS*: Ocurrió un error al procesar tu ubicación.');
            }
        }

        // Manejar comandos especiales
        if (msg.body.startsWith('#confirmar')) {
            const parts = msg.body.split(' ');
            if (parts.length >= 2) {
                const orderId = parts[1];
                await handleOrderConfirmation(msg, orderId);
            } else {
                await msg.reply('❌ *RELÁMPAGO EXPRESS*: Formato incorrecto. Uso: #confirmar [ID_PEDIDO]');
            }
            return;
        } 
        
        if (msg.body.startsWith('#rechazar')) {
            const parts = msg.body.split(' ');
            if (parts.length >= 2) {
                const orderId = parts[1];
                await handleOrderRejection(msg, orderId);
            } else {
                await msg.reply('❌ *RELÁMPAGO EXPRESS*: Formato incorrecto. Uso: #rechazar [ID_PEDIDO]');
            }
            return;
        }
        
        // Comandos para repartidores
        if (msg.body.startsWith('#precio') || msg.body.startsWith('#costo') || msg.body.startsWith('#monto') || 
            msg.body.startsWith('#p ') || msg.body.startsWith('#c ') || msg.body.startsWith('#m ')) {
            // Procesar comando de precio, lo manejará la API de FastAPI
            console.log(`Enviando comando de precio al backend: ${msg.body}`);
        }
        
        if (msg.body.startsWith('#completar') || msg.body.startsWith('#entregado') || 
            msg.body.startsWith('#co ') || msg.body.startsWith('#en ')) {
            // Procesar comando de completado, lo manejará la API de FastAPI
            console.log(`Enviando comando de completado al backend: ${msg.body}`);
        }
        
        if (msg.body === '#mispedidos' || msg.body === '#pedidos') {
            // Procesar solicitud de pedidos, lo manejará la API de FastAPI
            console.log(`Enviando solicitud de pedidos al backend: ${msg.body}`);
        }
        
        // Verificar si es un comando de ayuda
        if (msg.body.toLowerCase() === 'ayuda' || msg.body.toLowerCase() === 'help') {
            const helpMessage = `
*📌 AYUDA DE RELÁMPAGO EXPRESS*

- Para iniciar un nuevo pedido, escribe: *iniciar*
- Para reiniciar el proceso, escribe: *reiniciar*
- Para consultar un pedido existente, escribe: *consultar [ID_PEDIDO]*
- Para cancelar el proceso actual, escribe: *cancelar*
- Puedes compartir tu ubicación directamente para una entrega más precisa 📍

Si eres un repartidor:
- Para informar el precio de un pedido: *#precio [ID_PEDIDO] [MONTO]* o *#p [ID_PEDIDO] [MONTO]*
- Para marcar un pedido como entregado: *#completar [ID_PEDIDO]* o *#co [ID_PEDIDO]*
- Para ver tus pedidos activos: *#mispedidos*
`;
            await msg.reply(helpMessage);
            return;
        }
        
        // Para todos los demás mensajes, enviar al chatbot
        const response = await axios.post(`${FASTAPI_URL}/chat`, {
            message: msg.body,
            phone_number: phone
        });

        // Enviar respuesta al usuario
        if (response.data.answer) {
            await chat.sendMessage(response.data.answer);
        }

    } catch (error) {
        console.error('Error al procesar mensaje:', error);
        msg.reply('❌ *RELÁMPAGO EXPRESS*: Lo siento, ocurrió un error al procesar tu mensaje. Por favor, intenta nuevamente o escribe *ayuda* para ver opciones disponibles.');
    }
});

// Endpoint para reenviar mensajes desde FastAPI
app.post('/forward-message', async (req, res) => {
    try {
        const { to, message, order_id } = req.body;

        // Verificar que tenemos el número y mensaje
        if (!to || !message) {
            return res.status(400).json({
                status: 'error',
                message: 'Se requiere número de teléfono y mensaje'
            });
        }

        // Formatear número: eliminar cualquier caracter que no sea número
        let formattedNumber = formatPhoneNumber(to);
        
        // Añadir @c.us si no lo tiene
        if (!formattedNumber.includes('@c.us')) {
            formattedNumber = `${formattedNumber}@c.us`;
        }
        
        // Registrar el evento
        console.log(`Enviando mensaje a ${formattedNumber}${order_id ? ` para orden ${order_id}` : ''}`);
        
        // Enviar mensaje
        await client.sendMessage(formattedNumber, message);

        res.json({
            status: 'success',
            message: 'Mensaje enviado correctamente',
            order_id: order_id || null
        });

    } catch (error) {
        console.error('Error al reenviar mensaje:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error al enviar mensaje',
            error: error.message
        });
    }
});

// Nuevo endpoint para reenviar ubicaciones
app.post('/forward-location', async (req, res) => {
    try {
        const { to, latitude, longitude, order_id } = req.body;

        // Verificar que tenemos número y coordenadas
        if (!to || latitude === undefined || longitude === undefined) {
            return res.status(400).json({
                status: 'error',
                message: 'Se requiere número de teléfono y coordenadas de ubicación'
            });
        }

        // Formatear número
        let formattedNumber = formatPhoneNumber(to);
        
        // Añadir @c.us si no lo tiene
        if (!formattedNumber.includes('@c.us')) {
            formattedNumber = `${formattedNumber}@c.us`;
        }
        
        console.log(`Enviando ubicación a ${formattedNumber}${order_id ? ` para orden ${order_id}` : ''}: ${latitude}, ${longitude}`);
        
        // Crear objeto de ubicación y enviarlo
        const locationObj = new Location(latitude, longitude, "Ubicación del cliente");
        await client.sendMessage(formattedNumber, locationObj);

        res.json({
            status: 'success',
            message: 'Ubicación enviada correctamente',
            order_id: order_id || null
        });

    } catch (error) {
        console.error('Error al reenviar ubicación:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error al enviar ubicación',
            error: error.message
        });
    }
});

// Función auxiliar para formatear números de teléfono
function formatPhoneNumber(phone) {
    // Eliminar cualquier caracter que no sea número
    let formatted = phone.toString().replace(/\D/g, '');
    
    // Eliminar + si existe al inicio
    if (formatted.startsWith('+')) {
        formatted = formatted.substring(1);
    }
    
    return formatted;
}

// Endpoint para consultar estado del bot
app.get('/status', (req, res) => {
    res.json({
        status: 'active',
        service: 'Relámpago Express WhatsApp Bot',
        ready: client.info ? true : false,
        timestamp: new Date().toISOString()
    });
});

// Iniciar el cliente de WhatsApp
client.initialize();

// Iniciar servidor Express
server.listen(PORT, () => {
    console.log(`🚀 Servidor Relámpago Express escuchando en puerto ${PORT}`);
});

// Manejar errores y desconexiones
client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
    client.destroy();
    setTimeout(() => {
        console.log('Intentando reconectar...');
        client.initialize();
    }, 5000);
});

process.on('SIGINT', async () => {
    console.log('Cerrando aplicación...');
    await client.destroy();
    process.exit();
});

// Middleware para manejar errores
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        status: 'error',
        message: 'Error interno del servidor',
        error: err.message
    });
});