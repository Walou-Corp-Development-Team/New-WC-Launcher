/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

 const { ipcRenderer, shell } = require('electron');
 const pkg = require('../package.json');
 const os = require('os');
 import { config, database } from './utils.js';
 const nodeFetch = require("node-fetch");
 
 // Flag global pour bypass (accessible même avant que l'instance soit créée)
 window.BYPASS_MAINTENANCE = false;
 
 /**
  * Listener clavier enregistré tôt : il active le flag global.
  * Ctrl+Shift+M => active le bypass (ne lance pas automatiquement si aucune instance)
  */
 document.addEventListener("keydown", (e) => {
     if (e.ctrlKey && e.shiftKey && e.code === "KeyM") {
         window.BYPASS_MAINTENANCE = true;
         console.log("Bypass maintenance global activé !");
         const messageEl = document.querySelector?.(".message");
         if (messageEl) messageEl.innerHTML = "Bypass maintenance activé ! (Ctrl+Shift+M)";
 
         // Si l'instance existe, on met à jour son flag local et on agit selon l'état courant.
         if (window.splashInstance) {
             window.splashInstance.bypassMaintenance = true;
             // Si la maintenance est affichée (ou si on veut forcer), on peut démarrer le launcher.
             // Ici on ne lance automatiquement que si la page est en état "display" (optionnel),
             // mais on peut aussi forcer tout le temps.
             console.log("Splash instance détectée — tentative de démarrage si maintenance active.");
             // Si la maintenance est en cours (message affiché contenant "maintenance"), on force le démarrage,
             // sinon on laisse maintenanceCheck décider lors de sa prochaine exécution.
             // Pour être sûr, on vérifie si la config a déjà été récupérée (éventuellement stockée sur l'instance).
             try {
                 // Appel sécurisé pour démarrer si le launcher n'est pas déjà lancé
                 window.splashInstance.startLauncher();
             } catch (err) {
                 console.error("Erreur en tentant de lancer le launcher depuis le listener clavier :", err);
             }
         }
     }
 });
 
 
 class Splash {
     constructor() {
         // Flag local (miroir du global)
         this.bypassMaintenance = false;
 
         this.splash = document.querySelector(".splash");
         this.splashMessage = document.querySelector(".splash-message");
         this.splashAuthor = document.querySelector(".splash-author");
         this.message = document.querySelector(".message");
         this.progress = document.querySelector(".progress");
 
         // Expose l'instance globalement pour que le listener clavier puisse y accéder
         window.splashInstance = this;
 
         document.addEventListener('DOMContentLoaded', async () => {
             let databaseLauncher = new database();
             let configClient = await databaseLauncher.readData('configClient');
             let theme = configClient?.launcher_config?.theme || "auto"
             let isDarkTheme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res)
             document.body.className = isDarkTheme ? 'dark global' : 'light global';
             if (process.platform == 'win32') ipcRenderer.send('update-window-progress-load')
             this.startAnimation()
         });
     }
 
     async startAnimation() {
         let splashes = [
             { "message": "Dommage...", "author": "Walou" },
             { "message": "Pierre Edouard ton goûter", "author": "Walou" },
             { "message": "Quelqu'un à vu espace ?", "author": "Walou" }
         ];
         let splash = splashes[Math.floor(Math.random() * splashes.length)];
         if (this.splashMessage) this.splashMessage.textContent = splash.message;
         if (this.splashAuthor && this.splashAuthor.children[0]) this.splashAuthor.children[0].textContent = "@" + splash.author;
         await sleep(100);
         const splashEl = document.querySelector("#splash");
         if (splashEl) splashEl.style.display = "block";
         await sleep(500);
         this.splash?.classList.add("opacity");
         await sleep(500);
         this.splash?.classList.add("translate");
         this.splashMessage?.classList.add("opacity");
         this.splashAuthor?.classList.add("opacity");
         this.message?.classList.add("opacity");
         await sleep(1000);
         this.checkUpdate();
     }
 
     async checkUpdate() {
         this.setStatus(`Recherche de mise à jour...`);
 
         ipcRenderer.invoke('update-app').then().catch(err => {
             return this.shutdown(`Erreur lors de la recherche de mise à jour :<br>${err.message}`);
         });
 
         ipcRenderer.on('updateAvailable', () => {
             this.setStatus(`Mise à jour disponible !`);
             if (os.platform() == 'win32') {
                 this.toggleProgress();
                 ipcRenderer.send('start-update');
             }
             else return this.dowloadUpdate();
         })
 
         ipcRenderer.on('error', (event, err) => {
             if (err) return this.shutdown(`${err.message}`);
         })
 
         ipcRenderer.on('download-progress', (event, progress) => {
             ipcRenderer.send('update-window-progress', { progress: progress.transferred, size: progress.total })
             this.setProgress(progress.transferred, progress.total);
         })
 
         ipcRenderer.on('update-not-available', () => {
             console.error("Mise à jour non disponible");
             this.maintenanceCheck();
         })
     }
 
     getLatestReleaseForOS(osStr, preferredFormat, asset) {
         return asset.filter(asset => {
             const name = asset.name.toLowerCase();
             const isOSMatch = name.includes(osStr);
             const isFormatMatch = name.endsWith(preferredFormat);
             return isOSMatch && isFormatMatch;
         }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
     }
 
     async dowloadUpdate() {
         try {
             const repoURL = pkg.repository.url.replace("git+", "").replace(".git", "").replace("https://github.com/", "").split("/");
             const githubAPI = await nodeFetch('https://api.github.com').then(res => res.json()).catch(err => { throw err; });
 
             const githubAPIRepoURL = githubAPI.repository_url.replace("{owner}", repoURL[0]).replace("{repo}", repoURL[1]);
             const githubAPIRepo = await nodeFetch(githubAPIRepoURL).then(res => res.json()).catch(err => { throw err; });
 
             const releases_url = await nodeFetch(githubAPIRepo.releases_url.replace("{/id}", '')).then(res => res.json()).catch(err => { throw err; });
             const latestRelease = releases_url[0].assets;
             let latest;
 
             if (os.platform() == 'darwin') latest = this.getLatestReleaseForOS('mac', '.dmg', latestRelease);
             else if (os.platform() == 'linux') latest = this.getLatestReleaseForOS('linux', '.appimage', latestRelease);
 
             if (!latest) return this.setStatus("Aucune release trouvée pour votre OS.");
 
             this.setStatus(`Mise à jour disponible !<br><div class="download-update">Télécharger</div>`);
             const dlEl = document.querySelector(".download-update");
             if (dlEl) {
                 dlEl.addEventListener("click", () => {
                     shell.openExternal(latest.browser_download_url);
                     return this.shutdown("Téléchargement en cours...");
                 });
             }
         } catch (err) {
             console.error("Erreur dowloadUpdate:", err);
             this.setStatus("Erreur lors de la vérification des releases.");
         }
     }
 
 
     async maintenanceCheck() {
         // récupère config et décide si on lance le launcher
         try {
             const res = await config.GetConfig();
 
             // met à jour le flag local depuis le global
             this.bypassMaintenance = !!window.BYPASS_MAINTENANCE;
 
             if (res.maintenance) {
                 // Si maintenance active et bypass non activé -> shutdown (comportement normal)
                 if (!this.bypassMaintenance) {
                     this.setStatus(res.maintenance_message + "<br>Appuyez sur Ctrl+Shift+M pour bypass");
                     return this.shutdown(res.maintenance_message);
                 } else {
                     // Bypass activé -> on démarre le launcher
                     this.setStatus("Maintenance détectée, mais bypass activé — Démarrage...");
                     return this.startLauncher();
                 }
             } else {
                 // Pas de maintenance -> démarrage normal
                 return this.startLauncher();
             }
         } catch (e) {
             console.error(e);
             return this.shutdown("Aucune connexion internet détectée,<br>veuillez réessayer ultérieurement.");
         }
     }
     
 
     startLauncher() {
         this.setStatus(`Démarrage du launcher`);
         ipcRenderer.send('main-window-open');
         ipcRenderer.send('update-window-close');
     }
 
     shutdown(text) {
         // Si le flag local est true, on bypass le shutdown
         if (this.bypassMaintenance || window.BYPASS_MAINTENANCE) {
             this.setStatus(`Bypass maintenance actif, lancement du launcher...`);
             return this.startLauncher();
         }
     
         this.setStatus(`${text}<br>Arrêt dans 5s`);
         let i = 4;
         const interval = setInterval(() => {
             this.setStatus(`${text}<br>Arrêt dans ${i--}s`);
             if (i < 0) {
                 clearInterval(interval);
                 ipcRenderer.send('update-window-close');
             }
         }, 1000);
     }
 
     setStatus(text) {
         if (this.message) this.message.innerHTML = text;
     }
 
     toggleProgress() {
         if (this.progress && this.progress.classList.toggle("show")) this.setProgress(0, 1);
     }
 
     setProgress(value, max) {
         if (this.progress) {
             this.progress.value = value;
             this.progress.max = max;
         }
     }
 }
 
 function sleep(ms) {
     return new Promise(r => setTimeout(r, ms));
 }
 
 // Instance créée à la fin
 new Splash();
 