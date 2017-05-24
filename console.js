#!/usr/bin/env node

// ora and cliSpinners are brothers!
// const ora = require('ora');
// const cliSpinners = require('cli-spinners');
const glob = require('glob');
const vorpal = require('vorpal')();
const chalk = require('chalk');
const app = require('./lib/app.js');
app.prerequisite();
app.markets.on('add_available_market', function(a) {
	console.log(chalk.blue('Market `' + a + '` added to available markets'));
});
app.markets.on('market_removed', function() {
	console.log(chalk.green('Market removed'));
});
app.markets.on('saved', function() {
	console.log(chalk.blue('Markets saved'));
});
app.markets.on('error', function(message) {
	console.log(chalk.red(message));
});
app.markets.on('market_pair_added', function(market, pair) {
	console.log(chalk.green('Pair `' + pair.currency2.toUpperCase() + '/' + pair.currency1.toUpperCase() + '` added to ' + market.name));
});
app.markets.on('market_pair_removed', function(market) {
	console.log(chalk.green('Pair is removed from ' + market.name));
});
let files = glob.sync("./lib/console/*.js", {
	cwd: __dirname
});
files.forEach(file => {
	vorpal.use(require(file), app);
});
app.init();
vorpal.find('exit')
	.remove();
vorpal.command('exit', 'Exits application.')
	.alias('quit')
	.action(function() {
		process.exit(0);
	});
vorpal.history('bitcoinbot')
	.delimiter('$')
	.show();
