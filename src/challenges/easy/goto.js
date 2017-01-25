let input = 
`#header-title {
    font-size: 35px;
}
.nav-tabs>li>a {
    color: black;
    border: 1px solid #99cc00 !important;
}
.header-flags {
    display: flex;
    flex-direction: row-reverse;
}`;

let output =
`#header-title {font-size: 35px;}
.nav-tabs>li>a {color: black;border: 1px solid #99cc00 !important;}
.header-flags {display: flex;flex-direction: row-reverse;}`;

module.exports = {
    subject: "Le but de ce challenge est d'expérimenter les gotos, en concaténant sur une seule ligne chaque bloc de ce fichier CSS.",
    game: {
        input: input,
        output: output
    },
    sedOptions: [
    	'-r'
    ]
};
