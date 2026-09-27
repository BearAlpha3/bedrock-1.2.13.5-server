const dgram = require("dgram");
const http = require("http");
const WebSocket = require("ws");

const HOST = "0.0.0.0";

const UDP_PORT = Number(
    process.env.UDP_PORT || 19132
);

const HTTP_PORT = Number(
    process.env.PORT || 10000
);

const GAME_VERSION = "1.2.13.5";
const PROTOCOL_VERSION = 220;

const RAKNET_MAGIC = Buffer.from([
    0x00, 0xff, 0xff, 0x00,
    0xfe, 0xfe, 0xfe, 0xfe,
    0xfd, 0xfd, 0xfd, 0xfd,
    0x12, 0x34, 0x56, 0x78
]);

const SERVER_GUID = 1234567890123456n;
const MTU = 1492;

const udp = dgram.createSocket("udp4");

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
        name: "Bedrock Survival",
        version: GAME_VERSION,
        protocol: PROTOCOL_VERSION,
        players: players.size,
        blocks: Object.keys(world.blocks).length,
        status: "online"
    }));
});

const WebSocketServer = WebSocket.WebSocketServer;

const wss = new WebSocketServer({
    server: httpServer
});

const players = new Map();

const sessions = new Map();

const world = {
    name: "Survival World",

    seed: 220,

    time: 0,

    blocks: {},

    spawn: {
        x: 0,
        y: 64,
        z: 0
    }
};

function addressKey(remote) {
    return (
        remote.address +
        ":" +
        remote.port
    );
}

function now() {
    return BigInt(Date.now());
}

function writeUInt64(buffer, value, offset) {
    buffer.writeBigUInt64BE(
        BigInt(value),
        offset
    );
}

function createPong() {
    const motd = Buffer.from(
        "MCPE;Bedrock Survival;" +
        PROTOCOL_VERSION + ";" +
        GAME_VERSION + ";" +
        players.size + ";" +
        "20;" +
        SERVER_GUID.toString() + ";" +
        "Survival World;" +
        "Survival;1;19132;19133;",
        "utf8"
    );

    const response = Buffer.alloc(
        35 + motd.length
    );

    response.writeUInt8(
        0x1c,
        0
    );

    writeUInt64(
        response,
        now(),
        1
    );

    writeUInt64(
        response,
        SERVER_GUID,
        9
    );

    RAKNET_MAGIC.copy(
        response,
        17
    );

    response.writeUInt16BE(
        motd.length,
        33
    );

    motd.copy(
        response,
        35
    );

    return response;
}

function createOpenConnectionReply1(packet) {
    let mtu = MTU;

    if (packet.length > 0) {
        const calculated = packet.length + 28;

        if (
            calculated >= 576 &&
            calculated <= MTU
        ) {
            mtu = calculated;
        }
    }

    const response = Buffer.alloc(28);

    response.writeUInt8(
        0x06,
        0
    );

    RAKNET_MAGIC.copy(
        response,
        1
    );

    writeUInt64(
        response,
        SERVER_GUID,
        17
    );

    response.writeUInt8(
        0,
        25
    );

    response.writeUInt16BE(
        mtu,
        26
    );

    return response;
}

function createIPv4Address(
    address,
    port
) {
    const parts = address
        .split(".")
        .map(Number);

    const response = Buffer.alloc(7);

    response.writeUInt8(
        4,
        0
    );

    for (
        let i = 0;
        i < 4;
        i++
    ) {
        response.writeUInt8(
            255 -
            (parts[i] || 0),
            i + 1
        );
    }

    response.writeUInt16BE(
        port,
        5
    );

    return response;
}

function createOpenConnectionReply2(
    remote,
    mtu
) {
    const response = Buffer.alloc(35);

    response.writeUInt8(
        0x08,
        0
    );

    RAKNET_MAGIC.copy(
        response,
        1
    );

    writeUInt64(
        response,
        SERVER_GUID,
        17
    );

    const clientAddress =
        createIPv4Address(
            remote.address,
            remote.port
        );

    clientAddress.copy(
        response,
        25
    );

    response.writeUInt16BE(
        mtu || MTU,
        32
    );

    response.writeUInt8(
        0,
        34
    );

    return response;
}

function createConnectionRequestAccepted(
    remote,
    pingTime
) {
    const address =
        createIPv4Address(
            remote.address,
            remote.port
        );

    const internal =
        createIPv4Address(
            "127.0.0.1",
            0
        );

    const response = Buffer.alloc(
        36
    );

    response.writeUInt8(
        0x10,
        0
    );

    address.copy(
        response,
        1
    );

    response.writeUInt16BE(
        0,
        8
    );

    response.writeUInt8(
        1,
        10
    );

    internal.copy(
        response,
        11
    );

    writeUInt64(
        response,
        pingTime || 0,
        18
    );

    writeUInt64(
        response,
        now(),
        26
    );

    return response;
}

function createConnectedPong(
    pingTime
) {
    const response = Buffer.alloc(
        17
    );

    response.writeUInt8(
        0x03,
        0
    );

    writeUInt64(
        response,
        pingTime,
        1
    );

    writeUInt64(
        response,
        now(),
        9
    );

    return response;
}

function getBlockKey(
    x,
    y,
    z
) {
    return (
        Math.floor(x) +
        ":" +
        Math.floor(y) +
        ":" +
        Math.floor(z)
    );
}

function setBlock(
    x,
    y,
    z,
    id
) {
    const key =
        getBlockKey(
            x,
            y,
            z
        );

    if (
        id === 0 ||
        id === "air"
    ) {
        delete world.blocks[key];
        return;
    }

    world.blocks[key] = {
        id: id
    };
}

function getBlock(
    x,
    y,
    z
) {
    const key =
        getBlockKey(
            x,
            y,
            z
        );

    return (
        world.blocks[key] || {
            id: 0
        }
    );
}

function createSpawnArea() {
    for (
        let x = -8;
        x <= 8;
        x++
    ) {
        for (
            let z = -8;
            z <= 8;
            z++
        ) {
            setBlock(
                x,
                63,
                z,
                2
            );

            setBlock(
                x,
                62,
                z,
                3
            );
        }
    }
}

function createPlayer(
    id,
    name
) {
    return {
        id: id,

        name:
            name ||
            "Player",

        x: world.spawn.x,

        y: world.spawn.y,

        z: world.spawn.z,

        health: 20,

        food: 20,

        inventory: {
            dirt: 0,
            stone: 0,
            wood: 0,
            cobblestone: 0
        },

        connectedAt:
            Date.now()
    };
}

function broadcast(
    data,
    except
) {
    for (
        const player of players.values()
    ) {
        if (
            player.ws &&
            player.ws.readyState ===
                WebSocket.OPEN &&
            player !== except
        ) {
            player.ws.send(
                JSON.stringify(data)
            );
        }
    }
}

function sendWorldState(ws) {
    ws.send(
        JSON.stringify({
            type: "world",

            world: {
                name: world.name,
                seed: world.seed,
                time: world.time
            },

            spawn: world.spawn,

            blocks: world.blocks
        })
    );
}

function handleWebSocket(
    ws
) {
    let player = null;

    ws.on(
        "message",
        raw => {
            let data;

            try {
                data = JSON.parse(
                    raw.toString()
                );
            } catch (error) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message:
                            "Invalid JSON"
                    })
                );

                return;
            }

            if (
                data.type ===
                "join"
            ) {
                const id =
                    Date.now().toString(36) +
                    Math.random()
                        .toString(36)
                        .substring(2, 8);

                player =
                    createPlayer(
                        id,
                        data.name
                    );

                player.ws = ws;

                players.set(
                    id,
                    player
                );

                ws.send(
                    JSON.stringify({
                        type: "joined",

                        player: {
                            id: player.id,
                            name: player.name,
                            x: player.x,
                            y: player.y,
                            z: player.z,
                            health:
                                player.health,
                            food:
                                player.food,
                            inventory:
                                player.inventory
                        }
                    })
                );

                sendWorldState(
                    ws
                );

                broadcast(
                    {
                        type: "player_join",

                        player: {
                            id: player.id,
                            name: player.name,
                            x: player.x,
                            y: player.y,
                            z: player.z
                        }
                    },
                    player
                );

                console.log(
                    "[WS] Player joined:",
                    player.name
                );

                return;
            }

            if (
                !player
            ) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message:
                            "Join first"
                    })
                );

                return;
            }

            if (
                data.type ===
                "move"
            ) {
                if (
                    typeof data.x ===
                    "number"
                ) {
                    player.x =
                        data.x;
                }

                if (
                    typeof data.y ===
                    "number"
                ) {
                    player.y =
                        data.y;
                }

                if (
                    typeof data.z ===
                    "number"
                ) {
                    player.z =
                        data.z;
                }

                broadcast(
                    {
                        type: "player_move",

                        id: player.id,

                        x: player.x,

                        y: player.y,

                        z: player.z
                    },
                    player
                );

                return;
            }

            if (
                data.type ===
                "break_block"
            ) {
                const block =
                    getBlock(
                        data.x,
                        data.y,
                        data.z
                    );

                if (
                    block.id === 0
                ) {
                    return;
                }

                setBlock(
                    data.x,
                    data.y,
                    data.z,
                    0
                );

                if (
                    block.id === 2
                ) {
                    player.inventory.dirt++;
                } else if (
                    block.id === 3
                ) {
                    player.inventory.dirt++;
                }

                const message = {
                    type:
                        "block_update",

                    x:
                        data.x,

                    y:
                        data.y,

                    z:
                        data.z,

                    id: 0
                };

                broadcast(
                    message
                );

                return;
            }

            if (
                data.type ===
                "place_block"
            ) {
                const id =
                    Number(
                        data.id || 2
                    );

                setBlock(
                    data.x,
                    data.y,
                    data.z,
                    id
                );

                const message = {
                    type:
                        "block_update",

                    x:
                        data.x,

                    y:
                        data.y,

                    z:
                        data.z,

                    id: id
                };

                broadcast(
                    message
                );

                return;
            }

            if (
                data.type ===
                "chat"
            ) {
                const message =
                    String(
                        data.message ||
                        ""
                    ).substring(
                        0,
                        200
                    );

                if (
                    message.length ===
                    0
                ) {
                    return;
                }

                broadcast({
                    type: "chat",

                    player:
                        player.name,

                    message:
                        message
                });

                console.log(
                    "[CHAT]",
                    player.name +
                    ":",
                    message
                );

                return;
            }

            if (
                data.type ===
                "ping"
            ) {
                ws.send(
                    JSON.stringify({
                        type: "pong",
                        time: Date.now()
                    })
                );
            }
        }
    );

    ws.on(
        "close",
        () => {
            if (
                !player
            ) {
                return;
            }

            players.delete(
                player.id
            );

            broadcast({
                type:
                    "player_leave",

                id:
                    player.id
            });

            console.log(
                "[WS] Player left:",
                player.name
            );
        }
    );
}

wss.on(
    "connection",
    ws => {
        console.log(
            "[WS] Connection"
        );

        handleWebSocket(
            ws
        );
    }
);

udp.on(
    "message",
    (packet, remote) => {
        if (
            !packet ||
            packet.length === 0
        ) {
            return;
        }

        const id =
            packet.readUInt8(0);

        const key =
            addressKey(
                remote
            );

        console.log(
            "[UDP]",
            key,
            "0x" +
                id
                    .toString(16)
                    .padStart(2, "0"),
            packet.length +
                " bytes"
        );

        if (
            id === 0x01
        ) {
            udp.send(
                createPong(),
                remote.port,
                remote.address
            );

            return;
        }

        if (
            id === 0x05
        ) {
            udp.send(
                createOpenConnectionReply1(
                    packet
                ),
                remote.port,
                remote.address
            );

            return;
        }

        if (
            id === 0x07
        ) {
            let clientGuid =
                null;

            if (
                packet.length >= 28
            ) {
                clientGuid =
                    packet.readBigUInt64BE(
                        packet.length - 8
                    );
            }

            sessions.set(
                key,
                {
                    address:
                        remote.address,

                    port:
                        remote.port,

                    clientGuid:
                        clientGuid,

                    connected:
                        false,

                    connectedAt:
                        Date.now()
                }
            );

            udp.send(
                createOpenConnectionReply2(
                    remote,
                    MTU
                ),
                remote.port,
                remote.address
            );

            console.log(
                "[RAKNET] Session:",
                key
            );

            return;
        }

        if (
            id === 0x09
        ) {
            const session =
                sessions.get(
                    key
                );

            if (
                !session
            ) {
                return;
            }

            let guid = 0n;
            let ping = 0n;

            if (
                packet.length >= 17
            ) {
                guid =
                    packet.readBigUInt64BE(
                        1
                    );

                ping =
                    packet.readBigUInt64BE(
                        9
                    );
            }

            session.clientGuid =
                guid;

            session.connected =
                true;

            udp.send(
                createConnectionRequestAccepted(
                    remote,
                    ping
                ),
                remote.port,
                remote.address
            );

            console.log(
                "[RAKNET] Connected:",
                key
            );

            return;
        }

        if (
            id === 0x00
        ) {
            if (
                packet.length >= 9
            ) {
                const ping =
                    packet.readBigUInt64BE(
                        1
                    );

                udp.send(
                    createConnectedPong(
                        ping
                    ),
                    remote.port,
                    remote.address
                );
            }

            return;
        }

        if (
            id === 0x13
        ) {
            const session =
                sessions.get(
                    key
                );

            if (
                session
            ) {
                session.ready =
                    true;
            }

            console.log(
                "[RAKNET] New Incoming Connection:",
                key
            );

            return;
        }

        if (
            id === 0x15 ||
            id === 0x16
        ) {
            sessions.delete(
                key
            );

            console.log(
                "[RAKNET] Session closed:",
                key
            );

            return;
        }

        if (
            id >= 0x80 &&
            id <= 0x8f
        ) {
            const session =
                sessions.get(
                    key
                );

            if (
                !session
            ) {
                return;
            }

            session.lastPacket =
                Date.now();

            console.log(
                "[RAKNET] Frame Set received"
            );

            return;
        }
    }
);

udp.on(
    "error",
    error => {
        console.error(
            "[UDP ERROR]",
            error
        );
    }
);

udp.on(
    "listening",
    () => {
        const address =
            udp.address();

        console.log(
            "================================"
        );

        console.log(
            " BEDROCK SURVIVAL SERVER"
        );

        console.log(
            "================================"
        );

        console.log(
            "Minecraft:",
            GAME_VERSION
        );

        console.log(
            "Protocol:",
            PROTOCOL_VERSION
        );

        console.log(
            "UDP:",
            address.port
        );

        console.log(
            "WebSocket:",
            HTTP_PORT
        );

        console.log(
            "Status: ONLINE"
        );

        console.log(
            "================================"
        );
    }
);

createSpawnArea();

setInterval(
    () => {
        world.time++;

        if (
            world.time >=
            24000
        ) {
            world.time = 0;
        }
    },
    50
);

setInterval(
    () => {
        for (
            const session of
                sessions.values()
        ) {
            if (
                !session.connected
            ) {
                continue;
            }

            const packet =
                Buffer.alloc(9);

            packet.writeUInt8(
                0x00,
                0
            );

            writeUInt64(
                packet,
                now(),
                1
            );

            udp.send(
                packet,
                session.port,
                session.address
            );
        }
    },
    5000
);

udp.bind(
    UDP_PORT,
    HOST
);

httpServer.listen(
    HTTP_PORT,
    HOST,
    () => {
        console.log(
            "[HTTP/WS] Listening on port",
            HTTP_PORT
        );
    }
);
