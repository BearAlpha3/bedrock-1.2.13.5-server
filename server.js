const dgram = require("dgram");

const PORT = Number(process.env.PORT || 19132);
const HOST = "0.0.0.0";

const server = dgram.createSocket("udp4");

server.on("listening", () => {
    const address = server.address();

    console.log("================================");
    console.log("BEDROCK SURVIVAL SERVER");
    console.log("Minecraft: 1.2.13.5");
    console.log("Protocol: 220");
    console.log("UDP: " + address.address + ":" + address.port);
    console.log("================================");
});

server.on("message", (message, remote) => {
    const packetId = message.length > 0
        ? message.readUInt8(0)
        : -1;

    console.log(
        "[UDP] " +
        remote.address +
        ":" +
        remote.port +
        " | packet 0x" +
        packetId.toString(16).padStart(2, "0") +
        " | " +
        message.length +
        " bytes"
    );
});

server.on("error", (error) => {
    console.error("[UDP ERROR]", error);
});

server.bind(PORT, HOST);
