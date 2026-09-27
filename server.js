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

function createPong(packet) {
    const buffer = Buffer.alloc(35 + packet.length);

    buffer.writeUInt8(0x1c, 0);
    buffer.writeBigInt64BE(BigInt(Date.now()), 1);
    buffer.writeBigInt64BE(SERVER_GUID, 9);

    RAKNET_MAGIC.copy(buffer, 17);

    const motd =
        "MCPE;Bedrock Survival;" +
        "220;1.2.13.5;0;20;";

    buffer.write(motd, 33, "utf8");

    return buffer;
}

server.on("message", (packet, remote) => {
    if (packet.length === 0) return;

    const id = packet[0];

    console.log(
        "[RAKNET]",
        remote.address + ":" + remote.port,
        "ID=0x" + id.toString(16).padStart(2, "0")
    );

    if (id === 0x01) {
        const response = createPong(packet);

        server.send(
            response,
            remote.port,
            remote.address
        );

        console.log("[RAKNET] Pong enviado");
    }
});

server.on("listening", () => {
    const address = server.address();

    console.log("");
    console.log("================================");
    console.log(" BEDROCK SURVIVAL SERVER");
    console.log(" Minecraft: 1.2.13.5");
    console.log(" Protocol: 220");
    console.log(" UDP: " + address.port);
    console.log("================================");
    console.log("");
});

server.on("error", error => {
    console.error("[UDP ERROR]", error);
});

server.bind(PORT, HOST);
