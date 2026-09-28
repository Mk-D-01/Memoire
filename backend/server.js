const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
require('dotenv').config();

const { router: authRouter } = require('./auth');
const lobbiesRouter = require('./lobbies');
const photosRouter = require('./photos');
const { setupSocketIO } = require('./socket');

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '*')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const corsOrigin = (origin, callback) => {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    return callback(null, true);
  }
  return callback(new Error('Origin is not allowed by CORS'));
};

// Enable CORS for frontend client
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser limits for base64 photo payloads
app.use(express.json({ limit: '50mb' }));

// Attach Socket.IO
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000
});

app.set('io', io);
setupSocketIO(io);

// API Routes
app.use('/auth', authRouter);
app.use('/lobbies', lobbiesRouter);
app.use('/lobbies/:lobbyId/photos', photosRouter);

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Mémoire Collaborative Engine',
    timestamp: new Date().toISOString()
  });
});

app.get('/ready', (req, res) => {
  res.json({ status: 'ready', service: 'memoire-backend' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled request error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start Server
const PORT = process.env.PORT || 3001;
const httpServer = server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Mémoire Collaborative Server running on port ${PORT}`);
  console.log(`📡 Real-Time WebSockets Ready`);
  console.log(`====================================================`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down gracefully...`);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
