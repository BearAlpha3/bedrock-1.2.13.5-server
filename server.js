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

function sessionKey(remote) {
    return remote.address + ":" + remote.port;
}

function createPong() {
    const motd = Buffer.from(
        "MCPE;Bedrock Survival;220;1.2.13.5;0;20;1234567890123456;Survival;Survival;1;19132;19133;",
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

    RAKNET_MAGIC.copy(response, 17);

    response.writeUInt16BE(
        motd.length,
        33
    );

    motd.copy(response, 35);

    return response;
}

function createOpenConnectionReply1() {
    const response = Buffer.alloc(28);

    response.writeUInt8(0x06, 0);

    RAKNET_MAGIC.copy(response, 1);

    response.writeBigInt64BE(
        SERVER_GUID,
        17
    );

    response.writeUInt8(0, 25);

    response.writeUInt16BE(
        1492,
        26
    );

    return response;
}

function createIPv4Address(address, port) {
    const parts = address
        .split(".")
        .map(Number);

    const response = Buffer.alloc(7);

    response.writeUInt8(4, 0);

    for (let i = 0; i < 4; i++) {
        response.writeUInt8(
            255 - (parts[i] || 0),
            i + 1
        );
    }

    response.writeUInt16BE(
        port,
        5
    );

    return response;
}

function createOpenConnectionReply2(remote) {
    const address = createIPv4Address(
        remote.address,
        remote.port
    );

    const response = Buffer.alloc(35);

    response.writeUInt8(0x08, 0);

    RAKNET_MAGIC.copy(response, 1);

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

function createConnectionRequestAccepted(remote) {
    const response = Buffer.alloc(28);

    response.writeUInt8(0x10, 0);

    const address = createIPv4Address(
        remote.address,
        remote.port
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

    const internalAddress =
        createIPv4Address(
            "127.0.0.1",
            0
        );

    internalAddress.copy(
        response,
        11
    );

    response.writeBigInt64BE(
        BigInt(Date.now()),
        18
    );

    response.writeBigInt64BE(
        BigInt(Date.now()),
        26
    );

    return response;
}

server.on("message", (packet, remote) => {
    if (!packet || packet.length === 0) {
        return;
    }

    const id = packet.readUInt8(0);
    const key = sessionKey(remote);

    console.log(
        "[RAKNET]",
        key,
        "ID=0x" +
        id.toString(16).padStart(2, "0"),
        "SIZE=" +
        packet.length
    );

    if (id === 0x01) {
        server.send(
            createPong(),
            remote.port,
            remote.address
        );

        console.log(
            "[RAKNET] Pong enviado"
        );

        return;
    }

    if (id === 0x05) {
        server.send(
            createOpenConnectionReply1(),
            remote.port,
            remote.address
        );

        console.log(
            "[RAKNET] Reply 1 enviado"
        );

        return;
    }

    if (id === 0x07) {
        sessions.set(key, {
            address: remote.address,
            port: remote.port,
            connectedAt: Date.now(),
            guid: null
        });

        server.send(
            createOpenConnectionReply2(remote),
            remote.port,
            remote.address
        );

        console.log(
            "[RAKNET] Reply 2 enviado"
        );

        return;
    }

    if (id === 0x09) {
        if (packet.length >= 17) {
            const guid =
                packet.readBigInt64BE(1);

            const session =
                sessions.get(key);

            if (session) {
                session.guid = guid;
                session.connectionRequested = true;
            }
        }

        server.send(
            createConnectionRequestAccepted(
                remote
            ),
            remote.port,
            remote.address
        );

        console.log(
            "[RAKNET] Connection Request Accepted enviado"
        );

        return;
    }

    if (id === 0x00) {
        if (packet.length >= 9) {
            const time =
                packet.readBigInt64BE(1);

            const response = Buffer.alloc(17);

            response.writeUInt8(
                0x03,
                0
            );

            response.writeBigInt64BE(
                time,
                1
            );

            response.writeBigInt64BE(
                BigInt(Date.now()),
                9
            );

            server.send(
                response,
                remote.port,
                remote.address
            );

            console.log(
                "[RAKNET] Connected Pong enviado"
            );
        }

        return;
    }

    if (
        id >= 0x80 &&
        id <= 0x8f
    ) {
        console.log(
            "[RAKNET] Frame Set recebido"
        );

        return;
    }
});

server.on("listening", () => {
    const address = server.address();

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
        "RakNet UDP: " +
        address.port
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
