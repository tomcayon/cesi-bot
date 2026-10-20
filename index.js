const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ],
});


const owner = '365124713623846913'

// Export owner const
module.exports.owner = owner;

// Detect command with each files in /commands
client.commands = new Map();
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(path.join(__dirname, 'commands', file));
    client.commands.set(command.name, command);
}

// Sync slash commands.
// GUILD_ID défini  → enregistrement instantané sur cette guilde (idéal en dev).
// GUILD_ID absent  → enregistrement global (toutes les guildes, propagation ~1h).
client.on('ready', async () => {
    // Replace ALL commands atomically — removes orphans and duplicates in one call
    const commandData = commandFiles.map(file => require(path.join(__dirname, 'commands', file)));

    const guildId = process.env.GUILD_ID;
    try {
        if (guildId) {
            const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
            await guild.commands.set(commandData);
            console.log(`${commandData.length} commande(s) synchronisée(s) sur la guilde ${guildId} : ${commandData.map(c => '/' + c.name).join(', ')}`);
        } else {
            await client.application.commands.set(commandData);
            console.log(`${commandData.length} commande(s) synchronisée(s) globalement : ${commandData.map(c => '/' + c.name).join(', ')}`);
        }
    } catch (err) {
        console.error('Échec de la synchronisation des commandes :', err);
    }

    console.log(`Connecté en tant que ${client.user.tag}`);
});

// Detect slash command
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    // Ignore stale interactions (replayed after a bot restart)
    if (Date.now() - interaction.createdTimestamp > 2500) return;
    try {
        await client.commands.get(interaction.commandName)?.execute(interaction);
    } catch (err) {
        console.error(`Erreur commande /${interaction.commandName}:`, err);
        const payload = { content: '❌ Une erreur est survenue.', ephemeral: true };
        if (interaction.deferred) interaction.editReply(payload).catch(() => {});
        else if (!interaction.replied) interaction.reply(payload).catch(() => {});
    }
});

// Detect button click
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'delete-channel' && interaction.user.id === interaction.channel.topic) {
        interaction.channel.delete();
    } 
    else if (interaction.customId === 'create-channel') {
        // Play tempchannel.js command
        const command = client.commands.get('tempchannel');
        command.execute(interaction);
    }
    else {
        interaction.reply({ content: 'You are not the owner of this channel', ephemeral: true });
    }
});




client.login(process.env.TOKEN);