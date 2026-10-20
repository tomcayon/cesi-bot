//Command when the user types /ping send ms latency
module.exports = {
    name: 'ping',
    description: 'Ping!',
    execute(message, args) {
        //Reply latency
        message.reply(`Latency is ${Date.now() - message.createdTimestamp}ms.`);
},};

const private = false;

//Export private const  
module.exports.private = private;
