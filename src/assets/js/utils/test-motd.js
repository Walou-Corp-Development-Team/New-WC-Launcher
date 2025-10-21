const { status } = require('minecraft-server-util');

status('play.nightwatch.fr', 25565, { timeout: 5000 })
	.then((res) => {
		const motd = res.motd?.clean;
		console.log(
			'MOTD:',
			Array.isArray(motd) ? motd.join(' ') : motd || '<vide>'
		);
	})
	.catch((err) => {
		console.error('Erreur status2:', err);
	});
