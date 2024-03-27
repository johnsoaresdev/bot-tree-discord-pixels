const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ]
});

const WebSocket = require('ws');

class LandRequest {
    constructor(landNumber, message, channel) {
        this.landNumber = landNumber;
        this.messagesList = [];
        this.sentMessages = new Set();
        this.ws = null;
        this.message = message;
        this.channel = channel;
        this.processing = false; // Flag para indicar se a solicitação está sendo processada
        this.finished = false; // Flag para indicar se a solicitação foi finalizada
    }

    async initialize() {
        try {
            const landInfo = await this.getLandInfo();
            console.log("LAND:", landInfo);
            const session = await this.getSessionInfo(landInfo);
            console.log("SESSION:", session);

            this.ws = this.getWs(session);
            this.ws.on('open', () => {
                this.ws.send(new Uint8Array([10]).buffer);
            });

            this.ws.on('message', async (data) => {
                try {
                    if (this.finished) {
                        // Se a solicitação já foi finalizada, fechar o WebSocket
                        this.ws.close();
                        return;
                    }

                    const uint8Array = new Uint8Array(data);
                    const jsonString = new TextDecoder().decode(uint8Array);
                    const trees = this.parseTrees(jsonString);

                    if (trees.length > 0) {
                        trees.sort((a, b) => a.nextChopTime - b.nextChopTime);

                        console.log("Trees:", trees);
                        for (const tree of trees) {
                            const formattedNextChopTime = new Date(tree.nextChopTime).toLocaleTimeString();
                            console.log(`Tree ${tree.lastChop}: ${formattedNextChopTime}`);

                            const messageText = `Árvore ${tree.lastChop} em ${formattedNextChopTime}`;

                            if (!this.sentMessages.has(messageText)) {
                                this.messagesList.push(messageText);
                                this.sentMessages.add(messageText);
                            }
                        }

                        if (this.messagesList.length > 0) {
                            const landMessage = `Land ${this.landNumber}:\n${this.messagesList.join('\n')}`;
                            try {
                                await this.message.author.send(landMessage); // Enviar para a DM do autor da mensagem
                                console.log('Mensagens enviadas com sucesso para o usuário.');
                                this.messagesList.length = 0;
                            } catch (error) {
                                console.error('Erro ao enviar mensagens para o usuário:', error);
                            }

                            // Marcar a solicitação como finalizada
                            this.finished = true;
                            // Fechar o WebSocket
                            this.ws.close();
                        }
                    }
                } catch (error) {
                    console.log('Erro ao processar mensagem:', error);
                }
            });
        } catch (error) {
            console.error('Erro ao inicializar solicitação de land:', error);
        } finally {
            // Após terminar de processar, remove a instância da lista de solicitações ativas
            if (activeRequests.has(this.message.author.id)) {
                activeRequests.delete(this.message.author.id);
            }
            this.processing = false; // Define a flag de processamento de volta para false
        }
    }

    async getLandInfo() {
        const timestamp = new Date().getTime();
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`https://pixels-server.pixels.xyz/game/findroom/pixelsNFTFarm-${this.landNumber}/99?v=${timestamp}`);
        return await response.json();
    }

    async getSessionInfo(land) {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`https://pixels-server.pixels.xyz/matchmake/joinById/${land.roomId}/${land.server}`, {
            method: 'POST',
            body: JSON.stringify(
                {
                    "mapId": land.metadata.mapId,
                    "token": "iamguest",
                    "isGuest": true,
                    "cryptoWallet": {},
                    "username": "Guest-the-traveling-tourist",
                    "world": 99,
                    "ver": 6.7,
                    "avatar": "{}"
                }
            ),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        return await response.json();
    }

    parseTrees(message) {
        const separator = 'lastChop�';
        const treeData = message.split(separator).slice(1); // Ignorar o primeiro elemento, pois está vazio

        const trees = treeData.map((tree, index) => {
            const treeInfo = tree.split('��'); // Dividir por outro padrão para obter lastChop e lastTimer
            if (treeInfo.length >= 2) {
                const lastChop = index + 1; // Número da árvore (começando de 1)
                const lastTimer = parseInt(treeInfo[1], 10); // Interpretar como inteiro
                const nextChopTime = this.getNextChopTime(lastTimer);
                return { lastChop, nextChopTime };
            }
            return null;
        }).filter(Boolean);

        return trees;
    }

    getNextChopTime(lastTimer) {
        const nextChopTime = lastTimer + (7 * 60 * 60 * 1000) + (15 * 60 * 1000);
        return nextChopTime;
    }

    getWs(session) {
        console.log("WS:", `wss://pixels-server.pixels.xyz/${session.room.processId}/${session.room.roomId}?sessionId=${session.sessionId}`);
        const ws = new WebSocket(`wss://pixels-server.pixels.xyz/${session.room.processId}/${session.room.roomId}?sessionId=${session.sessionId}`);
        ws.binaryType = "arraybuffer";

        // Adicionar um listener para fechar o WebSocket quando necessário
        ws.on('close', () => {
            console.log('WebSocket fechado.');
        });

        return ws;
    }
}

const activeRequests = new Map(); // Mapa para armazenar as solicitações ativas

client.on('ready', () => {
    console.log(`Bot está online como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!land')) {
        const args = message.content.slice('!land'.length).trim().split(/ +/);
        const landNumber = parseInt(args[0]);

        if (isNaN(landNumber) || landNumber < 1 || landNumber > 5000) {
            return message.reply("Por favor, forneça um número de land válido entre 1 e 5000.");
        }

        const channel = client.channels.cache.get('ID_DA_SALA');
        if (!channel) {
            return console.log('Canal não encontrado.');
        }

        // Verifica se já existe uma solicitação ativa para o autor da mensagem
        if (activeRequests.has(message.author.id)) {
            return message.reply('Você já tem uma solicitação de land em andamento. Aguarde a resposta antes de fazer outra solicitação.');
        }

        const landRequest = new LandRequest(landNumber, message, channel);
        activeRequests.set(message.author.id, landRequest);

        // Define a flag de processamento como true para evitar múltiplas solicitações
        landRequest.processing = true;

        await landRequest.initialize();
    }

    if (message.content.startsWith('!land')) {
        // Se for o comando !land, apagar a mensagem após 3 segundos
        setTimeout(() => {
            if (!message.deleted) {
                message.delete().catch(console.error);
            }
        }, 3000); // 3 segundos
    }
});

client.login('SEU_TOKEN_AQUI');
