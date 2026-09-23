# Mon Jardin

Une petite application web pour suivre ses plantes : photo, emplacement, lumière, arrosage été/hiver, nettoyage des feuilles et calendrier des soins. Elle fonctionne localement sans installation ; la synchronisation facultative utilise un Worker et R2. Elle peut être ajoutée à l'écran d'accueil du téléphone.

## Démarrer

Depuis le dossier du projet, lancer `python3 -m http.server 8000`, puis ouvrir `http://localhost:8000`. Aucun paquet à installer.

## Déployer sur Cloudflare Workers avec Static Assets

Le déploiement existant est un **Worker avec Static Assets**. Le dossier `functions/` seul n'y crée pas de route API : `worker.js` importe la fonction de synchronisation et sert les autres requêtes depuis le binding `ASSETS`.

Le fichier `wrangler.jsonc` porte le nom du Worker existant (`monjardin`) et du bucket R2 (`gardeb-bucket`). Sa configuration inclut `main: "./worker.js"`, `assets.directory: "."`, `assets.binding: "ASSETS"`, `assets.run_worker_first: ["/api/*"]` et un binding R2 nommé `GARDEN_BUCKET`. Le dossier `.assetsignore` exclut le code serveur des fichiers publics. La commande de déploiement Git doit lancer `npx wrangler deploy`.

## Activer la synchronisation R2

1. Créer un bucket R2 privé dans le même compte Cloudflare que le Worker. Ne pas activer d'accès public au bucket et ne pas créer de clé API R2 pour le navigateur.
2. Le bucket **`gardeb-bucket`** est déjà déclaré dans `wrangler.jsonc` avec le binding **`GARDEN_BUCKET`**. Déployer le Worker complet avec `npx wrangler deploy`. Un projet qui ne déploie que des assets statiques n'exécute pas l'API `/api/sync`.
3. Vérifier que `/api/sync` répond 401 sans clé, plutôt que de renvoyer la page HTML du site ; l'API est alors active.
4. Dans l'application, ouvrir **☁ Synchronisation**, cliquer sur **Créer / connecter** puis **Copier la clé**. Coller cette clé sur le deuxième appareil et cliquer sur **Créer / connecter**. Conserver la clé dans un endroit sûr : elle sert à accéder aux données et ne peut pas être retrouvée depuis le serveur.

Les données, photos incluses, sont chiffrées dans le navigateur avec AES-GCM avant envoi. Le bucket ne reçoit qu'un document chiffré, identifié par une empreinte de la clé. La clé est conservée dans le stockage local de chaque navigateur et envoyée uniquement à la fonction du même site via HTTPS. Une sauvegarde est limitée à 8 Mo. Les modifications locales sont envoyées automatiquement après chaque édition ; les autres appareils récupèrent le cloud à l'ouverture, au retour sur l'onglet et périodiquement tant que l'onglet est visible. Si deux appareils modifient des plantes différentes, leurs changements sont fusionnés et réessayés automatiquement. Si les deux modifient exactement la même plante, la version du dernier appareil à synchroniser l'emporte. Les changements non envoyés restent locaux lors d'une coupure réseau et sont réessayés à la reconnexion. Pour une modification déjà bloquée par l'ancienne version sans détail de changement, une « copie locale » peut être créée afin de conserver les deux variantes.

## Profils

Le menu **Profil** permet de créer et de renommer des espaces séparés pour les plantes. Les plantes déjà enregistrées passent dans le profil **Principal**, que l'on peut renommer. Une sauvegarde R2 de l'ancienne version (simple liste de plantes) est lue de la même façon. Tous les profils sont stockés ensemble sous la même clé de synchronisation : il n'y a ni mot de passe ni séparation des droits entre eux. Le profil sélectionné est mémorisé sur chaque appareil, indépendamment des autres.

## Données et limites du MVP

Les données et photos sont enregistrées **dans le navigateur de cet appareil** avec `localStorage`. Sans le binding R2 et une clé connectée, elles ne se synchronisent pas entre téléphone et ordinateur. Elles peuvent disparaître si les données du site sont effacées. Les photos sont réduites à 1 000 pixels avant stockage. Un export/import indépendant du cloud reste une prochaine étape utile.

La fréquence été s'applique d'avril à septembre et la fréquence hiver d'octobre à mars (hémisphère nord). Les échéances sont des rappels : vérifier le terreau avant d'arroser. Cliquer sur ✓ enregistre le soin fait aujourd'hui et recalcule sa prochaine date. Aucun compte ni notification n'est encore inclus.
