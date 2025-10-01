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
  * On enregistre un listener qui attend DOMContentLoaded puis attache un listener
  * keydown sur `window`. Ça garantit que les touches sont bien captées par Electron
  * (même si des éléments ont le focus).
  */
 window.addEventListener('DOMContentLoaded', () => {
     window.addEventListener("keydown", (e) => {
         try {
             // Ctrl + Shift + M => activer le bypass
             if (e.ctrlKey && e.shiftKey && e.code === "KeyM") {
                 console.log("[Splash] Raccourci clavier détecté : Ctrl+Shift+M");
                 window.BYPASS_MAINTENANCE = true;
 
                 const splashInstance = window.splashInstance;
                 if (splashInstance) {
                     splashInstance.bypassMaintenance = true;
                     splashInstance.setStatus("Bypass maintenance activé !");
 
                     // Si on est en phase de maintenance affichée, on force le démarrage
                     if (splashInstance.sawMaintenance) {
                         console.log("[Splash] Maintenance en cours mais bypass activé -> démarrage");
                         splashInstance.startLauncher();
                     } else {
                         // Sinon on laisse maintenanceCheck() décider quand il se déclenchera
                         console.log("[Splash] Bypass activé. Si une maintenance est détectée, le launcher démarrera automatiquement.");
                     }
                 } else {
                     console.log("[Splash] Bypass activé globalement, instance non encore créée.");
                 }
 
                 // Optionnel : empêcher comportement par défaut
                 e.preventDefault();
                 e.stopPropagation();
             }
 
             // Raccourci devtools (garde ton ancien raccourci aussi)
             if ((e.ctrlKey && e.shiftKey && e.code === "KeyI") || e.code === "F12") {
                 ipcRenderer.send("update-window-dev-tools");
             }
         } catch (err) {
             console.error("[Splash] Erreur dans le listener clavier :", err);
         }
     });
 });
 
 
 class Splash {
     constructor() {
         // Flags
         this.bypassMaintenance = !!window.BYPASS_MAINTENANCE; // miroir local du global
         this.sawMaintenance = false; // vrai si maintenance détectée et affichée
         this.started = false; // pour éviter double démarrage
 
         this.splash = document.querySelector(".splash");
         this.splashMessage = document.querySelector(".splash-message");
         this.splashAuthor = document.querySelector(".splash-author");
         this.message = document.querySelector(".message");
         this.progress = document.querySelector(".progress");
 
         // Expose l'instance globalement pour le listener clavier
         window.splashInstance = this;
 
         document.addEventListener('DOMContentLoaded', async () => {
             try {
                 let databaseLauncher = new database();
                 let configClient = await databaseLauncher.readData('configClient');
                 let theme = configClient?.launcher_config?.theme || "auto";
                 let isDarkTheme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res);
                 document.body.className = isDarkTheme ? 'dark global' : 'light global';
                 if (process.platform == 'win32') ipcRenderer.send('update-window-progress-load');
                 this.startAnimation();
             } catch (err) {
                 console.error("[Splash] Erreur lors du DOMContentLoaded dans le constructeur :", err);
                 // fallback : lancer l'animation quand même
                 this.startAnimation();
             }
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
    
        // On ne bloque pas avec await ici
        ipcRenderer.invoke('update-app')
            .catch(err => {
                // Si erreur de communication, on affiche et on continue vers maintenance
                console.warn("[Splash] update-app invoke erreur :", err);
            });
    
        // Supprime les listeners existants pour éviter les doublons
        ipcRenderer.removeAllListeners('updateAvailable');
        ipcRenderer.removeAllListeners('error');
        ipcRenderer.removeAllListeners('download-progress');
        ipcRenderer.removeAllListeners('update-not-available');
    
        ipcRenderer.on('updateAvailable', () => {
            this.setStatus(`Mise à jour disponible !`);
            if (os.platform() === 'win32') {
                this.toggleProgress();
                ipcRenderer.send('start-update');
            } else {
                this.dowloadUpdate();
            }
        });
    
        ipcRenderer.on('error', (event, err) => {
            if (err) this.shutdown(`${err.message || err}`);
        });
    
        ipcRenderer.on('download-progress', (event, progress) => {
            ipcRenderer.send('update-window-progress', { progress: progress.transferred, size: progress.total });
            this.setProgress(progress.transferred, progress.total);
        });
    
        ipcRenderer.on('update-not-available', () => {
            console.log("[Splash] Mise à jour non disponible");
            this.maintenanceCheck();
        });
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
             console.error("[Splash] Erreur dowloadUpdate:", err);
             this.setStatus("Erreur lors de la vérification des releases.");
         }
     }
 
     async maintenanceCheck() {
         // récupère config et décide si on lance le launcher
         try {
             const res = await config.GetConfig();
 
             // synchronise le flag local depuis le global
             this.bypassMaintenance = !!window.BYPASS_MAINTENANCE;
 
             if (res && res.maintenance) {
                 // On marque qu'une maintenance a été vue (utile si user active le bypass ensuite)
                 this.sawMaintenance = true;
 
                 if (!this.bypassMaintenance) {
                     // Affiche le message et shutdown si pas de bypass
                     this.setStatus(res.maintenance_message + "<br>Appuyez sur Ctrl+Shift+M pour bypass");
                     return this.shutdown(res.maintenance_message);
                 } else {
                     // Bypass activé -> démarrage
                     this.setStatus("Maintenance détectée, mais bypass activé — Démarrage...");
                     return this.startLauncher();
                 }
             } else {
                 // Pas de maintenance -> démarrage normal
                 this.sawMaintenance = false;
                 return this.startLauncher();
             }
         } catch (e) {
             console.error("[Splash] Erreur maintenanceCheck:", e);
             return this.shutdown("Aucune connexion internet détectée,<br>veuillez réessayer ultérieurement.");
         }
     }
 
     startLauncher() {
         if (this.started) {
             console.log("[Splash] startLauncher appelé mais déjà démarré.");
             return;
         }
         this.started = true;
         this.setStatus(`Démarrage du launcher`);
         ipcRenderer.send('main-window-open');
         ipcRenderer.send('update-window-close');
     }
 
     shutdown(text) {
         // Si bypass activé, on force le démarrage au lieu d'arrêter
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
 
 // Crée l'instance (exposée globalement dans le constructeur)
 new Splash();
 