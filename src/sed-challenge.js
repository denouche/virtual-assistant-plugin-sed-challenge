const AssistantFeature = require('virtual-assistant').AssistantFeature,
    ConfigurationService = require('virtual-assistant').ConfigurationService,
    StateMachine = require('javascript-state-machine'),
    _ = require('lodash'),
    vm = require('vm'),

    path = require('path'),
    fs = require('fs-extra'),
    crypto = require('crypto'),
    spawn = require('child-process-promise').spawn;


class SedChallenge extends AssistantFeature {

    static getScope() {
        return AssistantFeature.scopes.GLOBAL;
    }

    static getTriggerKeywords() {
        return [
            'sed', 'stream editor'
        ];
    }

    static getDescription() {
        return 'Lancer un challenge de `sed`';
    }

    static getTTL() {
        return 120 /* min */ * 60;
    }



    constructor(interfac, context) {
        super(interfac, context);
        StateMachine.create({
            target: SedChallenge.prototype,
            error: function(eventName, from, to, args, errorCode, errorMessage) {
                console.error('Uncatched error',  'event ' + eventName + ' was naughty :- ' + errorMessage);
                console.error(args);
            },
            initial: { state: 'Init', event: 'startup', defer: true }, // defer is important since the startup event is launched after the fsm is stored in cache
            terminal: 'End',
            events: [
                { name: 'startup', from: 'none',   to: 'Init' },

                { name: 'help', from: 'Init',   to: 'Help' },

                { name: 'wait', from: 'Help',   to: 'Wait' },

                { name: 'im', from: 'Wait',   to: 'Answer' },
                { name: 'channel', from: 'Wait',   to: 'AnswerChannel' },

                { name: 'wait', from: 'AnswerChannel',   to: 'Wait' },
                { name: 'wait', from: 'Answer',   to: 'Wait' },

                { name: 'end', from: '*', to: 'End' },
            ]
        });

        // context is : 
        // { 
        //  userId: xxx, // the user who launched the feature
        //  channelId: xxx, // the channel where the feature was launched
        //  interfaceType: im|channel // The interface type where the feature was initialy launched
        //  model: {
        //    players: {
        //      'USERID': {
        //        bestAnswer: 'regex',
        //        tries: 0, // number of tries
        //        win: 1
        //      }
        //    },
        //    currentGame: undefined
        //  }
        // }
        this.context.model = {
            players: {},
            currentGame: undefined
        };
    }


    handle(message, context) {
        if(this.current === 'none') {
            this.startup();
        }
        else {
            if(message.match(/(?:help|aide)/i) && this.canTriggerEvent('help')) {
                this.help(context.userId);
            }
            else if(message.match(/(?:fin|end|exit|stop|quit|quitter|bye)/i) && this.canTriggerEvent('end')) {
                this.end(context.userId);
            }
            else if(this.canTriggerEvent('text')) {
                this.text(message, context.userId);
            }
            else if('channel' === context.interfaceType && this.canTriggerEvent('channel')) {
                this.channel(message, context.userId, context.channelId);
            }
            else if('im' === context.interfaceType && this.canTriggerEvent('im')) {
                this.im(message, context.userId);
            }
        }
    }




    /************ HELPERS *****************/

    _getGame() {
        if(!this.context.model.currentGame) {
            var gameName = ConfigurationService.get('sedchallenge.game');
            this.context.model.currentGame = undefined;
            try {
                this.context.model.currentGame = require(path.join(__dirname, `challenges/${gameName}.js`));
            } catch(e) {
                console.error(`Error while loading sed game ${gameName}`);
                let toSend = [`Une erreur est survenue, le jeu à charger *${gameName}* n'existe pas.`];
                let files = fs.walkSync(path.join(__dirname, 'challenges'));
                toSend.push("Pour configurer le challenge en cours, utilisez le mode configuration et affectez l'une des valeurs suivantes à la propriété `sedchallenge.game` :");
                files.forEach(function(f) {
                    let matcher = f.match(new RegExp('^' + path.join(__dirname, 'challenges') + '/(.+)\.js$'))
                    if(matcher && matcher[1]) {
                        toSend.push('`' + matcher[1] + '`');
                    }
                });
                this.send(toSend);
                this.send('Fin du challenge.');
                this.clearCache();
            }
        }
        return this.context.model.currentGame;
    }

    getPlayersArray() {
        var playersArray = [];
        _.forOwn(this.context.model.players, function(player, playerId) {
            playersArray.push(_.assignIn(_.cloneDeep(player), {playerId: playerId}));
        });
        return playersArray;
    }

    _generateRandomFilename() {
        let len = 12;
        return crypto.randomBytes(Math.ceil(len/2))
            .toString('hex') // convert to hexadecimal format
            .slice(0,len);   // return required number of characters
    }

    _evaluateSedScript(input, sedScript) {
        let filename = this._generateRandomFilename(),
            fullTempFilePath = path.join('/tmp/', filename);
        fs.writeFileSync(fullTempFilePath, sedScript);
        return spawn('sed', ['-f', fullTempFilePath, '--version'], { capture: [ 'stderr' ]})
            .then(() => {
                // No error in sed script, let's apply to the input
                return spawn('echo', ['-n', input], { capture: [ 'stdout', 'stderr' ]});
            })
            .then((input) => {
                console.log('input: ', input.stdout.toString());
                let sed = spawn('sed', _.concat(this._getGame().sedOptions, '-f', fullTempFilePath), { capture: [ 'stdout', 'stderr' ]});
                sed.childProcess.stdin.write(new Buffer(input.stdout.toString()));
                sed.childProcess.stdin.end();
                return sed;
            })
            .then((output) => {
                console.log('output: ', output.stdout.toString());
                fs.removeSync(fullTempFilePath);
                return output.stdout.toString();
            })
            .catch((err) => {
                fs.removeSync(fullTempFilePath);
                return Promise.reject(err);
            });
    }

    getGameToDisplay(sedScript) {
        var toSend = [],
            game = this._getGame();

        toSend.push(game.subject);
        toSend.push('\n\n');
        toSend.push('Vous devez trouver le script sed permettant de passer du texte suivant:');
        toSend.push('```');
        toSend.push(game.game.input);
        toSend.push('```');
        toSend.push('au texte suivant:');
        toSend.push('```');
        toSend.push(game.game.output);
        toSend.push('```');
        if(game.sedOptions.length > 0) {
            toSend.push('La commande `sed` sera executée avec les options suivantes : `' + game.sedOptions.join(' ') + '`');
        }
        else {
            toSend.push('La commande `sed` sera executée sans option particulière');
        }
        
        if(sedScript) {
            return this._evaluateSedScript(game.game.input, sedScript)
                .then(function(output) {
                    let valid = game.game.output === output;
                    if(!valid) {
                        toSend.push("\n\nMalheureusement la bonne réponse n'est pas :");
                        toSend.push(sedScript);
                    }
                    toSend.push("Ce script a donné l'output suivant :");
                    toSend.push('```');
                    toSend.push(output);
                    toSend.push('```');
                    return {
                        toSend: toSend,
                        valid: valid
                    };
                })
                .catch(function(error) {
                    toSend.push('\n')
                    toSend.push("Une erreur est survenue lors de l'évaluation de votre script sed:")
                    toSend.push(error.stderr);
                    return Promise.reject({
                        toSend: toSend,
                        valid: false
                    });
                });
        }

        return Promise.resolve({
            toSend: toSend,
            valid: false
        });
    }

    getScoreBoard() {
        let playersArray = this.getPlayersArray(),
            topCount = 10;
        if(ConfigurationService.get('sedchallenge.scoreboadSize') !== undefined
            && ConfigurationService.get('sedchallenge.scoreboadSize') !== null) {
            if(ConfigurationService.get('sedchallenge.scoreboadSize') > 0) {
                topCount = ConfigurationService.get('sedchallenge.scoreboadSize') + _.filter(playersArray, 'win').length;
            }
            else {
                topCount = undefined;
            }
        }
        let bestPlayersByScore = _.chain(playersArray)
            .orderBy(['win'], ['asc'])
            .slice(0, topCount)
            .value();
        return bestPlayersByScore;
    }

    displayScoreboard(channelId) {
        var toSend = [],
            bestPlayersByScore = this.getScoreBoard();
        if(bestPlayersByScore.length > 0) {
            toSend.push('Voici le tableau de score actuel :');
            _.forEach(bestPlayersByScore, function(p) {
                toSend.push('• ' + '<@' + p.playerId + '> : ' + p.tries + ' tentative' + (p.tries>1?'s':''));
            });
            this.send(toSend, channelId);
        }
    }


    /******** STATES *********/

    onInit(event, from, to) {
        var fromUser = this.interface.getDataStore().getUserById(this.context.userId),
            imPlayerId = this.interface.getDataStore().getDMByUserId(this.context.userId).id;
        if(!fromUser.is_admin
            && !this.interface.isAdministrator(this.context.userId)
            && imPlayerId !== this.context.channelId /* playing alone in training mode */) {
            this.send('Désolé, seul un administrateur peut lancer un challenge public. Mais vous pouvez vous entrainer seul, pour cela venez me parler en message privé.');
            this.clearCache();
        }
        else {
            this.send("C'est parti pour le Challenge sed !");
            this.help();
        }
    }

    onHelp(event, from, to) {
        try{
        this.getGameToDisplay()
            .then((data) => {
                var toSend = data.toSend;
                toSend.push('\n');
                toSend.push('Pour participer envoyez-moi vos propositions de scripts sed en *message privé* !');
                toSend.push('Le premier à trouver une bonne réponse remporte le challenge !')
                this.send(toSend);
                this.wait();
            })
        }
        catch(e) {
            console.error(e);
        }
    }

    onWait(event, from, to) {
        // Do nothing
    }

    onAnswerChannel(event, from, to, text, fromUserId, channelId) {
        this.send('Merci de me faire vos propositions de réponse en *message privé* !', channelId);
        this.displayScoreboard(channelId);
        this.wait();
    }

    onAnswer(event, from, to, text, playerId) {
        console.log('BEGIN ###################################################');
        console.log('ANSWER', playerId, text);
        try {
        var imPlayerId = this.interface.getDataStore().getDMByUserId(playerId).id;
        this.send('Vérifions ...', imPlayerId);

        if(!this.context.model.players[playerId]) {
            // First try of this player, add his name to the score board
            this.context.model.players[playerId] = {
                tries: 0
            };
        }
        if(this.context.model.players[playerId].win !== undefined) {
            this.send('Vous avez déjà gagné ! Retournez travailler !', imPlayerId);
        }
        else {
            console.log('onAnswer', 'testTEXT', text);
            if(text) {
                this.context.model.players[playerId].tries++;
                var gameToDisplay = this.getGameToDisplay(text);
                gameToDisplay.then((gameToDisplayResult) => {
                    if(gameToDisplayResult.valid) {
                        this.context.model.players[playerId].bestAnswer = text;
                        var lastWinner = _.maxBy(this.getPlayersArray(), 'win');
                        this.context.model.players[playerId].win = lastWinner ? lastWinner.win + 1 : 1;
                        this.send('Bravo, vous avez trouvé une bonne réponse !', imPlayerId);

                        var bestPlayersByScore = _.chain(this.getPlayersArray())
                                .orderBy(['win'], ['asc'])
                                .value(),
                            toSend = [
                                'Un joueur a trouvé la bonne réponse !'
                            ];
                        if(bestPlayersByScore.length > 0) {
                            toSend.push('<@' + playerId + '> termine le challenge !');
                        }
                        this.send(toSend);
                        this.displayScoreboard();
                        if(imPlayerId === this.context.channelId) {
                            // Game was launched in private mode, by the current user.
                            // He won, finish the game
                            this.end();
                            return;
                        }
                    }
                    else {
                        var toSend = gameToDisplayResult.toSend,
                            validCount = gameToDisplayResult.valid;

                        this.send(toSend, imPlayerId);
                        this.displayScoreboard();
                    }
                    console.log('END ###################################################');
                    this.wait();
                })
                .catch((error) => {
                    this.send(error.toSend, imPlayerId);
                    console.log('END ###################################################');
                    this.wait();
                });
            }
        }
        }
        catch(e) {
            console.error('------------------------------------------')
            console.error('onAnswer error', e);
            console.error('------------------------------------------')
        }
    }

    onleaveWait(event, from, to, fromUserId) {
        if(event === 'end' && fromUserId) {
            var fromUser = this.interface.getDataStore().getUserById(fromUserId),
                imPlayerId = this.interface.getDataStore().getDMByUserId(fromUserId).id;
            if(!fromUser.is_admin
                && !this.interface.isAdministrator(this.context.userId)
                && imPlayerId !== this.context.channelId /* playing alone in training mode */) {
                this.send('Désolé, seul un administrateur peut mettre fin au challenge.');
                return false;
            }
        }
    }

    onEnd(event, from, to) {
        var bestPlayersByScore = _.chain(this.getPlayersArray())
                .orderBy(['win'], ['asc'])
                .value(),
            gameLength = this._getGame().game.length,
            toSend = [
                'Challenge terminé !'
            ];
        if(bestPlayersByScore.length > 0) {
            _.forEach(bestPlayersByScore, function(player) {
                if(player.win !== undefined) {
                    toSend.push('<@' + player.playerId + '> remporte le challenge avec le script suivant : `' + player.bestAnswer + '` en ' + player.tries + ' tentative' + (player.tries>1?'s':''));
                }
                else {
                    toSend.push('<@' + player.playerId + '> termine le script suivant : `' + player.bestAnswer + '` en ' + player.tries + ' tentative' + (player.tries>1?'s':''));
                }
            })
        }
        else {
            toSend.push("Personne n'a trouvé la bonne réponse ...");
        }
        this.send(toSend);
        this.clearCache();
    }

}


module.exports = SedChallenge;
