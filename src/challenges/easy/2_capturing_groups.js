let input = 
`50.6816207,3.0811608
50.6806344,3.0818817
50.679929,3.082089
50.679256,3.082604`;

let output =
`{"latitude": 50.6816207,"longitude": 3.0811608}
{"latitude": 50.6806344,"longitude": 3.0818817}
{"latitude": 50.679929,"longitude": 3.082089}
{"latitude": 50.679256,"longitude": 3.082604}`;

module.exports = {
    subject: "Le but de ce challenge est d'expérimenter la substitution avancée, avec l'utilisation de groupes capturants, en changeant le format de ces coordonnées GPS.",
    game: {
        input: input,
        output: output
    },
    sedOptions: [
    	'-r'
    ]
};
