const VirtualAssistant = require('virtual-assistant').VirtualAssistant,
    AssistantFeature = require('virtual-assistant').AssistantFeature,
    ConfigurationService = require('virtual-assistant').ConfigurationService,
    Statistics = require('virtual-assistant').StatisticsService,
    StateMachine = require('javascript-state-machine'),
    _ = require('lodash'),
    vm = require('vm'),
    path = require('path'),
    fs = require('fs-extra'),
    crypto = require('crypto'),
    spawn = require('child-process-promise').spawn;


class SedChallenge extends AssistantFeature {

    static init() {
        Statistics.register('SED_END');
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
                this.debug('Uncatched error',  'event ' + eventName + ' was naughty :- ' + errorMessage);
                this.debug(args);
            },
            initial: { state: 'Init', event: 'startup', defer: true }, // defer is important since the startup event is launched after the fsm is stored in cache
            terminal: 'End',
            events: [
                { name: 'startup', from: 'none',   to: 'Init' },

                { name: 'text', from: 'Init',   to: 'ChallengeChosen' },

                { name: 'help', from: 'ChallengeChosen',   to: 'Help' },

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
        //        bestScore: 0 // number of valid lines best answer
        //        bestAnswer: 'script',
        //        tries: 0, // number of tries
        //        win: 1
        //      }
        //    },
        //    currentGame: undefined,
        //    currentGameName: undefined
        //  }
        // }
        this.context.model = {
            players: {},
            currentGame: undefined,
            currentGameName: undefined
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

    getAvailableGames() {
        let results = [];
        let files = fs.walkSync(path.join(__dirname, 'challenges'));
        files.forEach(function(f) {
            let matcher = f.match(new RegExp('^' + path.join(__dirname, 'challenges') + '/(.+)\.js$'))
            if(matcher && matcher[1]) {
                results.push(matcher[1]);
            }
        });
        return results;
    }

    _getGame() {
        if(!this.context.model.currentGame) {
            if(!this.context.model.currentGameName) {
                this.context.model.currentGameName = ConfigurationService.get('sedchallenge.game');
            }
            let gameName = this.context.model.currentGameName;
            try {
                this.context.model.currentGame = require(path.join(__dirname, `challenges/${gameName}.js`));
            } catch(e) {
                this.debug(`Error while loading sed game ${gameName}`);
                let toSend = [`Une erreur est survenue, le jeu à charger *${gameName}* n'existe pas.`];
                toSend.push("Pour configurer le challenge en cours, utilisez le mode configuration et affectez l'une des valeurs suivantes à la propriété `sedchallenge.game` :");
                this.getAvailableGames().forEach(function(g) {
                    toSend.push('`' + matcher[1] + '`');
                });
                this.send(toSend);
                this.send('Fin du challenge.');
                this.clearCache();
            }
        }
        return this.context.model.currentGame;
    }

    getPlayersArray() {
        let playersArray = [];
        _.forOwn(this.context.model.players, function(player, playerId) {
            if(player.bestScore !== undefined) {
                playersArray.push(_.assignIn(_.cloneDeep(player), {playerId: playerId}));
            }
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
            fullTempFilePath = path.join('/tmp/', filename),
            killed = false;
        fs.writeFileSync(fullTempFilePath, sedScript);
        return spawn('sed', _.concat(this._getGame().sedOptions, '-f', fullTempFilePath, '--version'), { capture: [ 'stderr' ] })
            .then(() => {
                // No error in sed script, let's apply to the input
                return spawn('echo', ['-n', input], { capture: [ 'stdout', 'stderr' ]});
            })
            .then((input) => {
                let sed = spawn('sed', _.concat(this._getGame().sedOptions, '-f', fullTempFilePath), { capture: [ 'stdout', 'stderr' ] });
                setTimeout(function(){ killed = true; sed.childProcess.kill()}, 500);
                sed.childProcess.stdin.write(new Buffer(input.stdout.toString()));
                sed.childProcess.stdin.end();
                return sed;
            })
            .then((output) => {
                fs.removeSync(fullTempFilePath);
                return output.stdout.toString();
            })
            .catch((err) => {
                fs.removeSync(fullTempFilePath);
                if(killed) {
                    return Promise.reject({stderr: 'Evaluating you script took too much time, please check for infinite loops.'});
                }
                return Promise.reject(err);
            });
    }

    _getGameSplitted(game) {
        return game.split(/(?<=\n)/);
    }

    getGameToDisplay(sedScript) {
        let toSend = [],
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
                .then((output) => {
                    let valid = (game.game.output === output
                        || game.game.output + '\n' === output);

                    let wantedOutputLineArray = this._getGameSplitted(game.game.output),
                        outputLineArray = this._getGameSplitted(output),
                        equalsLinesCount = 0;
                    _.forEach(wantedOutputLineArray, function(value, i) {
                        if(i < outputLineArray.length 
                            && (value === outputLineArray[i])
                                || (i === (wantedOutputLineArray.length - 1) && (value + '\n') === outputLineArray[i])) {
                            equalsLinesCount++;
                        }
                    });
                    if(!valid) {
                        toSend.push("\n\nMalheureusement la bonne réponse n'est pas :");
                        toSend.push('```');
                        toSend.push(sedScript);
                        toSend.push('```');
                    }
                    toSend.push("Ce script a donné l'output suivant :");
                    toSend.push('```');
                    toSend.push(output);
                    toSend.push('```');
                    return {
                        toSend: toSend,
                        valid: valid,
                        validCount: equalsLinesCount
                    };
                })
                .catch((error) => {
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

    _getScoreBoard() {
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
            .orderBy(['win', 'bestScore'], ['asc', 'desc'])
            .slice(0, topCount)
            .value();
        return bestPlayersByScore;
    }

    displayScoreboard(channelId) {
        let toSend = [],
            game = this._getGame().game,
            gameLength = this._getGameSplitted(game.output).length,
            bestPlayersByScore = this._getScoreBoard();
        if(bestPlayersByScore.length > 0) {
            toSend.push('Voici le tableau de score actuel :');
            _.forEach(bestPlayersByScore, function(p) {
                toSend.push('• ' + '<@' + p.playerId + '> : ' + p.bestScore + ' / ' + gameLength + ' ligne'+(p.bestScore>1?'s':'')+' correcte'+(p.bestScore>1?'s':'')+ ' en ' + p.tries + ' tentative' + (p.tries>1?'s':''));
            });
            this.send(toSend, channelId);
        }
    }


    /**************** STATES *****************/

    onInit(event, from, to) {
        let fromUser = this.interface.getDataStore().getUserById(this.context.userId),
            imPlayerId = this.interface.getDataStore().getDMByUserId(this.context.userId).id;
        if(!fromUser.is_admin
            && !this.interface.isAdministrator(this.context.userId)
            && imPlayerId !== this.context.channelId /* playing alone in training mode */) {
            this.send('Désolé, seul un administrateur peut lancer un challenge public. Mais vous pouvez vous entrainer seul, pour cela venez me parler en message privé.');
            this.clearCache();
        }
        else {
            this.send("C'est parti pour le Challenge sed !");
            let games = this.getAvailableGames(),
                toSend = [];

            toSend.push('Voici les challenges disponibles :');
            games.forEach(function(g) {
                toSend.push('`' + g + '`');
            });
            toSend.push('Quel challenge voulez-vous lancer ?');
            this.send(toSend);
        }
    }

    onleaveInit(event, from, to, text) {
        let gameName = text.trim();
        try {
            require(`./challenges/${gameName}.js`); // try to load the given game
            this.context.model.currentGameName = gameName;
        } catch(e) {
            this.send(`Une erreur est survenue, le jeu à charger *${gameName}* n'existe pas.`);
            return false;
        }
    }

    onChallengeChosen(event, from, to) {
        let channelOrGroup = this.interface.getDataStore().getChannelById(this.context.channelId) || this.interface.getDataStore().getGroupById(this.context.channelId);
        if(channelOrGroup) {
            // Challenge was launched on a public channel or in a group
            channelOrGroup.members.forEach((member) => {
                this.interface.getDMIdByUserId(member)
                    .then((imId) => {
                        VirtualAssistant.getUsersCache().put(imId, this.id)
                        this.send([
                            `Bonjour, un Challenge sed vient d'être lancé sur <#${channelOrGroup.id}|${channelOrGroup.name}>.`,
                            "Vous avez rejoint le challenge. Pour le quitter dites 'fin'"
                        ], imId);
                    }, (err) => {
                        // Do nothing, error
                    });
            });
        }
        this.help();
    }

    onHelp(event, from, to) {
        this.getGameToDisplay()
            .then((data) => {
                var toSend = data.toSend;
                toSend.push('\n');
                toSend.push('Pour participer envoyez-moi vos propositions de scripts sed en *message privé* !');
                toSend.push('Le premier à trouver une bonne réponse remporte le challenge !')
                this.send(toSend);
                this.wait();
            });
    }

    onWait(event, from, to) {
        // Do nothing
    }

    onAnswerChannel(event, from, to, text, fromUserId, channelId) {
        let fromUser = this.interface.getDataStore().getUserById(fromUserId),
            imPlayerId = this.interface.getDataStore().getDMByUserId(fromUserId).id;
        if(VirtualAssistant.getUsersCache().get(imPlayerId)) {
            this.send('Merci de me faire vos propositions de réponse en *message privé* !', channelId);
            this.displayScoreboard(channelId);
        }
        else {
            // The user is in the channel but not in the challenge, add him
            let channelOrGroup = this.interface.getDataStore().getChannelById(this.context.channelId) || this.interface.getDataStore().getGroupById(this.context.channelId);
            VirtualAssistant.getUsersCache().put(imPlayerId, this.id);
            this.send(`Bienvenue ${fromUser.name} dans ce Challenge sed.`);
            this.send([
                `Vous avez rejoint le challenge lancé sur <#${channelOrGroup.id}|${channelOrGroup.name}>. Pour le quitter dites 'fin'`
            ], imPlayerId);
        }
        this.wait();
    }

    onAnswer(event, from, to, text, playerId) {
        this.debug('BEGIN ###################################################');
        this.debug('ANSWER', playerId, JSON.stringify(text));
        try {
        let imPlayerId = this.interface.getDataStore().getDMByUserId(playerId).id;
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
            this.debug('onAnswer', 'testTEXT', JSON.stringify(text));
            if(text) {
                this.context.model.players[playerId].tries++;
                let gameToDisplay = this.getGameToDisplay(text);
                gameToDisplay.then((gameToDisplayResult) => {
                    if(gameToDisplayResult.valid) {
                        this.context.model.players[playerId].bestScore = gameToDisplayResult.validCount;
                        this.context.model.players[playerId].bestAnswer = text;
                        let lastWinner = _.maxBy(this.getPlayersArray(), 'win');
                        this.context.model.players[playerId].win = lastWinner ? lastWinner.win + 1 : 1;
                        this.send('Bravo, vous avez trouvé une bonne réponse !', imPlayerId);

                        let bestPlayersByScore = _.chain(this.getPlayersArray())
                                .orderBy(['win', 'bestScore'], ['asc', 'desc'])
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
                        let toSend = gameToDisplayResult.toSend,
                            validCount = gameToDisplayResult.validCount;

                        let bestPlayersByScoreBefore = this._getScoreBoard();
                        if(this.context.model.players[playerId].bestScore === undefined 
                            || this.context.model.players[playerId].bestScore < validCount) {
                            this.context.model.players[playerId].bestScore = validCount;
                            this.context.model.players[playerId].bestAnswer = text;
                        }

                        let bestPlayersByScoreAfter = this._getScoreBoard(),
                            sameScoreboard = (bestPlayersByScoreBefore.length === bestPlayersByScoreAfter.length);
                        if(sameScoreboard) {
                            _.forEach(bestPlayersByScoreBefore, function(player, i) {
                                let otherScoreboardPlayer = bestPlayersByScoreAfter[i];
                                sameScoreboard = sameScoreboard &&
                                    otherScoreboardPlayer &&
                                    otherScoreboardPlayer.playerId === player.playerId &&
                                    otherScoreboardPlayer.bestScore === player.bestScore;
                            });
                        }

                        let myScore = _.find(bestPlayersByScoreAfter, {playerId: playerId}),
                            myPosition = _.indexOf(bestPlayersByScoreAfter, myScore) + 1,
                            game = this._getGame().game,
                            gameLength = this._getGameSplitted(game.output).length;

                        toSend.push('Cette réponse vous place en position ' + myPosition + ' du classement, avec ' + validCount + ' ligne'+(validCount>1?'s':'')+' correcte'+(validCount>1?'s':'')+ ' sur ' + gameLength);
                        this.send(toSend, imPlayerId);

                        if(!sameScoreboard) {
                            this.displayScoreboard();
                        }
                    }
                    this.debug('END ###################################################');
                    this.wait();
                })
                .catch((error) => {
                    this.send(error.toSend, imPlayerId);
                    this.debug('END ###################################################');
                    this.wait();
                });
            }
        }
        }
        catch(e) {
            this.debug('------------------------------------------')
            this.debug('onAnswer error', e);
            this.debug('------------------------------------------')
        }
    }

    onleaveWait(event, from, to, fromUserId) {
        if(event === 'end' && fromUserId) {
            let fromUser = this.interface.getDataStore().getUserById(fromUserId),
                imPlayerId = this.interface.getDataStore().getDMByUserId(fromUserId).id;
            if(!fromUser.is_admin
                && !this.interface.isAdministrator(this.context.userId)
                && imPlayerId !== this.context.channelId /* playing alone in training mode */) {
                this.send('Vous quittez le challenge.', imPlayerId);
                this.send(`${fromUser.name} a quitté le challenge.`);
                VirtualAssistant.getUsersCache().del(imPlayerId, this.id);
                return false;
            }
        }
    }

    onEnd(event, from, to) {
        let bestPlayersByScore = _.chain(this.getPlayersArray())
                .orderBy(['win', 'bestScore'], ['asc', 'desc'])
                .value(),
            game = this._getGame().game,
            gameLength = this._getGameSplitted(game.output).length,
            toSend = [
                'Challenge terminé !'
            ],
            winnerCount = _.filter(bestPlayersByScore, function(e) {
                return e.win !== undefined;
            }),
            launchedByImPlayerId = this.interface.getDataStore().getDMByUserId(this.context.userId).id;

        Statistics.event(Statistics.events.SED_END, {
            challengeId: this.id,
            game: this.context.model.currentGameName,
            userId: this.context.userId,
            winnersCount: winnerCount.length,
            playersCount: bestPlayersByScore.length,
            privateChallenge: (launchedByImPlayerId === this.context.channelId)
        });

        if(bestPlayersByScore.length > 0) {
            _.forEach(bestPlayersByScore, function(player) {
                if(player.win !== undefined) {
                    toSend.push('<@' + player.playerId + '> remporte le challenge avec le script suivant : ```' + player.bestAnswer + '``` en ' + player.tries + ' tentative' + (player.tries>1?'s':''));
                }
                else {
                    toSend.push('<@' + player.playerId + '> termine avec un score de ' + player.bestScore + '/' + gameLength + ' ligne'+(player.bestScore>1?'s':'')+' correcte'+(player.bestScore>1?'s':'')+' en ' + player.tries + ' tentative' + (player.tries>1?'s':''));
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
