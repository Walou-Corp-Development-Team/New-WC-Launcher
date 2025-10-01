/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

 const { ipcRenderer, shell } = require('electron');
 const pkg = require('../package.json');
 const os = require('os');
 import { config, database } from './utils.js';
 const nodeFetch = require("node-fetch");
 
 // Flag global (peut être activé avant création de l'instance)
 window.BYPASS_MAINTENANCE = false;
 
 class Splash {
     constructor() {
         // états
         this.bypassMaintenance = !!window.BYPASS_MAINTENANCE; // miroir local
         this.maintenanceActive = false; // true si la config signale maintenance
         this.started = false; // pour éviter double start
 
         // elements DOM
         this.splash = document.querySelector(".splash");
         this.splashMessage = document.querySelector(".splash-message");
         this.splashAuthor = document.querySelector(".splash-author");
         this.message = document.querySelector(".message");
         this.progress = document.querySelector(".progress");
 
         // exposer l'instance
         window.splashInstance = this;
 
         // Attacher le listener DOMContentLoaded local au constructeur (sécurisé)
         document.addEventListener('DOMContentLoaded', async () => {
             try {
                 let databaseLauncher = new database();
                 let configClient = await databaseLauncher.readData('configClient');
                 let theme = configClient?.launcher_config?.theme || "auto";
                 let isDarkTheme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res);
                 document.body.className = isDarkTheme ? 'dark global' : 'light global';
                 if (process.platform === 'win32') ipcRenderer.send('update-window-progress-load');
             } catch (err) {
                 console.warn("[Splash] Erreur initialisation thème/config client :", err);
             } finally {
                 // lancer l'animation même si erreur précédente
                 this.startAnimation();
             }
         });
 
         // ATTENTION: le listener clavier global est enregistré dans le block window.addEventListener('DOMContentLoaded', ...)
         // pour s'assurer qu'il est attaché après que la fenêtre soit prête (voir bas de fichier).
     }
 
     async startAnimation() {
         const splashes = [
             { "message": "Dommage...", "author": "Walou" },
             { "message": "Pierre Edouard ton goûter", "author": "Walou" },
             { "message": "Quelqu'un à vu espace ?", "author": "Walou" }
         ];
         const splash = splashes[Math.floor(Math.random() * splashes.length)];
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
 
         // démarrer la vérification de mise à jour (non bloquante)
         this.checkUpdate();
     }
 
     async checkUpdate() {
         this.setStatus(`Recherche de mise à jour...`);
         // Ne pas await pour ne pas bloquer la suite — on s'appuie sur les events IPC pour continuer
         ipcRenderer.invoke('update-app')
             .then(() => {
                 // invoke réussi (mais la logique réelle continue via events)
                 console.log("[Splash] invoke('update-app') résolu");
             })
             .catch(err => {
                 // log et continuer vers la vérification de maintenance via 'update-not-available' handler
                 console.warn("[Splash] invoke('update-app') rejeté:", err);
                 // Si l'IPC n'envoie pas d'event 'update-not-available', on appelle maintenanceCheck() après un délai
                 setTimeout(() => {
                     // protection : si aucun event reçu en 2s, on lance la maintenanceCheck pour avancer
                     console.log("[Splash] fallback -> appel maintenanceCheck()");
                     this.maintenanceCheck();
                 }, 2000);
             });
 
         // Nettoyer et attacher handlers
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
             console.error("[Splash] ipc error:", err);
             if (err) this.shutdown(`${err.message || err}`);
         });
 
         ipcRenderer.on('download-progress', (event, progress) => {
             ipcRenderer.send('update-window-progress', { progress: progress.transferred, size: progress.total });
             this.setProgress(progress.transferred, progress.total);
         });
 
         ipcRenderer.on('update-not-available', () => {
             console.log("[Splash] update-not-available reçu -> maintenanceCheck()");
             this.maintenanceCheck();
         });
     }
 
     getLatestReleaseForOS(osStr, preferredFormat, asset) {
         return asset.filter(a => {
             const name = a.name.toLowerCase();
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
 
             if (os.platform() === 'darwin') latest = this.getLatestReleaseForOS('mac', '.dmg', latestRelease);
             else if (os.platform() === 'linux') latest = this.getLatestReleaseForOS('linux', '.appimage', latestRelease);
 
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
         this.setStatus(`Vérification de l'état du launcher...`);
         try {
             const res = await config.GetConfig();
 
             // synchroniser le flag local depuis le global (si l'utilisateur a appuyé avant)
             this.bypassMaintenance = !!window.BYPASS_MAINTENANCE;
 
             if (res && res.maintenance) {
                 // maintenance active -> on reste bloqué ici tant que bypass non activé
                 this.maintenanceActive = true;
                 console.log("[Splash] maintenance détectée:", res.maintenance_message);
 
                 // afficher message et attendre l'input clavier (Ctrl+Shift+M)
                 this.setStatus(res.maintenance_message + "<br>Appuyez sur <strong>Ctrl+Shift+M</strong> pour bypass");
 
                 // Si l'utilisateur avait déjà activé le bypass auparavant, on démarre tout de suite
                 if (this.bypassMaintenance) {
                     console.log("[Splash] bypass déjà actif -> démarrage");
                     this.startLauncher();
                 }
 
                 // Ne pas appeler shutdown ici (on veut que l'utilisateur décide)
                 return;
             } else {
                 // pas de maintenance -> démarrage normal
                 this.maintenanceActive = false;
                 return this.startLauncher();
             }
         } catch (e) {
             console.error("[Splash] Erreur maintenanceCheck:", e);
             // Si on ne peut pas joindre la config, on propose shutdown
             return this.shutdown("Aucune connexion internet détectée,<br>veuillez réessayer ultérieurement.");
         }
     }
 
     startLauncher() {
         if (this.started) {
             console.log("[Splash] startLauncher déjà appelé - ignoré.");
             return;
         }
         this.started = true;
         this.setStatus(`Démarrage du launcher...`);
         ipcRenderer.send('main-window-open');
         ipcRenderer.send('update-window-close');
     }
 
     shutdown(text) {
         // Si bypass activé on force le start au lieu de shutdown
         if (this.bypassMaintenance || window.BYPASS_MAINTENANCE) {
             console.log("[Splash] shutdown intercepté par bypass -> démarrage");
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
         else console.log("[Splash] setStatus:", text);
     }
 
     toggleProgress() {
         if (this.progress && this.progress.classList.toggle("show")) this.setProgress(0, 1);
     }
 
     setProgress(value, max) {
         if (!this.progress) return;
         this.progress.value = value;
         this.progress.max = max;
     }
 }
 
 function sleep(ms) {
     return new Promise(r => setTimeout(r, ms));
 }
 
 // --- Attach global key listener AFTER DOMContentLoaded to capter correctement les touches dans Electron
 window.addEventListener('DOMContentLoaded', () => {
     window.addEventListener("keydown", (e) => {
         try {
             // Devtools shortcut (garde le comportement existant)
             if ((e.ctrlKey && e.shiftKey && e.code === "KeyI") || e.code === "F12") {
                 ipcRenderer.send("update-window-dev-tools");
                 return;
             }
 
             // Bypass maintenance: Ctrl + Shift + M
             if (e.ctrlKey && e.shiftKey && e.code === "KeyM") {
                 console.log("[Splash] Raccourci clavier détecté : Ctrl+Shift+M");
                 window.BYPASS_MAINTENANCE = true;
 
                 const splashInstance = window.splashInstance;
                 if (splashInstance) {
                     splashInstance.bypassMaintenance = true;
                     // Si on est en maintenance (message affiché), démarrer tout de suite
                     if (splashInstance.maintenanceActive) {
                         console.log("[Splash] maintenanceActive true & bypass activé -> startLauncher()");
                         splashInstance.startLauncher();
                     } else {
                         // Sinon, on met à jour le statut pour indiquer que le bypass est prêt
                         splashInstance.setStatus("Bypass maintenance activé — si une maintenance est détectée, le launcher démarrera automatiquement.");
                     }
                 } else {
                     console.log("[Splash] Bypass activé globalement, instance pas encore créée.");
                 }
 
                 // empêcher tout comportement par défaut non souhaité
                 e.preventDefault();
                 e.stopPropagation();
             }
         } catch (err) {
             console.error("[Splash] erreur listener keydown:", err);
         }
     });
 });
 
 // Créer l'instance (exposée dans le constructeur)
 new Splash();
 