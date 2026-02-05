const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const cron = require('node-cron');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates 
    ] 
});

const DATA_FILE = './dados_sede.json';
const CANAIS_SEDE_IDS = [process.env.SEDE_VIRTUAL,
                            process.env.DAILY_1,
                            process.env.DAILY_2,
                            process.env.DAILY_3,
                            process.env.DAILY_4
                        ];

function carregarDados() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ ativos: {}, historico: {} }, null, 4));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE));
}

function salvarDados(dados) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(dados, null, 4));
}

client.on('voiceStateUpdate', (oldState, newState) => {
    const dados = carregarDados();
    const userId = newState.id || oldState.id;
    const member = newState.member || oldState.member;

    if (member.user.bot) return;
    if (!member.roles.cache.has(process.env.CARGO_MEMBRO_ID)) return;

    const entrou = !oldState.channelId && newState.channelId;
    const saiu = oldState.channelId && !newState.channelId;
    const trocou = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

    if ((entrou || trocou) && CANAIS_SEDE_IDS.includes(newState.channelId)) {
        if (!dados.ativos[userId]) {
            dados.ativos[userId] = Date.now();
            console.log(`${member.user.tag} começou a contar.`);
        }
    } 
    
    if ((saiu || trocou) && !CANAIS_SEDE_IDS.includes(newState.channelId)) {
        if (dados.ativos[userId]) {
            const tempoDecorrido = Date.now() - dados.ativos[userId];
            
            if (!dados.historico[userId]) {
                dados.historico[userId] = { nome: member.user.tag, totalMs: 0 };
            }
            dados.historico[userId].totalMs += tempoDecorrido;
            
            delete dados.ativos[userId];
            console.log(`${member.user.tag} parou de contar. Tempo total acumulado.`);
        }
    }
    salvarDados(dados);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    const dados = carregarDados();

    if (message.content.startsWith('!sede')) {
        let alvo = message.author;
        const mencionaAlguem = message.mentions.users.first();
        const eDiretoria = message.member?.roles.cache.has(process.env.CARGO_DIRETORIA_ID);

        if (mencionaAlguem && eDiretoria) {
            alvo = mencionaAlguem;
        }

        const userTime = dados.historico[alvo.id]?.totalMs || 0;
        
        const totalSegundos = Math.floor(userTime / 1000);
        const horas = Math.floor(totalSegundos / 3600);
        const minutos = Math.floor((totalSegundos % 3600) / 60);
        const segundos = totalSegundos % 60;

        const resposta = await message.reply(
            `Olá <@${alvo.id}>, o tempo acumulado na sede esta semana é de: **${horas}h ${minutos}m ${segundos}s**.`
        );

        setTimeout(() => {
            resposta.delete().catch(err => console.log("Erro ao deletar resposta:", err));
            message.delete().catch(err => console.log("Erro ao deletar comando:", err));
        }, 60000);
    }

    if (message.content === '!exportar') {
        const dados = carregarDados();
        let csv = "Usuario;Horas\n";
        
        for (const id in dados.historico) {
            const h = (dados.historico[id].totalMs / (1000 * 60 * 60)).toFixed(2);
            csv += `${dados.historico[id].nome};${h}\n`;
        }

        const attachment = new AttachmentBuilder(Buffer.from(csv), { name: 'relatorio_sede.csv' });
        message.reply({ files: [attachment] });
    }

    if (message.content === '!rank') {
        const dados = carregarDados();
        
        const listaRank = Object.keys(dados.historico).map(id => {
            return {
                id: id,
                nome: dados.historico[id].nome,
                totalMs: dados.historico[id].totalMs
            };
        });

        listaRank.sort((a, b) => b.totalMs - a.totalMs);

        const top3 = listaRank.slice(0, 3);

        if (top3.length === 0) {
            return message.reply("Ainda não há ninguém no ranking desta semana! 💧");
        }

        let msgRank = "🏆 **TOP 3 SEDENTÁRIOS DA SEMANA** 🏆\n\n";
        const medalhas = ["🥇", "🥈", "🥉"];

        top3.forEach((user, index) => {
            const totalSegundos = Math.floor(user.totalMs / 1000);
            const horas = Math.floor(totalSegundos / 3600);
            const minutos = Math.floor((totalSegundos % 3600) / 60);
            
            msgRank += `${medalhas[index]} **${user.nome}** - ${horas}h ${minutos}m\n`;
        });

        const respostaRank = await message.reply(msgRank);

        setTimeout(() => {
            respostaRank.delete().catch(() => {});
            message.delete().catch(() => {});
        }, 60000);
    }

    if (message.content.startsWith('!perfil')) {
        const dados = carregarDados();
        let alvo = message.author;
        const mencionaAlguem = message.mentions.users.first();
        const eDiretoria = message.member?.roles.cache.has(process.env.CARGO_DIRETORIA_ID);
        
        if (mencionaAlguem && eDiretoria) alvo = mencionaAlguem;

        const userStats = dados.historico[alvo.id] || { totalMs: 0 };
        const totalSegundos = Math.floor(userStats.totalMs / 1000);
        const horas = Math.floor(totalSegundos / 3600);
        const minutos = Math.floor((totalSegundos % 3600) / 60);

        const canvas = createCanvas(800, 200);
        const ctx = canvas.getContext('2d');

       try {
            const fundo = await loadImage('./fundo.png');
            
            ctx.save(); 
            ctx.globalAlpha = 0.3; 
            ctx.drawImage(fundo, 0, 0, canvas.width, canvas.height);
            ctx.restore(); 
        } catch (e) {
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            console.log("Aviso: Imagem de fundo não encontrada.");
        }

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.beginPath();
        ctx.arc(100, 100, 70, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();

        try {
            const avatarUrl = alvo.displayAvatarURL({ extension: 'png', size: 256 });
            const avatar = await loadImage(avatarUrl);
            ctx.drawImage(avatar, 30, 30, 140, 140);
        } catch (e) {
            ctx.fillStyle = '#555';
            ctx.fill();
        }
        ctx.restore();

        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(100, 100, 72, 0, Math.PI * 2, true);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(alvo.username.toUpperCase(), 200, 50);

        ctx.fillStyle = '#ba95ff';
        ctx.font = '20px sans-serif';
        ctx.fillText('MEMBRO DA CODE JUNIOR', 200, 80);

        ctx.fillStyle = '#ffffff';
        ctx.font = '22px sans-serif';
        ctx.fillText('TEMPO ACUMULADO NESTA SEMANA:', 200, 135);
        
        ctx.fillStyle = '#f1c40f'; 
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(`${horas}h ${minutos}m`, 200, 185);

        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'perfil.png' });
        const resposta = await message.reply({ files: [attachment] });

        setTimeout(() => {
            resposta.delete().catch(() => {});
            message.delete().catch(() => {});
        }, 60000);
    }

    if (message.content === '!sedefim') {
        if (!message.member.voice.channel) {
            return message.reply("Você precisa estar em um canal de voz para usar este comando.");
        }

        if (!CANAIS_SEDE_IDS.includes(message.member.voice.channelId)) {
            return message.reply("Você não está contando horas na Sede no momento.");
        }

        const dados = carregarDados();
        const userId = message.author.id;
        
        let tempoTotalMs = dados.historico[userId]?.totalMs || 0;
        
        if (dados.ativos[userId]) {
            const sessaoAtual = Date.now() - dados.ativos[userId];
            tempoTotalMs += sessaoAtual;
        }

        const totalSegundos = Math.floor(tempoTotalMs / 1000);
        const horas = Math.floor(totalSegundos / 3600);
        const minutos = Math.floor((totalSegundos % 3600) / 60);
        const segundos = totalSegundos % 60;

        const resposta = await message.reply(
            `Parabéns pelo foco, <@${userId}>! 🚀\nVocê encerrou por hoje com um total acumulado de: **${horas}h ${minutos}m ${segundos}s**.`
        );

        try {
            const canalSaideira = process.env.SAIDEIRA;
            if (canalSaideira) {
                await message.member.voice.setChannel(canalSaideira);
            } else {
                console.log("ERRO: ID da SAIDEIRA não configurado no .env");
            }
        } catch (error) {
            console.error("Erro ao mover usuário:", error);
            message.channel.send("Não consegui te mover para a Saideira. Verifique minhas permissões.");
        }

        setTimeout(() => {
            resposta.delete().catch(() => {});
            message.delete().catch(() => {});
        }, 60000);
    }
});

cron.schedule('59 23 * * 0', () => {
    const dados = carregarDados();
    dados.historico = {};
    salvarDados(dados);
    console.log("Semana resetada!");
}, { timezone: "America/Sao_Paulo" });

client.login(process.env.TOKEN);