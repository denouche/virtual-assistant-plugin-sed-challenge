let input = 
`REPOSITORY TAG IMAGE ID CREATED SIZE
<none> <none> bdeacb374f30 3 days ago 765.3 MB
<none> <none> 60b34dc15d98 2 weeks ago 681.7 MB
php 7-apache 62001e0da76d 3 weeks ago 385.7 MB
<none> <none> c0bbf962e0f4 5 weeks ago 182.6 MB
<none> <none> 8c144afca751 5 weeks ago 181.5 MB
<none> <none> 23b244f20fef 5 weeks ago 674.8 MB
myimage latest 01972c92f953 5 weeks ago 677.3 MB`;

let output =
`bdeacb374f30
60b34dc15d98
c0bbf962e0f4
8c144afca751
23b244f20fef`;

module.exports = {
    subject: "Le but de ce challenge est d'expérimenter les conditions sur le contenu des lignes en affichant les id des images docker qui ne sont plus utilisées (les lignes contenant <none>)",
    game: {
        input: input,
        output: output
    },
    sedOptions: [
    	'-r', '-n'
    ]
};
