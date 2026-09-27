const dgram = require("dgram");

const PORT = Number(process.env.PORT || 19132);
const HOST = "0.0.0.0";

const server = dgram.createSocket("udp4");

const RAKNET_MAGIC = Buffer.from([
    0x00, 0xff, 0xff, 0x00,
    0xfe, 0xfe, 0xfe, 0xfe,
    0xfd, 0xfd, 0xfd, 0xfd,
    0x12, 0x34, 0x56, 0x78
]);

const SERVER_GUID = 1234567890123456n;

const sessions = new Map();

function createPong() {
    const motd = Buffer.from(
        "MCPE;Bedrock Survival;220;1.2.13.5;0;20;",
        "utf8"
    );

    const response = Buffer.alloc(
        35 + motd.length
    );

    response.writeUInt8(0x1c, 0);

    response.writeBigInt64BE(
        BigInt(Date.now()),
        1
    );

    response.writeBigInt64BE(
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

function createOpenConnectionReply1() {
    const response = Buffer.alloc(28);

    response.writeUInt8(0x06, 0);

    RAKNET_MAGIC.copy(
        response,
        1
    );

    response.writeUInt8(0, 17);

    response.writeUInt16BE(
        1492,
        18
    );

    response.writeBigInt64BE(
        SERVER_GUID,
        20
    );

    return response;
}

function createIPv4Address(address, port) {
    const parts = address
        .split(".")
        .map(Number);

    const buffer = Buffer.alloc(7);

    buffer.writeUInt8(4, 0);

    for (let i = 0; i < 4; i++) {
        buffer.writeUInt8(
            255 - (parts[i] || 0),
            i + 1
        );
    }

    buffer.writeUInt16BE(
        port,
        5
    );

    return buffer;
}

function createOpenConnectionReply2(port) {
    const address = createIPv4Address(
        "127.0.0.1",
        port
    );

    const response = Buffer.alloc(
        35
    );

    response.writeUInt8(
        0x08,
        0
    );

    RAKNET_MAGIC.copy(
        response,
        1
    );

    response.writeBigInt64BE(
        SERVER_GUID,
        17
    );

    address.copy(
        response,
        25
    );

    response.writeUInt16BE(
        1492,
        32
    );

    response.writeUInt8(
        0,
        34
    );

    return response;
}

server.on("message", (packet, remote) => {
    if (!packet || packet.length === 0) {
        return;
    }

    const id = packet.readUInt8(0);

    console.log(
        "[RAKNET]",
        remote.address +
        ":" +
        remote.port,
        "ID=0x" +
        id.toString(16).padStart(2, "0"),
        "SIZE=" +
        packet.length
    );

    if (id === 0x01) {
        const response = createPong();

        server.send(
            response,
            remote.port,
            remote.address
        );

        console.log(
            "[RAKNET] Pong enviado"
        );

        return;
    }

    if (id === 0x05) {
        const response =
            createOpenConnectionReply1();

        server.send(
            response,
            remote.port,
            remote.address
        );

        console.log(
            "[RAKNET] Open Connection Reply 1 enviado"
        );

        return;
    }

    if (id === 0x07) {
        const response =
            createOpenConnectionReply2(
                remote.port
            );

        server.send(
            response,
            remote.port,
            remote.address
        );

        const key =
            remote.address +
            ":" +
            remote.port;

        sessions.set(
            key,
            {
                address: remote.address,
                port: remote.port,
                connectedAt: Date.now()
            }
        );

        console.log(
            "[RAKNET] Sessão criada:",
            key
        );

        return;
    }

    if (
        id >= 0x80 &&
        id <= 0x8f
    ) {
        const key =
            remote.address +
            ":" +
            remote.port;

        if (!sessions.has(key)) {
            console.log(
                "[RAKNET] Pacote recebido sem sessão"
            );

            return;
        }

        console.log(
            "[RAKNET] Pacote de sessão recebido"
        );

        return;
    }
});

server.on("listening", () => {
    const address =
        server.address();

    console.log("");
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
        "Minecraft: 1.2.13.5"
    );
    console.log(
        "Protocol: 220"
    );
    console.log(
        "RakNet: UDP"
    );
    console.log(
        "Host: " +
        address.address
    );
    console.log(
        "Port: " +
        address.port
    );
    console.log(
        "Sessions: 0"
    );
    console.log(
        "Status: ONLINE"
    );
    console.log(
        "================================"
    );
    console.log("");
});

server.on("error", error => {
    console.error(
        "[UDP ERROR]",
        error
    );
});

server.bind(
    PORT,
    HOST
);
