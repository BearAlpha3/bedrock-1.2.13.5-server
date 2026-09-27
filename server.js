const dgram = require("dgram");
const http = require("http");
const WebSocket = require("ws");

const UDP_HOST = "0.0.0.0";
const UDP_PORT = Number(process.env.UDP_PORT || 19132);
const WS_PORT = Number(process.env.WS_PORT || 8080);

const GAME_VERSION = "1.2.13.5";
const PROTOCOL = 220;
const RAKNET_PROTOCOL = 10;

const SERVER_GUID = BigInt(
    process.env.SERVER_GUID || "1234567890123456"
);

const MAGIC = Buffer.from([
    0x00, 0xff, 0xff, 0x00,
    0xfe, 0xfe, 0xfe, 0xfe,
    0xfd, 0xfd, 0xfd, 0xfd,
    0x12, 0x34, 0x56, 0x78
]);

const udp = dgram.createSocket("udp4");

const clients = new Map();

function writeShort(value) {
    const buffer = Buffer.alloc(2);

    buffer.writeUInt16BE(value, 0);

    return buffer;
}

function writeLong(value) {
    const buffer = Buffer.alloc(8);

    buffer.writeBigInt64BE(
        BigInt(value),
        0
    );

    return buffer;
}

function createPong(timestamp) {

    const motd =
        "MCPE;" +
        "One Block Server;" +
        PROTOCOL + ";" +
        GAME_VERSION + ";" +
        "0;" +
        "20;" +
        SERVER_GUID.toString() + ";" +
        "One Block;" +
        "Survival;" +
        "0;" +
        UDP_PORT + ";" +
        UDP_PORT + ";";

    const text = Buffer.from(
        motd,
        "utf8"
    );

    return Buffer.concat([
        Buffer.from([0x1c]),

        writeLong(timestamp),

        writeLong(SERVER_GUID),

        MAGIC,

        writeShort(text.length),

        text
    ]);
}

function createOpenConnectionReply1(mtu) {

    return Buffer.concat([

        Buffer.from([0x06]),

        MAGIC,

        writeLong(SERVER_GUID),

        Buffer.from([0x00]),

        writeShort(mtu)
    ]);
}

function createIPv4Address(ip, port) {

    const parts = ip
        .split(".")
        .map(Number);

    return Buffer.from([
        0x04,

        (0xff - parts[0]) & 255,
        (0xff - parts[1]) & 255,
        (0xff - parts[2]) & 255,
        (0xff - parts[3]) & 255,

        (port >> 8) & 255,
        port & 255
    ]);
}

function createOpenConnectionReply2(
    ip,
    port,
    mtu
) {

    return Buffer.concat([

        Buffer.from([0x08]),

        MAGIC,

        writeLong(SERVER_GUID),

        createIPv4Address(
            ip,
            port
        ),

        writeShort(mtu),

        Buffer.from([0x00])
    ]);
}

function checkMagic(buffer, position) {

    if (
        buffer.length <
        position + MAGIC.length
    ) {
        return false;
    }

    return buffer
        .subarray(
            position,
            position + MAGIC.length
        )
        .equals(MAGIC);
}

udp.on(
    "message",
    (packet, remote) => {

        if (!packet.length) {
            return;
        }

        const id = packet[0];

        /*
         * UNCONNECTED PING
         */

        if (
            id === 0x01 &&
            packet.length >= 25 &&
            checkMagic(packet, 9)
        ) {

            const timestamp =
                packet.readBigInt64BE(1);

            const pong =
                createPong(timestamp);

            udp.send(
                pong,
                remote.port,
                remote.address
            );

            console.log(
                "[PING] " +
                remote.address +
                ":" +
                remote.port
            );

            return;
        }

        /*
         * OPEN CONNECTION REQUEST 1
         */

        if (
            id === 0x05 &&
            packet.length >= 18 &&
            checkMagic(packet, 1)
        ) {

            const raknetVersion =
                packet[17];

            console.log(
                "[OPEN1] " +
                remote.address +
                ":" +
                remote.port +
                " RakNet=" +
                raknetVersion
            );

            if (
                raknetVersion !==
                RAKNET_PROTOCOL
            ) {

                console.log(
                    "[WARN] RakNet diferente. " +
                    "Recebido: " +
                    raknetVersion +
                    " Esperado: " +
                    RAKNET_PROTOCOL
                );
            }

            const mtu =
                packet.length;

            const reply =
                createOpenConnectionReply1(
                    mtu
                );

            udp.send(
                reply,
                remote.port,
                remote.address
            );

            return;
        }

        /*
         * OPEN CONNECTION REQUEST 2
         */

        if (
            id === 0x07 &&
            packet.length >= 35 &&
            checkMagic(packet, 1)
        ) {

            const mtu =
                packet.readUInt16BE(
                    packet.length - 10
                );

            const clientGuid =
                packet.readBigInt64BE(
                    packet.length - 8
                );

            const key =
                remote.address +
                ":" +
                remote.port;

            clients.set(
                key,
                {
                    address: remote.address,
                    port: remote.port,
                    guid: clientGuid.toString(),
                    mtu: mtu
                }
            );

            console.log(
                "[OPEN2] " +
                key
            );

            const reply =
                createOpenConnectionReply2(
                    remote.address,
                    remote.port,
                    mtu
                );

            udp.send(
                reply,
                remote.port,
                remote.address
            );

            return;
        }

        /*
         * RAKNET PACKETS
         */

        if (
            id >= 0x80 &&
            id <= 0x8f
        ) {

            console.log(
                "[RAKNET] packet " +
                id.toString(16) +
                " de " +
                remote.address
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

udp.bind(
    UDP_PORT,
    UDP_HOST,
    () => {

        console.log("");
        console.log(
            "================================"
        );
        console.log(
            " BEDROCK 1.2.13.5 SERVER"
        );
        console.log(
            "================================"
        );

        console.log(
            "Game: " +
            GAME_VERSION
        );

        console.log(
            "Protocol: " +
            PROTOCOL
        );

        console.log(
            "RakNet: " +
            RAKNET_PROTOCOL
        );

        console.log(
            "UDP: " +
            UDP_PORT
        );

        console.log(
            "Status: ONLINE"
        );

        console.log(
            "================================"
        );
        console.log("");
    }
);

/*
 * WEBSOCKET / PAINEL
 *
 * Isto NÃO substitui o UDP do Minecraft.
 */

const httpServer =
    http.createServer(
        (request, response) => {

            if (request.url === "/") {

                response.writeHead(
                    200,
                    {
                        "Content-Type":
                            "application/json"
                    }
                );

                response.end(
                    JSON.stringify(
                        {
                            server:
                                "Bedrock 1.2.13.5",

                            protocol:
                                PROTOCOL,

                            players:
                                clients.size,

                            udp:
                                UDP_PORT
                        },
                        null,
                        2
                    )
                );

                return;
            }

            response.writeHead(404);

            response.end(
                "Not Found"
            );
        }
    );

const websocket =
    new WebSocket.Server({
        server: httpServer
    });

websocket.on(
    "connection",
    socket => {

        socket.send(
            JSON.stringify({
                type:
                    "server_status",

                version:
                    GAME_VERSION,

                protocol:
                    PROTOCOL,

                players:
                    clients.size
            })
        );

        socket.on(
            "message",
            message => {

                let data;

                try {

                    data =
                        JSON.parse(
                            message.toString()
                        );

                } catch (error) {

                    socket.send(
                        JSON.stringify({
                            type:
                                "error",

                            message:
                                "JSON inválido"
                        })
                    );

                    return;
                }

                if (
                    data.type ===
                    "status"
                ) {

                    socket.send(
                        JSON.stringify({
                            type:
                                "server_status",

                            version:
                                GAME_VERSION,

                            protocol:
                                PROTOCOL,

                            players:
                                clients.size
                        })
                    );
                }
            }
        );
    }
);

httpServer.listen(
    WS_PORT,
    "0.0.0.0",
    () => {

        console.log(
            "HTTP/WebSocket: " +
            WS_PORT
        );
    }
);
