const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const WebSocket = require('ws');

// Função para obter informações da land
const getLandInfo = async (landNumber) => {
    const timestamp = new Date().getTime();
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`https://pixels-server.pixels.xyz/game/findroom/pixelsNFTFarm-${landNumber}/99?v=${timestamp}`);
    return await response.json();
};

// Função para obter informações da sessão
const getSessionInfo = async (land) => {
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
};

// Função para parsear as árvores
const parseTrees = (message) => {
    const separator = 'lastChop�';
    const treeData = message.split(separator).slice(1); // Ignorar o primeiro elemento, pois está vazio

    const trees = treeData.map((tree, index) => {
        const treeInfo = tree.split('��'); // Dividir por outro padrão para obter lastChop e lastTimer
        if (treeInfo.length >= 2) {
            const lastChop = index + 1; // Número da árvore (começando de 1)
            const lastTimer = parseInt(treeInfo[1], 10); // Interpretar como inteiro
            const nextChopTime = getNextChopTime(lastTimer);
            return { lastChop, nextChopTime };
        }
        return null;
    }).filter(Boolean);

    return trees;
};

// Função para calcular o próximo tempo de corte
const getNextChopTime = (lastTimer) => {
    const nextChopTime = lastTimer + (7 * 60 * 60 * 1000) + (15 * 60 * 1000);
    return nextChopTime;
};

client.on('ready', () => {
    console.log(`Bot está online como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!land') || message.author.bot) return;

    const args = message.content.slice('!land'.length).trim().split(/ +/);
    const landNumber = args[0];

    if (isNaN(landNumber)) {
        return message.reply("Por favor, forneça um número de land válido como argumento.");
    }

    let messagesList = []; // Lista para armazenar as mensagens para esta land

    const landInfo = await getLandInfo(landNumber);
    console.log("LAND:", landInfo);
    const session = await getSessionInfo(landInfo);
    console.log("SESSION:", session);

    const ws = getWs(session, messagesList, landNumber);

    while (true) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (messagesList.length > 0) {
            // Enviar a lista de mensagens para o canal do Discord
            const channel = client.channels.cache.get('SEU_ID_AQUI');
            if (channel) {
                const landMessage = `Land ${landNumber}:\n${messagesList.join('\n')}`;
                try {
                    await channel.send(landMessage);
                    console.log('Mensagens enviadas com sucesso para o canal.');
                    messagesList = []; // Limpar a lista após enviar
                } catch (error) {
                    console.error('Erro ao enviar mensagens para o canal:', error);
                }
            } else {
                console.log('Canal não encontrado.');
            }
        }
    }
});

const getWs = (session, messagesList, landNumber) => {
    console.log("WS:", `wss://pixels-server.pixels.xyz/${session.room.processId}/${session.room.roomId}?sessionId=${session.sessionId}`);

    const ws = new WebSocket(`wss://pixels-server.pixels.xyz/${session.room.processId}/${session.room.roomId}?sessionId=${session.sessionId}`);
    ws.binaryType = "arraybuffer";
    ws.on('message', async function message(data) {
        try {
            const uint8Array = new Uint8Array(data);
            const jsonString = new TextDecoder().decode(uint8Array);

            const trees = parseTrees(jsonString);

            if (trees.length > 0) {
                // Ordenar árvores por próximo horário de corte
                trees.sort((a, b) => a.nextChopTime - b.nextChopTime);

                console.log("Trees:", trees);
                for (const tree of trees) {
                    const formattedNextChopTime = new Date(tree.nextChopTime).toLocaleTimeString();
                    console.log(`Tree ${tree.lastChop}: ${formattedNextChopTime}`);

                    // Adicionar mensagem à lista
                    const messageToSend = `Árvore ${tree.lastChop} em ${formattedNextChopTime}`;
                    messagesList.push(messageToSend);
                }
            }
        } catch (error) {
            console.log('Erro ao processar mensagem:', error);
        }
    });

    ws.on('open', function open() {
        ws.send(new Uint8Array([10]).buffer);
    });

    return ws;
};

client.login('SEU_TOKEN_AQUI');
