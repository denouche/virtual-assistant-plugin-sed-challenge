let input = 
`"latitude": 50.6816207
"longitude": 3.0811608
"latitude": 50.6806344
"longitude": 3.0818817
"latitude": 50.679929
"longitude": 3.082089
"latitude": 50.679256
"longitude": 3.082604`;

let output =
`{"latitude": 50.6806344,"longitude": 3.0818817}
{"latitude": 50.679929,"longitude": 3.082089}
{"latitude": 50.679256,"longitude": 3.082604}
{"latitude": 50.6781818,"longitude": 3.0822446}`;

module.exports = {
    subject: "Le but de ce challenge est d'expérimenter le travail sur de multiples lignes, en rassemblant sur une ligne les coordonnées GPS qui sont à la base sur deux lignes, et en les changeant de format",
    game: {
        input: input,
        output: output
    },
    sedOptions: [
    	'-r'
    ]
};
