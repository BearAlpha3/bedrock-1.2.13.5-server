# Bedrock 1.2.13.5 Server

Servidor experimental para Minecraft Bedrock 1.2.13.5.

## Versão

Minecraft Bedrock:

1.2.13.5

Protocolo:

220

RakNet:

10

Porta:

19132 UDP

## Iniciar

npm install

npm start

## Estrutura

server.js
package.json
.gitignore
README.md

## Importante

O servidor ainda está em desenvolvimento.

A implementação atual possui:

- UDP
- RakNet offline ping
- Open Connection Request 1
- Open Connection Request 2
- WebSocket para painel
- informações básicas dos clientes

Ainda falta implementar:

- sessão RakNet completa
- login
- StartGame
- mundo
- chunks
- jogadores
- movimento
- blocos
- inventário
- entidades
- salvamento
- One Block
