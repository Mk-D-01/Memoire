const { getUserForToken } = require('./auth');
const { dbAsync } = require('./db');

function setupSocketIO(io) {
  io.on('connection', (socket) => {
    let currentUser = null;

    socket.on('authenticate', async ({ token } = {}) => {
      try {
        currentUser = await getUserForToken(token);
      } catch (err) {
        socket.emit('auth_error', { error: 'Authentication service unavailable' });
        return;
      }
      if (currentUser) {
        socket.emit('authenticated', { user: currentUser });
      } else {
        socket.emit('auth_error', { error: 'Invalid token' });
      }
    });

    socket.on('join_lobby', async ({ lobbyId } = {}) => {
      if (!lobbyId) return;
      if (!currentUser) {
        socket.emit('auth_error', { error: 'Authenticate before joining a lobby' });
        return;
      }
      const membership = await dbAsync.get(
        `SELECT id FROM lobby_members WHERE lobbyId = ? AND userId = ?`,
        [lobbyId, currentUser.id]
      );
      if (!membership) {
        socket.emit('auth_error', { error: 'You are not a member of this lobby' });
        return;
      }
      socket.join(lobbyId);
      socket.data.lobbyId = lobbyId;
      console.log(`🔌 Socket ${socket.id} joined lobby room: ${lobbyId}`);
      if (currentUser) {
        socket.to(lobbyId).emit('member_joined_room', {
          userId: currentUser.id,
          displayName: currentUser.displayName,
          avatar: currentUser.avatar
        });
      }
    });

    socket.on('leave_lobby', ({ lobbyId }) => {
      if (!lobbyId) return;
      socket.leave(lobbyId);
      if (socket.data.lobbyId === lobbyId) socket.data.lobbyId = null;
      console.log(`🔌 Socket ${socket.id} left lobby room: ${lobbyId}`);
    });

    socket.on('disconnect', () => {
      // Disconnect handling if needed
    });
  });
}

module.exports = { setupSocketIO };
