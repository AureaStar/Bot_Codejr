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

    // Ignorar bots e quem não tem cargo "Membro"
    if (member.user.bot) return;
    if (!member.roles.cache.has(process.env.CARGO_MEMBRO_ID)) return;

    const entrou = !oldState.channelId && newState.channelId;
    const saiu = oldState.channelId && !newState.channelId;
    const trocou = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

    // Se entrou em um dos canais permitidos
    if ((entrou || trocou) && CANAIS_SEDE_IDS.includes(newState.channelId)) {
        if (!dados.ativos[userId]) {
            dados.ativos[userId] = Date.now();
            console.log(`${member.user.tag} começou a contar.`);
        }
    } 
    
    // Se saiu ou trocou para um canal que não é de sede
    if ((saiu || trocou) && !CANAIS_SEDE_IDS.includes(newState.channelId)) {
        if (dados.ativos[userId]) {
            const tempoDecorrido = Date.now() - dados.ativos[userId];
            
            // Adiciona ao histórico acumulado do usuário
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

// --- COMANDOS ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    const dados = carregarDados();

    if (message.content.startsWith('!sede')) {
        // 1. Definir quem é o alvo (se houver menção e for Diretoria)
        let alvo = message.author;
        const mencionaAlguem = message.mentions.users.first();
        const eDiretoria = message.member?.roles.cache.has(process.env.CARGO_DIRETORIA_ID);

        if (mencionaAlguem && eDiretoria) {
            alvo = mencionaAlguem;
        }

        // 2. Pegar os dados do alvo
        const userTime = dados.historico[alvo.id]?.totalMs || 0;
        
        const totalSegundos = Math.floor(userTime / 1000);
        const horas = Math.floor(totalSegundos / 3600);
        const minutos = Math.floor((totalSegundos % 3600) / 60);
        const segundos = totalSegundos % 60;

        // 3. Enviar a resposta mencionando o alvo
        const resposta = await message.reply(
            `Olá <@${alvo.id}>, o tempo acumulado na sede esta semana é de: **${horas}h ${minutos}m ${segundos}s**.`
        );

        // 4. Deletar a mensagem do bot e a do usuário após 1 minuto (60000ms)
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
        
        // 1. Transformar o objeto em Array e filtrar quem tem tempo
        const listaRank = Object.keys(dados.historico).map(id => {
            return {
                id: id,
                nome: dados.historico[id].nome,
                totalMs: dados.historico[id].totalMs
            };
        });

        // 2. Ordenar do maior para o menor
        listaRank.sort((a, b) => b.totalMs - a.totalMs);

        // 3. Pegar o Top 3
        const top3 = listaRank.slice(0, 3);

        if (top3.length === 0) {
            return message.reply("Ainda não há ninguém no ranking desta semana! 💧");
        }

        // 4. Montar a mensagem
        let msgRank = "🏆 **TOP 3 SEDENTÁRIOS DA SEMANA** 🏆\n\n";
        const medalhas = ["🥇", "🥈", "🥉"];

        top3.forEach((user, index) => {
            const totalSegundos = Math.floor(user.totalMs / 1000);
            const horas = Math.floor(totalSegundos / 3600);
            const minutos = Math.floor((totalSegundos % 3600) / 60);
            
            msgRank += `${medalhas[index]} **${user.nome}** - ${horas}h ${minutos}m\n`;
        });

        const respostaRank = await message.reply(msgRank);

        // Opcional: deletar o rank após 1 minuto para não poluir o chat
        setTimeout(() => {
            respostaRank.delete().catch(() => {});
            message.delete().catch(() => {});
        }, 60000);
    }

    // --- DENTRO DO messageCreate ---
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
            
            ctx.save(); // Salva o estado atual
            ctx.globalAlpha = 0.3; // AJUSTE AQUI: 0.0 (invisível) a 1.0 (totalmente opaca)
            ctx.drawImage(fundo, 0, 0, canvas.width, canvas.height);
            ctx.restore(); // Restaura o estado (volta a opacidade para 1.0)
            
        } catch (e) {
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            console.log("Aviso: Imagem de fundo não encontrada.");
        }

        // Camada escura opcional (Pode manter ou remover, dependendo do fundo)
        // Se a opacidade da imagem for baixa, essa camada preta ajudará a dar contraste
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Desenhar o Avatar Circular
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

        // Borda do Avatar
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(100, 100, 72, 0, Math.PI * 2, true);
        ctx.stroke();

        // 3. Textos
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

        // 4. Enviar a imagem
        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'perfil.png' });
        const resposta = await message.reply({ files: [attachment] });

        setTimeout(() => {
            resposta.delete().catch(() => {});
            message.delete().catch(() => {});
        }, 60000);
    }
});

// --- AGENDAMENTO (DOMINGO 23:59) ---
cron.schedule('59 23 * * 0', () => {
    const dados = carregarDados();
    // Limpa apenas o histórico semanal
    dados.historico = {};
    salvarDados(dados);
    console.log("Semana resetada!");
}, { timezone: "America/Sao_Paulo" });

client.login(process.env.TOKEN);