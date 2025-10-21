/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

const { ipcRenderer } = require('electron');

import {
	popup,
	database,
	changePanel,
	accountSelect,
	addAccount,
	config,
	setStatus,
} from '../utils.js';

class Login {
	static id = 'login';

	async init(config) {
		this.config = config;
		this.db = new database();

		if (typeof this.config.online == 'boolean') {
			await this.getMicrosoft();
		}
	}

	async getMicrosoft() {
		console.log('Initializing Microsoft login...');
		let popupLogin = new popup();
		let loginHome = document.querySelector('.login-home');
		let microsoftBtn = document.querySelector('.connect-home');
		loginHome.style.display = 'block';

		microsoftBtn.addEventListener('click', () => {
			popupLogin.openPopup({
				title: 'Connexion en cours',
				content: 'Veuillez patienter...',
				color: 'var(--dark)',
			});

			ipcRenderer
				.invoke('Microsoft-window', this.config.client_id)
				.then(async (account_connect) => {
					if (account_connect === 'cancel' || !account_connect) {
						popupLogin.closePopup();
						return;
					}

					// Vérifie si le compte Microsoft possède Minecraft
					const ownsMinecraft = await this.checkMinecraftOwnership(
						account_connect.access_token
					);

					if (!ownsMinecraft) {
						popupLogin.openPopup({
							title: 'Erreur',
							content:
								'Ce compte Microsoft ne possède pas de compte Minecraft.',
							color: 'var(--red)',
							options: true,
						});
						return;
					} else {
						// Si le compte possède bien le jeu, on continue
						await this.saveData(account_connect);
						popupLogin.closePopup();
						return;
					}
				})
				.catch((err) => {
					popupLogin.openPopup({
						title: 'Erreur',
						content: err,
						options: true,
					});
				});
		});
	}

	async checkMinecraftOwnership(accessToken) {
		try {
			const response = await fetch(
				'https://api.minecraftservices.com/entitlements/mcstore',
				{
					headers: {
						Authorization: `Bearer ${accessToken}`,
					},
				}
			);
			const data = await response.json();

			// Si l’utilisateur a des produits liés à Minecraft, il possède le jeu
			return Array.isArray(data.items) && data.items.length > 0;
		} catch (error) {
			console.error('Erreur de vérification Minecraft:', error);
			return false;
		}
	}

	async saveData(connectionData) {
		let configClient = await this.db.readData('configClient');

		// Vérifier s'il existe déjà un compte avec ce nom (pour éviter les doublons)
		let existingAccounts = await this.db.readAllData('accounts');
		let existingAccount = existingAccounts.find(
			(acc) => acc.name === connectionData.name
		);

		if (existingAccount) {
			// Utiliser directement le compte existant (même UUID, même stuff)
			let popupInfo = new popup();
			popupInfo.openPopup({
				title: 'Compte existant',
				content: `Le compte "${connectionData.name}" existe déjà. Utilisation du compte existant pour préserver votre inventaire.`,
				color: 'green',
				background: false,
			});

			// Sélectionner le compte existant sans le recréer
			configClient.account_selected = existingAccount.ID;
			await this.db.updateData('configClient', configClient);
			await addAccount(existingAccount);
			await accountSelect(existingAccount);
			await changePanel('home');
			return;
		}

		let account = await this.db.createData('accounts', connectionData);
		let instanceSelect = configClient.instance_selct;
		let instancesList = await config.getInstanceList();
		configClient.account_selected = account.ID;

		for (let instance of instancesList) {
			if (instance.whitelistActive) {
				let whitelist = instance.whitelist.find(
					(whitelist) => whitelist === account.name
				);
				if (whitelist !== account.name) {
					if (instance.name === instanceSelect) {
						let newInstanceSelect = instancesList.find(
							(i) => i.whitelistActive === false
						);
						configClient.instance_selct = newInstanceSelect.name;
						await setStatus(newInstanceSelect.status);
					}
				}
			}
		}

		await this.db.updateData('configClient', configClient);
		await addAccount(account);
		await accountSelect(account);

		await changePanel('home');
	}
}

export default Login;
