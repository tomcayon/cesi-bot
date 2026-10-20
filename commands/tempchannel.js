const { owner } = require('../index.js');
const fs = require('fs');
const { PermissionsBitField, ChannelType,EmbedBuilder,ButtonBuilder, ButtonStyle, ActionRowBuilder} = require('discord.js');

module.exports = {
    name: 'tempchannel',
    description: 'Create a temporary text channel',
    execute(message, args) {
        // get author name
        const author = message.user.username;

        // Get the name input from the user
        const channelName = author + '-temp';

        // Create a new text channel with the name input
        message.guild.channels.create({
            name: channelName,
            topic: message.user.id,
            type: ChannelType.GuildText,
            parent: '1164647810310881321',
            permissionOverwrites: [
                {
                    id: message.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: message.user.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels,PermissionsBitField.Flags.ManageRoles],
                },
            ],
        })
            .then((channel) => {
                // Send a message to the user confirming the creation of the new channel
                message.reply({ content: `New channel created: ${channel}`, ephemeral: true });
                // Send an embed
                const embed = new EmbedBuilder()
                    .setTitle('Temporary channel created')
                    .setDescription(`This channel was created by ${message.user.username}`)
                    .setColor(0x0099FF)

                const button = new ButtonBuilder()
                    .setCustomId('delete-channel')
                    .setLabel('Supprimer')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️')

                const row = new ActionRowBuilder()
                    .addComponents(button)

                channel.send({ embeds: [embed],components: [row]});

            })
            .catch((error) => {
                console.error(error);
                message.reply({ content: 'There was an error on creating channel', ephemeral: true });
            });
    },
};

const private = false;

//Export private const
module.exports.private = private;