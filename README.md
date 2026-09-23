# Mon Jardin

Une petite application web pour suivre ses plantes : photo, emplacement, lumière, arrosage été/hiver, nettoyage des feuilles et calendrier des soins. Elle fonctionne localement sans installation ; la synchronisation facultative utilise un Worker et R2. Elle peut être ajoutée à l'écran d'accueil du téléphone.

## Démarrer

Depuis le dossier du projet, lancer `python3 -m http.server 8000`, puis ouvrir `http://localhost:8000`. Aucun paquet à installer.

## Déployer sur Cloudflare Workers avec Static Assets

Le déploiement existant est un **Worker avec Static Assets**. Le dossier `functions/` seul n'y crée pas de route API : `worker.js` importe la fonction de synchronisation et sert les autres requêtes depuis le binding `ASSETS`.

Le fichier `wrangler.jsonc` porte le nom du Worker existant (`monjardin`) et du bucket R2 (`gardeb-bucket`). Sa configuration inclut `main: "./worker.js"`, `assets.directory: "."`, `assets.binding: "ASSETS"`, `assets.run_worker_first: ["/api/*"]` et un binding R2 nommé `GARDEN_BUCKET`. Le dossier `.assetsignore` exclut le code serveur des fichiers publics. La commande de déploiement Git doit lancer `npx wrangler deploy`.

## Synchronisation R2

Le Worker utilise le binding `GARDEN_BUCKET` vers le bucket privé `gardeb-bucket`. Vérifier que `/api/ops` répond 401 sans identifiant : l'API est alors active. La synchronisation démarre automatiquement pour tous les visiteurs, sans configuration ni compte. Le bouton dans la barre du haut indique « En attente », « Synchronisé » ou « À vérifier » et permet de réessayer d'un clic.

Chaque modification de plante ou de profil est enregistrée séparément dans R2. Les appareils relisent l'historique à l'ouverture, au retour sur l'onglet et toutes les 20 secondes lorsque l'onglet est visible. Les modifications hors ligne restent en attente et repartent à la reconnexion. Si deux appareils changent la même plante, la dernière modification reçue par R2 l'emporte. Une opération est limitée à 4 Mo.

**Accès public :** l'identifiant commun est inclus dans le code du navigateur. Toute personne ayant l'adresse du site peut consulter, modifier et supprimer les plantes de tous les profils, y compris leurs photos. Le chiffrement du contenu dans R2 n'offre donc aucune confidentialité entre les visiteurs. Les profils sont des espaces pratiques, pas des comptes protégés.

À la première ouverture après la mise à jour, un navigateur qui conserve l'ancienne clé importe ses plantes dans le jardin commun, puis transfère ses modifications en attente. Il faut ouvrir une fois le site mis à jour sur chaque appareil qui détient des données uniquement locales ou sous une ancienne clé. Recharger les onglets déjà ouverts.

## Profils

Le menu **Profil** permet de créer et de renommer des espaces séparés pour les plantes. Les plantes déjà enregistrées passent dans le profil **Principal**, que l'on peut renommer. Une sauvegarde R2 de l'ancienne version (simple liste de plantes) est lue de la même façon. Tous les profils partagent le même jardin commun : il n'y a ni mot de passe ni séparation des droits entre eux. Le profil sélectionné est mémorisé sur chaque appareil, indépendamment des autres.

## Données et limites du MVP

Les données et photos sont enregistrées **dans le navigateur de cet appareil** avec `localStorage`. Sans le binding R2, elles ne se synchronisent pas entre téléphone et ordinateur. Elles peuvent disparaître si les données du site sont effacées. Les photos sont réduites à 1 000 pixels avant stockage. Un export/import indépendant du cloud reste une prochaine étape utile.

La fréquence été s'applique d'avril à septembre et la fréquence hiver d'octobre à mars (hémisphère nord). Les échéances sont des rappels : vérifier le terreau avant d'arroser. Cliquer sur ✓ enregistre le soin fait aujourd'hui et recalcule sa prochaine date. Aucun compte ni notification n'est encore inclus.
