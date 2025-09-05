const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const Redis = require('ioredis');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: true, methods: ["GET", "POST"] },
    transports: ['websocket'],
    pingInterval: 5000,
    pingTimeout: 10000
});

const redis = new Redis({
    host: 'redis',
    port: 6379
});

// Domain -> { currentUsers, maxCurrentUsers, maxReachedAt } (in-memory for currentUsers)
const domainStats = new Map();
// socketId -> domain
const socketDomain = new Map();

const REDIS_KEY = 'domainStats';

function nowISO() {
    return new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
}

async function getOrCreateDomain(domain) {
    if (!domainStats.has(domain)) {
        // Load from Redis
        const data = await redis.hget(REDIS_KEY, domain);
        let parsed = { maxCurrentUsers: 0, maxReachedAt: null };
        if (data) {
            try {
                parsed = JSON.parse(data);
            } catch { }
        }
        domainStats.set(domain, {
            currentUsers: 0,
            maxCurrentUsers: parsed.maxCurrentUsers,
            maxReachedAt: parsed.maxReachedAt
        });
    }
    return domainStats.get(domain);
}

async function saveDomainToRedis(domain) {
    const stats = domainStats.get(domain);
    await redis.hset(REDIS_KEY, domain, JSON.stringify({
        maxCurrentUsers: stats.maxCurrentUsers,
        maxReachedAt: stats.maxReachedAt
    }));
}

function extractDomainFromSocket(socket) {
    const headers = socket.handshake.headers || {};
    const origin = headers.origin || headers.referer || headers.host;
    if (!origin) return 'unknown';
    try {
        const url = new URL(origin.includes('://') ? origin : `https://${origin}`);
        return url.hostname;
    } catch {
        return origin.split('/')[0];
    }
}

async function broadcastDomain(domain) {
    const stats = await getOrCreateDomain(domain);
    const payload = {
        domain,
        currentUsers: stats.currentUsers,
        maxCurrentUsers: stats.maxCurrentUsers,
        maxReachedAt: stats.maxReachedAt
    };
    console.log(`[${nowISO()}] [${domain}] Current: ${stats.currentUsers}, Max: ${stats.maxCurrentUsers} (at ${stats.maxReachedAt})`);
    io.to(domain).emit('traffic', payload);
}

io.on('connection', async (socket) => {
    const domain = extractDomainFromSocket(socket) || 'unknown';
    socketDomain.set(socket.id, domain);

    socket.join(domain);

    const stats = await getOrCreateDomain(domain);
    stats.currentUsers += 1;

    if (stats.currentUsers > stats.maxCurrentUsers) {
        stats.maxCurrentUsers = stats.currentUsers;
        stats.maxReachedAt = nowISO();
        await saveDomainToRedis(domain);
    }

    await broadcastDomain(domain);
    socket.emit('connected', { domain, socketId: socket.id });

    socket.on('setDomain', async (newDomain) => {
        const oldDomain = socketDomain.get(socket.id);
        if (!newDomain || newDomain === oldDomain) return;

        socket.leave(oldDomain);
        const oldStats = await getOrCreateDomain(oldDomain);
        oldStats.currentUsers = Math.max(0, oldStats.currentUsers - 1);
        await broadcastDomain(oldDomain);

        socket.join(newDomain);
        socketDomain.set(socket.id, newDomain);
        const newStats = await getOrCreateDomain(newDomain);
        newStats.currentUsers += 1;
        if (newStats.currentUsers > newStats.maxCurrentUsers) {
            newStats.maxCurrentUsers = newStats.currentUsers;
            newStats.maxReachedAt = nowISO();
            await saveDomainToRedis(newDomain);
        }
        await broadcastDomain(newDomain);
    });

    socket.on('disconnect', async () => {
        const domainOnDisconnect = socketDomain.get(socket.id);
        socketDomain.delete(socket.id);
        if (domainOnDisconnect) {
            const s = await getOrCreateDomain(domainOnDisconnect);
            s.currentUsers = Math.max(0, s.currentUsers - 1);
            await broadcastDomain(domainOnDisconnect);
        }
    });

    socket.on('error', (err) => {
        console.warn('Socket error', err);
    });
});

app.get('/stats', async (req, res) => {
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