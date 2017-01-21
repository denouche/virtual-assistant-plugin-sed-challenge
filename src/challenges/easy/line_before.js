let input = 
`1
2
match
4
match`;

let output =
`2
4
`;

module.exports = {
    subject: "Le but de ce challenge est d'expérimenter l'utilisation du hold space, en affichant uniquement les lignes qui précèdent les lignes contenant `match`",
    game: {
        input: input,
        output: output
    },
    sedOptions: [
    	'-n'
    ]
};
