const { io } = require("socket.io-client");

const TOTAL_CLIENTS = 5000;
let connected = 0;

for (let i = 0; i < TOTAL_CLIENTS; i++) {
    const socket = io("localhost:3002", {
        transports: ["websocket"],
        reconnection: false,
    });

    socket.on("connect", () => {
        connected++;
        if (connected % 100 === 0) console.log(`${connected} clients connected`);
    });

    socket.on("disconnect", () => { });
}
