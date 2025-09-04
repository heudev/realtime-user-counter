const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: true,
        methods: ["GET", "POST"]
    },
});

// Domain -> { currentUsers, maxCurrentUsers, maxReachedAt }
const domainStats = new Map();
// socketId -> domain
const socketDomain = new Map();

function getOrCreateDomain(domain) {
    if (!domainStats.has(domain)) {
        domainStats.set(domain, {
            currentUsers: 0,
            maxCurrentUsers: 0,
            maxReachedAt: null
        });
    }
    return domainStats.get(domain);
}

function nowISO() {
    return new Date().toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
    });
}

function broadcastDomain(domain) {
    const stats = domainStats.get(domain);
    const payload = {
        domain,
        currentUsers: stats.currentUsers,
        maxCurrentUsers: stats.maxCurrentUsers,
        maxReachedAt: stats.maxReachedAt
    };
    io.to(domain).emit('traffic', payload);
}

function extractDomainFromSocket(socket) {
    const headers = socket.handshake.headers || {};
    const origin = headers.origin || headers.referer || headers.host;
    if (!origin) return 'unknown';
    try {
        const url = new URL(origin.includes('://') ? origin : `https://${origin}`);
        return url.hostname;
    } catch (err) {
        return origin.split('/')[0];
    }
}

io.on('connection', (socket) => {
    const domain = extractDomainFromSocket(socket) || 'unknown';
    socketDomain.set(socket.id, domain);

    socket.join(domain);

    const stats = getOrCreateDomain(domain);
    stats.currentUsers += 1;
    if (stats.currentUsers > stats.maxCurrentUsers) {
        stats.maxCurrentUsers = stats.currentUsers;
        stats.maxReachedAt = nowISO();
    }
    broadcastDomain(domain);

    socket.emit('connected', { domain, socketId: socket.id });

    socket.on('setDomain', (d) => {
        const oldDomain = socketDomain.get(socket.id);
        if (!d || d === oldDomain) return;

        socket.leave(oldDomain);
        const oldStats = getOrCreateDomain(oldDomain);
        oldStats.currentUsers = Math.max(0, oldStats.currentUsers - 1);
        broadcastDomain(oldDomain);

        const newDomain = d;
        socket.join(newDomain);
        socketDomain.set(socket.id, newDomain);
        const newStats = getOrCreateDomain(newDomain);
        newStats.currentUsers += 1;
        if (newStats.currentUsers > newStats.maxCurrentUsers) {
            newStats.maxCurrentUsers = newStats.currentUsers;
            newStats.maxReachedAt = nowISO();
        }
        broadcastDomain(newDomain);
    });

    socket.on('disconnect', (reason) => {
        const domainOnDisconnect = socketDomain.get(socket.id);
        socketDomain.delete(socket.id);
        if (domainOnDisconnect) {
            const s = getOrCreateDomain(domainOnDisconnect);
            s.currentUsers = Math.max(0, s.currentUsers - 1);
            broadcastDomain(domainOnDisconnect);
        }
    });

    socket.on('error', (err) => {
        console.warn('Socket error', err);
    });
});

app.get('/stats', (req, res) => {
    const result = {};
    for (const [domain, s] of domainStats.entries()) {
        result[domain] = {
            currentUsers: s.currentUsers,
            maxCurrentUsers: s.maxCurrentUsers,
            maxReachedAt: s.maxReachedAt
        };
    }
    res.json(result);
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
    console.log(`Realtime user counter listening on port ${PORT}`);
});