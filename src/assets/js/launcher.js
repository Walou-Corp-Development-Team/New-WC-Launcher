/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

import Login from './panels/login.js';
import Home from './panels/home.js';
import Settings from './panels/settings.js';

import { logger, config, changePanel, database, popup, setBackground, accountSelect, addAccount, pkg } from './utils.js';
const { Microsoft } = require('minecraft-java-core');

const { ipcRenderer } = require('electron');
const fs = require('fs');
const os = require('os');

class Launcher {
    async init() {
        this.initLog();
        console.log('Initializing Launcher...');
        this.shortcut()
        await setBackground()
        this.initFrame();
        this.config = await config.GetConfig().then(res => res).catch(err => err);
        if(await this.config.error) return this.errorConnect()
        this.db = new database();
        await this.initConfigClient();
        this.createPanels(Login, Home, Settings);
        await this.startLauncher();
    }

    initLog() {
        document.addEventListener('keydown', e => {
            if(e.ctrlKey && e.shiftKey && e.code === 73 || e.code === 123) {
                ipcRenderer.send('main-window-dev-tools-close');
                ipcRenderer.send('main-window-dev-tools');
            }
        })
        new logger(pkg.name, '#7289da')
    }

    shortcut() {
        document.addEventListener('keydown', e => {
            if(e.ctrlKey && e.key === 87) {
                ipcRenderer.send('main-window-close');
            }
        })
    }

    errorConnect() {
        new popup().openPopup({
            title: this.config.error.code,
            content: this.config.error.message,
            color: 'red',
            exit: true,
            options: true
        });
    }

    initFrame() {
        console.log('Initializing Frame...')
        const platform = os.platform() === 'darwin' ? "darwin" : "other";

        document.querySelector(`.${platform} .frame`).classList.toggle('hide')

        document.querySelector(`.${platform} .frame #minimize`).addEventListener('click', () => {
            ipcRenderer.send('main-window-minimize');
        });

        let maximized = false;
        let maximize = document.querySelector(`.${platform} .frame #maximize`);
        maximize.addEventListener('click', () => {
            if (maximized) ipcRenderer.send('main-window-maximize')
            else ipcRenderer.send('main-window-maximize');
            maximized = !maximized
            maximize.classList.toggle('icon-maximize')
            maximize.classList.toggle('icon-restore-down')
        });

        document.querySelector(`.${platform} .frame #close`).addEventListener('click', () => {
            ipcRenderer.send('main-window-close');
        })
    }

    async initConfigClient() {
        console.log('Initializing Config Client...')
        let configClient = await this.db.readData('configClient')

        if (!configClient) {
            await this.db.createData('configClient', {
                account_selected: null,
                instance_selct: null,
                java_config: {
                    java_path: null,
                    java_memory: {
                        min: 4,
                        max: 16
                    }
                },
                game_config: {
                    screen_size: {
                        width: 1980,
                        height: 1080
                    }
                },
                launcher_config: {
                    download_multi: 5,
                    theme: 'sombre',
                    closeLauncher: 'close-launcher',
                    intelEnabledMac: true
                }
            })
        }
    }

    createPanels(...panels) {
        let panelsElem = document.querySelector('.panels')
        for(let panel of panels) {
            console.log(`Initializing ${panel.name} Panel...`);
            let div = document.createElement('div');
            div.classList.add('panel', panel.id)
            div.innerHTML = fs.readFileSync(`${__dirname}/panels/${panel.id}.html`, 'utf8');
            panelsElem.appendChild(div);
            new panel().init(this.config);
        }
    }

    async startLauncher() {
        let accounts = await this.db.readAllData('accounts')
        let configClient = await this.db.readData('configClient')
        let account_selected = configClient ? configClient.account_selected : null
        let popupRefresh = new popup();

        if(accounts?.length) {
            for(let account of accounts) {
                let account_ID = account.ID
                if(account.error) {
                    await this.db.deleteData('accounts', account_ID)
                    continue
                }
                if(account.meta.type === 'Xbox') {
                    console.log(`Account Type : ${account.meta.type} | Username : ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Connexion',
                        content: `Type de compte : ${account.meta.type} | Utilisateur : ${account.name}`,
                        color: 'var(--dark)',
                        background: false
                    });

                    let refresh_accounts = await new Microsoft(this.config.client_id).refresh(account);

                    if(refresh_accounts.error) {
                        await this.db.deleteData('accounts', account_ID)
                        if(account_ID === account_selected) {
                            configClient.account_selected = null
                            await this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    await this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if(account_ID === account_selected) await accountSelect(refresh_accounts)
                }
            }

            accounts = await this.db.readAllData('accounts')
            configClient = await this.db.readData('configClient')
            account_selected = configClient ? configClient.account_selected : null

            if(!account_selected) {
                let uuid = accounts[0].ID
                if(uuid) {
                    configClient.account_selected = uuid
                    await this.db.updateData('configClient', configClient)
                    await accountSelect(uuid)
                }
            }

            if(!accounts.length) {
                config.account_selected = null
                await this.db.updateData('configClient', config);
                popupRefresh.closePopup()
                return changePanel("login");
            }

            popupRefresh.closePopup()
            await changePanel("home");
        } else {
            popupRefresh.closePopup()
            await changePanel('login');
        }
    }
}

new Launcher().init();