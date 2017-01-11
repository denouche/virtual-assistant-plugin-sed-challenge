let input = 
`Hello, World!
Hello, Dolly!
Hello, Sfeir!
I'm learning to say Hello
I can't say Hello I'm mute`;

let output =
`Hi, World!
Hi, Dolly!
Hi, Sfeir!
I'm learning to say Hi
I can't say Hi I'm mute`;

module.exports = {
    subject: "Le but de ce challenge est d'expérimenter la substitution simple, en remplaçant dans des phrases le mot 'Hello' par le mot 'Hi'",
    game: {
        input: input,
        output: output
    },
    sedOptions: [
    	// '-r'
    ]
};
