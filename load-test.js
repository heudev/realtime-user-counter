const io = require("socket.io-client");

const TOTAL_CLIENTS = 5000;
const BATCH_SIZE = 100;
const DELAY = 500;

let connected = 0;
let disconnected = 0;
let attempted = 0;

function createSocket() {
    const socket = io("http://localhost:3002", {
        query: { domain: "example.com" },
        transports: ["websocket"],
        reconnection: false,
        timeout: 5000
    });

    socket.on("connect", () => {
        connected++;
        attempted++;
        console.log(`✅ Connected: ${connected}/${TOTAL_CLIENTS}`);
    });

    socket.on("connect_error", (err) => {
        console.log(`⚠️ Connection error: ${err.message}`);
        attempted++;
    });

    socket.on("disconnect", () => {
        disconnected++;
        console.log(`❌ Disconnected: ${disconnected}`);
    });
}

function openBatch() {
    for (let i = 0; i < BATCH_SIZE && attempted < TOTAL_CLIENTS; i++) {
        createSocket();
    }

    if (attempted < TOTAL_CLIENTS) {
        setTimeout(openBatch, DELAY);
    } else {
        console.log("🚀 All connections are being attempted...");
    }
}

setInterval(() => {
    console.log(`📊 Current status -> Connected: ${connected}, Disconnected: ${disconnected}, Attempted: ${attempted}/${TOTAL_CLIENTS}`);
}, 2000);

openBatch();
