//Import owner const
const { owner } = require('../index.js');

module.exports = {
    name: 'cleargroup',
    description: 'Clear group!',
    execute(message, args) {
        //if message.user.id === owner delete all channel in category '1164647810310881321'
        if (message.user.id === owner) {
            message.reply({ content: 'All channel in category "Group" has been deleted', ephemeral: true });
            message.guild.channels.cache.forEach(channel => {
                if (channel.parentId === '1164647810310881321') {
                    channel.delete();
                }
            });
        } else {
            message.reply({ content: 'You are not allowed to use this command', ephemeral: true });
        }
    },
}
