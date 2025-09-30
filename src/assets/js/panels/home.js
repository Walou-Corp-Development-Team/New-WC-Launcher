/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */
 import { config, database, logger, changePanel, appdata, setStatus, pkg, popup } from '../utils.js'

 const { Launch } = require('minecraft-java-core')
 const { shell, ipcRenderer } = require('electron')
 
 class Home {
     static id = "home";
     async init(config) {
         this.config = config;
         this.db = new database();
         this.news()
         this.socialLick()
         this.instancesSelect()
         document.querySelector('.settings-btn').addEventListener('click', e => changePanel('settings'))
     }
 
     async news() {
         let newsElement = document.querySelector('.news-list');
         let news = await config.getNews().then(res => res).catch(err => false);
 
         if (news) {
             if (!news.length) {
                 let blockNews = document.createElement('div');
                 blockNews.classList.add('news-block');
                 blockNews.innerHTML = `
                     <div class="news-header">
                         <img class="server-status-icon" src="assets/images/icon.png">
                         <div class="header-text">
                             <div class="title">Aucun news n'est actuellement disponible.</div>
                         </div>
                         <div class="date">
                             <div class="day">1</div>
                             <div class="month">Janvier</div>
                         </div>
                     </div>
                     <div class="news-content">
                         <div class="bbWrapper">
                             <p>Vous pourrez suivre ici toutes les news relatives au serveur.</p>
                         </div>
                     </div>`
                 newsElement.appendChild(blockNews);
             } else {
                 for (let News of news) {
                     let date = this.getdate(News.publish_date)
                     let blockNews = document.createElement('div');
                     blockNews.classList.add('news-block');
                     blockNews.innerHTML = `
                         <div class="news-header">
                             <img class="server-status-icon" src="assets/images/icon.png">
                             <div class="header-text">
                                 <div class="title">${News.title}</div>
                             </div>
                             <div class="date">
                                 <div class="day">${date.day}</div>
                                 <div class="month">${date.month} ${date.year}</div>
                             </div>
                         </div>
                         <div class="news-content">
                             <div class="bbWrapper">
                                 <p>${News.content.replace(/\n/g, '</br>')}</p>
                                 <p class="news-author">Auteur - <span>${News.author}</span></p>
                             </div>
                         </div>`
                     newsElement.appendChild(blockNews);
                 }
             }
         } else {
             let blockNews = document.createElement('div');
             blockNews.classList.add('news-block');
             blockNews.innerHTML = `
                 <div class="news-header">
                         <img class="server-status-icon" src="assets/images/icon.png">
                         <div class="header-text">
                             <div class="title">Error.</div>
                         </div>
                         <div class="date">
                             <div class="day">1</div>
                             <div class="month">Janvier</div>
                         </div>
                     </div>
                     <div class="news-content">
                         <div class="bbWrapper">
                             <p>Impossible de contacter le serveur des news.</br>Merci de vérifier votre configuration.</p>
                         </div>
                     </div>`
             newsElement.appendChild(blockNews);
         }
     }
 
     socialLick() {
         let socials = document.querySelectorAll('.social-block')
 
         socials.forEach(social => {
             social.addEventListener('click', e => {
                 shell.openExternal(e.target.dataset.url)
             })
         });
     }
 
     async instancesSelect() {
         let configClient = await this.db.readData('configClient')
         let auth = await this.db.readData('accounts', configClient.account_selected)
         let instancesList = await config.getInstanceList()
         let instanceSelect = instancesList.find(i => i.name == configClient?.instance_selct) ? configClient?.instance_selct : null
 
         let instanceBTN = document.querySelector('.play-instance')
         let instancePopup = document.querySelector('.instance-popup')
         let instancesListPopup = document.querySelector('.instances-List')
         let instanceCloseBTN = document.querySelector('.close-popup')
 
         if (instancesList.length === 1) {
             document.querySelector('.instance-select').style.display = 'none'
             instanceBTN.style.paddingRight = '0'
         }
 
         if (!instanceSelect) {
             let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
             let configClient = await this.db.readData('configClient')
             configClient.instance_selct = newInstanceSelect.name
             instanceSelect = newInstanceSelect.name
             await this.db.updateData('configClient', configClient)
         }
 
         for (let instance of instancesList) {
             if (instance.whitelistActive) {
                 let whitelist = instance.whitelist.find(whitelist => whitelist == auth?.name)
                 if (whitelist !== auth?.name) {
                     if (instance.name == instanceSelect) {
                         let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
                         let configClient = await this.db.readData('configClient')
                         configClient.instance_selct = newInstanceSelect.name
                         instanceSelect = newInstanceSelect.name
                         setStatus(newInstanceSelect.status)
                         await this.db.updateData('configClient', configClient)
                     }
                 }
             } else console.log(`Initializing instance ${instance.name}...`)
             if (instance.name == instanceSelect) setStatus(instance.status)
         }
 
         instancePopup.addEventListener('click', async e => {
             let configClient = await this.db.readData('configClient')
 
             if (e.target.classList.contains('instance-elements')) {
                 let newInstanceSelect = e.target.id
                 let activeInstanceSelect = document.querySelector('.active-instance')
 
                 if (activeInstanceSelect) activeInstanceSelect.classList.toggle('active-instance');
                 e.target.classList.add('active-instance');
 
                 configClient.instance_selct = newInstanceSelect
                 await this.db.updateData('configClient', configClient)
                 instanceSelect = instancesList.filter(i => i.name == newInstanceSelect)
                 instancePopup.style.display = 'none'
                 let instance = await config.getInstanceList()
                 let options = instance.find(i => i.name == configClient.instance_selct)
                 await setStatus(options.status)
             }
         })
 
         instanceBTN.addEventListener('click', async e => {
             let configClient = await this.db.readData('configClient')
             let instanceSelect = configClient.instance_selct
             let auth = await this.db.readData('accounts', configClient.account_selected)
 
             if (e.target.classList.contains('instance-select')) {
                 instancesListPopup.innerHTML = ''
                 for (let instance of instancesList) {
                     if (instance.whitelistActive) {
                         instance.whitelist.map(whitelist => {
                             if (whitelist == auth?.name) {
                                 if (instance.name == instanceSelect) {
                                     instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements active-instance">${instance.name}</div>`
                                 } else {
                                     instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements">${instance.name}</div>`
                                 }
                             }
                         })
                     } else {
                         if (instance.name == instanceSelect) {
                             instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements active-instance">${instance.name}</div>`
                         } else {
                             instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements">${instance.name}</div>`
                         }
                     }
                 }
 
                 instancePopup.style.display = 'flex'
             }
 
             if (!e.target.classList.contains('instance-select')) this.startGame()
         })
 
         instanceCloseBTN.addEventListener('click', () => instancePopup.style.display = 'none')
     }
 
     async startGame() {
         let configClient = await this.db.readData('configClient')
         let account = await this.db.readData('accounts', configClient.account_selected)
         let instances = await config.getInstanceList()
         let instance = instances.find(i => i.name == configClient.instance_selct)
 
         if (!account) return popup('error', 'Aucun compte sélectionné.', 'Merci de sélectionner un compte dans les paramètres.')
         if (!instance) return popup('error', 'Aucune instance sélectionnée.', 'Merci de sélectionner une instance.')
         
         let launcher = new Launch()
 
         let opts = {
             clientPackage: instance.package,
             authorization: account,
             root: `${appdata}/.minecraft`,
             version: instance.version,
             detached: false,
             javaPath: configClient.javaPath || null,
             memory: {
                 min: `${configClient.memory.min}M`,
                 max: `${configClient.memory.max}M`
             }
         }
 
         launcher.launch(opts)
 
         launcher.on('debug', (e) => logger.debug(e))
         launcher.on('data', (e) => logger.log(e))
         launcher.on('progress', (DL, totDL) => {
             let percent = Math.round((DL / totDL) * 100)
             setStatus(`Téléchargement ${percent}%`)
         })
         launcher.on('close', (code) => {
             setStatus(instance.status || 'Serveur prêt')
             logger.log(`Minecraft s'est arrêté avec le code ${code}`)
         })
     }
 
     getdate(e) {
         if (!e) return { year: '', month: '', day: '' }
 
         let date = new Date(e)
 
         // Si le format n'est pas reconnu
         if (isNaN(date.getTime())) {
             // Essaye JJ/MM/AAAA ou JJ-MM-AAAA
             let parts = e.split(/[\/\-]/)
             if (parts.length === 3) {
                 // suppose JJ/MM/AAAA
                 let [d, m, y] = parts
                 return { year: y, month: m, day: d }
             }
             return { year: '', month: '', day: e } // fallback brut
         }
 
         let year = date.getFullYear()
         let month = date.getMonth() + 1
         let day = date.getDate()
         let allMonth = [
             'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
             'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
         ]
         return { year: year, month: allMonth[month - 1], day: day }
     }
 }
 export default Home;
 