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

// Enable CORS for frontend client
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser limits for base64 photo payloads
app.use(express.json({ limit: '50mb' }));
app.use(express.parse ? express.parse({ limit: '50mb' }) : express.json({ limit: '50mb' }));

// Attach Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
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

// Start Server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Mémoire Collaborative Server running on port ${PORT}`);
  console.log(`📡 Real-Time WebSockets Ready`);
  console.log(`====================================================`);
});
