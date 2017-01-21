let input = 
`static getScope() {
	// This is a comment
    return 'sed is cool';
}
static getTriggerKeywords() {
	// Oh baby
    return [
    	// you'll gonna love it
        'sed', 'stream editor'
    ];
}`;

let output =
`static getScope() {
    return 'sed is cool';
}
static getTriggerKeywords() {
    return [
        'sed', 'stream editor'
    ];
}`;

module.exports = {
    subject: "Le but de ce challenge est d'expérimenter les conditions sur le contenu des lignes en supprimant les lignes qui contiennent des commentaires",
    game: {
        input: input,
        output: output
    },
    sedOptions: []
};
