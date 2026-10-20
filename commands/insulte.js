module.exports = {
    name: 'insulte',
    description: 'Insulte!',
    options:[
        {
            name: 'user',
            description: 'User to insulte',
            type: 6,
            required: true,
        }
    ],
    execute(message, args) {
        //Get user in const user
        const user = message.options.getUser('user');
        //Reply
        message.reply(`${user.toString()} ton esprit est aussi vide que le Saint-Graal après la quête du roi Arthur.`);
},};

const private = false;

//Export private const
module.exports.private = private;