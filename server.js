'use strict';

const dgram = require('dgram');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const zlib = require('zlib');

const GAME_VERSION = '1.2.13.5';
const PROTOCOL_VERSION = 220;

const UDP_PORT = Number(process.env.UDP_PORT || 19132);
const HTTP_PORT = Number(process.env.PORT || 10000);

const SERVER_NAME = 'CUBERUSH Survival';
const MAX_PLAYERS = 50;

const MAGIC = Buffer.from([
    0x00, 0xff, 0xff, 0x00,
    0xfe, 0xfe, 0xfe, 0xfe,
    0xfd, 0xfd, 0xfd, 0xfd,
    0x12, 0x34, 0x56, 0x78
]);

const SERVER_GUID = crypto.randomBytes(8);

const sessions = new Map();
const players = new Map();

const world = new Map();

let runtimeEntityId = 1000;
let tick = 0;

function key(x, y, z) {
    return x + ',' + y + ',' + z;
}

function setBlock(x, y, z, id) {
    world.set(key(x, y, z), id);
}

function getBlock(x, y, z) {
    return world.get(key(x, y, z)) || 0;
}

function createSpawnWorld() {
    for (let x = -32; x <= 32; x++) {
        for (let z = -32; z <= 32; z++) {
            setBlock(x, 63, z, 2);
            setBlock(x, 62, z, 3);
            setBlock(x, 61, z, 3);
            setBlock(x, 60, z, 3);
        }
    }

    for (let x = -4; x <= 4; x++) {
        for (let z = -4; z <= 4; z++) {
            setBlock(x, 64, z, 2);
        }
    }
}

createSpawnWorld();

function u16be(v) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(v & 0xffff, 0);
    return b;
}

function u16le(v) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v & 0xffff, 0);
    return b;
}

function u24le(v) {
    const b = Buffer.alloc(3);
    b[0] = v & 255;
    b[1] = (v >>> 8) & 255;
    b[2] = (v >>> 16) & 255;
    return b;
}

function u32le(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    return b;
}

function i32le(v) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v | 0, 0);
    return b;
}

function u64le(v) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v), 0);
    return b;
}

function i64le(v) {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(v), 0);
    return b;
}

function f32le(v) {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v, 0);
    return b;
}

function f64le(v) {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(v, 0);
    return b;
}

function readU24LE(buf, offset) {
    return (
        buf[offset] |
        (buf[offset + 1] << 8) |
        (buf[offset + 2] << 16)
    ) >>> 0;
}

function readStringBE(buf, offset) {
    if (offset + 2 > buf.length) return null;

    const length = buf.readUInt16BE(offset);

    if (offset + 2 + length > buf.length) {
        return null;
    }

    return {
        value: buf.toString('utf8', offset + 2, offset + 2 + length),
        next: offset + 2 + length
    };
}

function writeStringBE(str) {
    const data = Buffer.from(String(str), 'utf8');

    return Buffer.concat([
        u16be(data.length),
        data
    ]);
}

function rakNetAddress(ip, port) {
    const parts = ip.split('.').map(Number);

    const b = Buffer.alloc(7);

    b[0] = 4;

    b[1] = (~parts[0]) & 255;
    b[2] = (~parts[1]) & 255;
    b[3] = (~parts[2]) & 255;
    b[4] = (~parts[3]) & 255;

    b.writeUInt16BE(port & 0xffff, 5);

    return b;
}

function serverMOTD() {
    return [
        'MCPE',
        SERVER_NAME,
        PROTOCOL_VERSION,
        GAME_VERSION,
        players.size,
        MAX_PLAYERS,
        Number('0x' + SERVER_GUID.toString('hex')),
        'CUBERUSH',
        'Survival',
        1
    ].join(';');
}

function createUnconnectedPong(pingTime) {
    return Buffer.concat([
        Buffer.from([0x1c]),
        u64le(pingTime),
        MAGIC,
        SERVER_GUID,
        writeStringBE(serverMOTD())
    ]);
}

function createOpenConnectionReply1() {
    return Buffer.concat([
        Buffer.from([0x06]),
        MAGIC,
        SERVER_GUID,
        Buffer.from([0x00]),
        u16be(1492)
    ]);
}

function createOpenConnectionReply2(clientAddress, mtu) {
    return Buffer.concat([
        Buffer.from([0x08]),
        MAGIC,
        SERVER_GUID,
        rakNetAddress(clientAddress.address, clientAddress.port),
        u16be(mtu || 1492),
        Buffer.from([0x00])
    ]);
}

function createConnectionRequestAccepted(session) {
    const clientAddress = rakNetAddress(
        session.address,
        session.port
    );

    const serverAddress = rakNetAddress(
        '0.0.0.0',
        UDP_PORT
    );

    return Buffer.concat([
        Buffer.from([0x10]),
        clientAddress,
        i64le(0),
        serverAddress,
        serverAddress,
        serverAddress,
        serverAddress,
        serverAddress,
        serverAddress,
        serverAddress,
        serverAddress,
        u64le(Date.now())
    ]);
}

function createNewIncomingConnection(session) {
    const serverAddress = rakNetAddress(
        '0.0.0.0',
        UDP_PORT
    );

    const clientAddress = rakNetAddress(
        session.address,
        session.port
    );

    return Buffer.concat([
        Buffer.from([0x13]),
        serverAddress,
        clientAddress,
        i64le(Date.now())
    ]);
}

function createConnectedPing(timestamp) {
    return Buffer.concat([
        Buffer.from([0x00]),
        i64le(timestamp)
    ]);
}

function createConnectedPong(pingTime, pongTime) {
    return Buffer.concat([
        Buffer.from([0x03]),
        i64le(pingTime),
        i64le(pongTime)
    ]);
}

function makeAck(sequence) {
    return Buffer.concat([
        Buffer.from([0xc0]),
        Buffer.from([0x01]),
        u24le(sequence)
    ]);
}

function makeNack(sequence) {
    return Buffer.concat([
        Buffer.from([0xa0]),
        Buffer.from([0x01]),
        u24le(sequence)
    ]);
}

function parseOpenConnectionRequest1(packet) {
    if (packet.length < 18) return null;

    if (packet[0] !== 0x05) return null;

    if (!packet.subarray(1, 17).equals(MAGIC)) {
        return null;
    }

    return {
        protocol: packet[17],
        mtu: packet.length
    };
}

function parseOpenConnectionRequest2(packet) {
    if (packet.length < 28) return null;

    if (packet[0] !== 0x07) return null;

    if (!packet.subarray(1, 17).equals(MAGIC)) {
        return null;
    }

    let offset = 17;

    if (offset >= packet.length) return null;

    const version = packet[offset++];

    if (version === 4) {
        if (offset + 6 > packet.length) return null;

        const ip = [
            packet[offset + 1],
            packet[offset + 2],
            packet[offset + 3],
            packet[offset + 4]
        ].join('.');

        const port = packet.readUInt16BE(offset + 5);

        offset += 7;

        if (offset + 2 > packet.length) return null;

        const mtu = packet.readUInt16BE(offset);

        return {
            address: ip,
            port,
            mtu
        };
    }

    return null;
}

function parseConnectionRequest(packet) {
    if (packet.length < 18) return null;

    if (packet[0] !== 0x09) return null;

    if (packet.length < 25) return null;

    return {
        clientGuid: packet.readBigInt64BE(1),
        timestamp: packet.readBigInt64BE(9)
    };
}

function parseFrameSet(packet) {
    if (!packet.length) return null;

    const id = packet[0];

    if (id < 0x80 || id > 0x8f) {
        return null;
    }

    if (packet.length < 4) {
        return null;
    }

    const sequence = readU24LE(packet, 1);

    let offset = 4;

    const frames = [];

    while (offset + 3 <= packet.length) {
        const flags = packet[offset];

        const reliability =
            (flags >> 5) & 0x07;

        const hasSplit =
            (flags & 0x10) !== 0;

        const bitLength =
            packet.readUInt16BE(offset + 1);

        const byteLength =
            Math.ceil(bitLength / 8);

        offset += 3;

        if (offset + byteLength > packet.length) {
            break;
        }

        const body =
            packet.subarray(
                offset,
                offset + byteLength
            );

        offset += byteLength;

        let messageIndex = null;

        if (
            reliability === 2 ||
            reliability === 3 ||
            reliability === 4 ||
            reliability === 6 ||
            reliability === 7
        ) {
            if (offset + 3 > packet.length) break;

            messageIndex = readU24LE(packet, offset);

            offset += 3;
        }

        let orderIndex = null;

        if (
            reliability === 1 ||
            reliability === 3 ||
            reliability === 4 ||
            reliability === 7
        ) {
            if (offset + 4 > packet.length) break;

            orderIndex = readU24LE(packet, offset);

            offset += 3;

            const orderChannel = packet[offset++];

            frames.push({
                reliability,
                messageIndex,
                orderIndex,
                orderChannel,
                body,
                split: null
            });

            continue;
        }

        let split = null;

        if (hasSplit) {
            if (offset + 10 > packet.length) break;

            const splitCount =
                packet.readUInt32BE(offset);

            const splitId =
                packet.readUInt16BE(offset + 4);

            const splitIndex =
                packet.readUInt32BE(offset + 6);

            offset += 10;

            split = {
                count: splitCount,
                id: splitId,
                index: splitIndex
            };
        }

        frames.push({
            reliability,
            messageIndex,
            orderIndex,
            body,
            split
        });
    }

    return {
        sequence,
        frames
    };
}

function createFrameSet(session, payload, reliability) {
    const sequence = session.sendSequence++;

    const flags =
        0x80 |
        ((reliability & 7) << 5);

    const bitLength = payload.length * 8;

    const frame = Buffer.concat([
        Buffer.from([flags]),
        u16be(bitLength),
        payload
    ]);

    return Buffer.concat([
        Buffer.from([0x84]),
        u24le(sequence),
        frame
    ]);
}

function sendFrame(session, payload, reliability) {
    if (!session || !session.socket) return;

    const packet =
        createFrameSet(
            session,
            payload,
            reliability === undefined ? 3 : reliability
        );

    session.socket.send(
        packet,
        session.port,
        session.address
    );
}

function createBatch(packets) {
    const parts = [];

    for (const packet of packets) {
        const body = Buffer.from(packet);

        const length = Buffer.alloc(4);

        length.writeUInt32BE(body.length, 0);

        parts.push(length);
        parts.push(body);
    }

    return Buffer.concat(parts);
}

function parseBatch(data) {
    const result = [];

    let offset = 0;

    while (offset + 4 <= data.length) {
        const length =
            data.readUInt32BE(offset);

        offset += 4;

        if (
            length <= 0 ||
            offset + length > data.length
        ) {
            break;
        }

        result.push(
            data.subarray(
                offset,
                offset + length
            )
        );

        offset += length;
    }

    return result;
}

function tryInflate(data) {
    try {
        return zlib.inflateRawSync(data);
    } catch (e) {
    }

    try {
        return zlib.inflateSync(data);
    } catch (e) {
    }

    return data;
}

function parseGamePacket(packet) {
    if (!packet || packet.length === 0) {
        return null;
    }

    let data = packet;

    if (data[0] === 0xfe) {
        data = data.subarray(1);

        data = tryInflate(data);
    }

    if (!data.length) {
        return null;
    }

    return {
        id: data[0],
        payload: data.subarray(1),
        raw: data
    };
}

function parseLogin(payload) {
    if (!payload || payload.length < 4) {
        return null;
    }

    const protocol =
        payload.readInt32LE(0);

    let offset = 4;

    if (offset + 4 > payload.length) {
        return {
            protocol
        };
    }

    const tokenLength =
        payload.readUInt32LE(offset);

    offset += 4;

    if (
        tokenLength < 0 ||
        offset + tokenLength > payload.length
    ) {
        return {
            protocol
        };
    }

    const tokenData =
        payload.subarray(
            offset,
            offset + tokenLength
        );

    let tokenText = '';

    try {
        tokenText =
            tokenData.toString('utf8');
    } catch (e) {
    }

    let chain = null;

    try {
        chain = JSON.parse(tokenText);
    } catch (e) {
    }

    return {
        protocol,
        chain,
        tokenText
    };
}

function sendBatch(session, packets) {
    const batch = createBatch(packets);

    const payload =
        Buffer.concat([
            Buffer.from([0xfe]),
            batch
        ]);

    sendFrame(
        session,
        payload,
        3
    );
}

function sendPlayStatus(session, status) {
    const packet =
        Buffer.concat([
            Buffer.from([0x02]),
            u32le(status)
        ]);

    sendBatch(session, [packet]);
}

function sendDisconnect(session, reason) {
    const text =
        Buffer.from(String(reason), 'utf8');

    const packet =
        Buffer.concat([
            Buffer.from([0x05]),
            Buffer.from([text.length]),
            text
        ]);

    sendBatch(session, [packet]);
}

function sendLoginSuccess(session) {
    sendPlayStatus(session, 0);
}

function sendResourcePacksInfo(session) {
    const packet =
        Buffer.concat([
            Buffer.from([0x06]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00])
        ]);

    sendBatch(session, [packet]);
}

function sendResourcePackStack(session) {
    const packet =
        Buffer.concat([
            Buffer.from([0x07]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00]),
            Buffer.from([0x00])
        ]);

    sendBatch(session, [packet]);
}

function handleGamePacket(session, packet) {
    const game =
        parseGamePacket(packet);

    if (!game) return;

    console.log(
        '[GAME]',
        session.address + ':' + session.port,
        'ID=0x' + game.id.toString(16),
        'SIZE=' + game.raw.length
    );

    if (game.id === 0x01) {
        const login =
            parseLogin(game.payload);

        if (!login) {
            console.log('[LOGIN] pacote inválido');
            return;
        }

        console.log(
            '[LOGIN] protocolo recebido:',
            login.protocol
        );

        if (
            login.protocol !== PROTOCOL_VERSION
        ) {
            console.log(
                '[LOGIN] versão incompatível:',
                login.protocol,
                'esperado:',
                PROTOCOL_VERSION
            );

            sendDisconnect(
                session,
                'Versão incompatível. Use Minecraft Bedrock 1.2.13.5.'
            );

            return;
        }

        session.login = login;
        session.state = 'LOGIN';

        const player = {
            runtimeId: runtimeEntityId++,
            name: 'Player',
            x: 0.5,
            y: 65,
            z: 0.5,
            health: 20
        };

        session.player = player;

        players.set(session.id, player);

        console.log(
            '[LOGIN] protocolo 220 aceito'
        );

        sendLoginSuccess(session);

        session.state = 'RESOURCE_PACKS';

        sendResourcePacksInfo(session);

        return;
    }

    if (game.id === 0x08) {
        console.log(
            '[RESOURCE PACK RESPONSE]'
        );

        sendResourcePackStack(session);

        return;
    }

    if (game.id === 0x09) {
        console.log(
            '[CLIENT CACHE STATUS]'
        );

        return;
    }

    if (game.id === 0x0b) {
        console.log(
            '[CLIENT -> START GAME]'
        );

        return;
    }

    if (game.id === 0x13) {
        console.log(
            '[MOVE PLAYER]'
        );

        return;
    }

    if (game.id === 0x14) {
        console.log(
            '[PLAYER ACTION]'
        );

        return;
    }

    if (game.id === 0x15) {
        console.log(
            '[BLOCK ACTION]'
        );

        return;
    }

    if (game.id === 0x0c) {
        console.log(
            '[PLAYER SPAWN]'
        );

        return;
    }
}

function handleConnectedPacket(session, packet) {
    if (packet.length === 0) return;

    const id = packet[0];

    if (id === 0x00) {
        if (packet.length >= 9) {
            const ping =
                packet.readBigInt64LE(1);

            const pong =
                createConnectedPong(
                    ping,
                    BigInt(Date.now())
                );

            session.socket.send(
                pong,
                session.port,
                session.address
            );
        }

        return;
    }

    if (id === 0x03) {
        return;
    }

    if (id === 0xa0) {
        console.log(
            '[RAKNET] NAK recebido'
        );

        return;
    }

    if (id === 0xc0) {
        console.log(
            '[RAKNET] ACK recebido'
        );

        return;
    }

    const frame =
        parseFrameSet(packet);

    if (!frame) return;

    session.lastReceiveSequence =
        frame.sequence;

    session.socket.send(
        makeAck(frame.sequence),
        session.port,
        session.address
    );

    for (const item of frame.frames) {
        if (!item.body || !item.body.length) {
            continue;
        }

        let payload =
            item.body;

        if (item.split) {
            const split =
                item.split;

            let entry =
                session.fragments.get(
                    split.id
                );

            if (!entry) {
                entry = {
                    count: split.count,
                    pieces: new Map()
                };

                session.fragments.set(
                    split.id,
                    entry
                );
            }

            entry.pieces.set(
                split.index,
                payload
            );

            if (
                entry.pieces.size ===
                entry.count
            ) {
                const parts = [];

                for (
                    let i = 0;
                    i < entry.count;
                    i++
                ) {
                    parts.push(
                        entry.pieces.get(i)
                    );
                }

                payload =
                    Buffer.concat(parts);

                session.fragments.delete(
                    split.id
                );
            } else {
                continue;
            }
        }

        handleGamePacket(
            session,
            payload
        );
    }
}

function sessionKey(address, port) {
    return address + ':' + port;
}

function createSession(socket, address, port) {
    const id =
        sessionKey(address, port);

    let session =
        sessions.get(id);

    if (!session) {
        session = {
            id,
            socket,
            address,
            port,

            state: 'OFFLINE',

            clientGuid: null,

            mtu: 1492,

            sendSequence: 0,

            lastReceiveSequence: 0,

            fragments: new Map(),

            login: null,

            player: null,

            createdAt: Date.now(),

            lastSeen: Date.now()
        };

        sessions.set(id, session);

        console.log(
            '[SESSION] criada:',
            id
        );
    }

    session.socket = socket;
    session.lastSeen = Date.now();

    return session;
}

const udp =
    dgram.createSocket('udp4');

udp.on('error', err => {
    console.error(
        '[UDP ERROR]',
        err
    );
});

udp.on('message', (packet, rinfo) => {
    try {
        if (!packet.length) {
            return;
        }

        const id =
            packet[0];

        if (id === 0x01) {
            if (packet.length >= 17) {
                const ping =
                    packet.readBigInt64BE(1);

                udp.send(
                    createUnconnectedPong(ping),
                    rinfo.port,
                    rinfo.address
                );
            }

            return;
        }

        if (id === 0x05) {
            const request =
                parseOpenConnectionRequest1(
                    packet
                );

            if (!request) {
                return;
            }

            console.log(
                '[RAKNET] OpenConnectionRequest1',
                rinfo.address,
                rinfo.port,
                'MTU',
                request.mtu
            );

            udp.send(
                createOpenConnectionReply1(),
                rinfo.port,
                rinfo.address
            );

            return;
        }

        if (id === 0x07) {
            const request =
                parseOpenConnectionRequest2(
                    packet
                );

            if (!request) {
                return;
            }

            const session =
                createSession(
                    udp,
                    rinfo.address,
                    rinfo.port
                );

            session.mtu =
                request.mtu || 1492;

            session.state =
                'CONNECTING';

            console.log(
                '[RAKNET] OpenConnectionRequest2',
                rinfo.address,
                rinfo.port,
                'MTU',
                session.mtu
            );

            udp.send(
                createOpenConnectionReply2(
                    rinfo,
                    session.mtu
                ),
                rinfo.port,
                rinfo.address
            );

            return;
        }

        const session =
            sessions.get(
                sessionKey(
                    rinfo.address,
                    rinfo.port
                )
            );

        if (!session) {
            return;
        }

        session.lastSeen =
            Date.now();

        if (id === 0x09) {
            const request =
                parseConnectionRequest(
                    packet
                );

            if (!request) {
                return;
            }

            session.clientGuid =
                request.clientGuid;

            session.state =
                'CONNECTED';

            console.log(
                '[RAKNET] ConnectionRequest:',
                session.id
            );

            udp.send(
                createConnectionRequestAccepted(
                    session
                ),
                rinfo.port,
                rinfo.address
            );

            setTimeout(() => {
                if (
                    sessions.has(session.id)
                ) {
                    udp.send(
                        createNewIncomingConnection(
                            session
                        ),
                        rinfo.port,
                        rinfo.address
                    );
                }
            }, 30);

            return;
        }

        if (
            id >= 0x80 &&
            id <= 0x8f
        ) {
            handleConnectedPacket(
                session,
                packet
            );

            return;
        }

        handleConnectedPacket(
            session,
            packet
        );
    } catch (error) {
        console.error(
            '[UDP PACKET ERROR]',
            error
        );
    }
});

udp.bind(
    UDP_PORT,
    '0.0.0.0',
    () => {
        console.log('');
        console.log(
            '=========================================='
        );
        console.log(
            ' CUBERUSH BEDROCK SURVIVAL SERVER'
        );
        console.log(
            '=========================================='
        );
        console.log(
            'Minecraft:',
            GAME_VERSION
        );
        console.log(
            'Protocol:',
            PROTOCOL_VERSION
        );
        console.log(
            'RakNet UDP:',
            UDP_PORT
        );
        console.log(
            'WebSocket/HTTP:',
            HTTP_PORT
        );
        console.log(
            '=========================================='
        );
        console.log('');
    }
);

const httpServer =
    http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(
                200,
                {
                    'Content-Type':
                        'application/json'
                }
            );

            res.end(
                JSON.stringify({
                    online: true,
                    game: GAME_VERSION,
                    protocol: PROTOCOL_VERSION,
                    players: players.size,
                    sessions: sessions.size
                })
            );

            return;
        }

        if (req.url === '/') {
            res.writeHead(
                200,
                {
                    'Content-Type':
                        'text/html; charset=utf-8'
                }
            );

            res.end(`
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>CUBERUSH Survival</title>
</head>
<body style="
background:#08030f;
color:#d9b7ff;
font-family:Arial;
padding:30px;
">
<h1>CUBERUSH Survival</h1>
<p>Bedrock ${GAME_VERSION}</p>
<p>Protocol ${PROTOCOL_VERSION}</p>
<p>UDP ${UDP_PORT}</p>
<p>Players: ${players.size}</p>
</body>
</html>
            `);

            return;
        }

        res.writeHead(404);
        res.end('Not Found');
    });

const wss =
    new WebSocket.Server({
        server: httpServer
    });

wss.on('connection', ws => {
    console.log(
        '[WS] backend conectado'
    );

    ws.send(
        JSON.stringify({
            type: 'server',
            game: GAME_VERSION,
            protocol: PROTOCOL_VERSION,
            players: players.size
        })
    );

    ws.on('message', data => {
        try {
            const message =
                JSON.parse(
                    data.toString()
                );

            if (
                message.type ===
                'broadcast'
            ) {
                broadcastWebSocket(
                    message
                );
            }

            if (
                message.type ===
                'world.set'
            ) {
                setBlock(
                    Number(message.x),
                    Number(message.y),
                    Number(message.z),
                    Number(message.block)
                );
            }

            if (
                message.type ===
                'world.get'
            ) {
                ws.send(
                    JSON.stringify({
                        type: 'world.get',
                        x: message.x,
                        y: message.y,
                        z: message.z,
                        block: getBlock(
                            Number(message.x),
                            Number(message.y),
                            Number(message.z)
                        )
                    })
                );
            }
        } catch (error) {
            console.error(
                '[WS MESSAGE ERROR]',
                error
            );
        }
    });

    ws.on('close', () => {
        console.log(
            '[WS] backend desconectado'
        );
    });
});

function broadcastWebSocket(message) {
    const text =
        JSON.stringify(message);

    wss.clients.forEach(client => {
        if (
            client.readyState ===
            WebSocket.OPEN
        ) {
            client.send(text);
        }
    });
}

httpServer.listen(
    HTTP_PORT,
    '0.0.0.0',
    () => {
        console.log(
            '[HTTP/WS] online na porta',
            HTTP_PORT
        );
    }
);

setInterval(() => {
    tick++;

    const now =
        Date.now();

    for (
        const [id, session]
        of sessions
    ) {
        if (
            now -
            session.lastSeen >
            60000
        ) {
            console.log(
                '[SESSION] timeout:',
                id
            );

            sessions.delete(id);

            if (session.player) {
                players.delete(id);
            }
        }
    }
}, 10000);

setInterval(() => {
    broadcastWebSocket({
        type: 'tick',
        tick,
        players: players.size,
        worldBlocks: world.size
    });
}, 1000);

process.on('SIGINT', () => {
    console.log(
        'Encerrando servidor...'
    );

    udp.close();

    httpServer.close();

    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log(
        'Encerrando servidor...'
    );

    udp.close();

    httpServer.close();

    process.exit(0);
});
