# Mon Jardin

Une petite application web pour suivre ses plantes : photo, emplacement, lumière, arrosage été/hiver, nettoyage des feuilles et calendrier des soins. Elle fonctionne localement sans installation ; la synchronisation facultative utilise une Pages Function et R2. Elle peut être ajoutée à l'écran d'accueil du téléphone.

## Démarrer

Depuis le dossier du projet, lancer `python3 -m http.server 8000`, puis ouvrir `http://localhost:8000`. Aucun paquet à installer.

## Déployer sur Cloudflare Pages

1. Dans Cloudflare, aller à **Workers & Pages → Create → Pages → Connect to Git** et choisir ce dépôt GitHub.
2. Choisir la branche `main`, le preset **None**, laisser la commande de build vide et définir le dossier de sortie sur `.` (racine du dépôt). Le dossier `functions/` est déployé automatiquement comme API Pages Functions.
3. Chaque push sur `main` publie la version principale. Les autres branches reçoivent des aperçus ; la GitHub Action vérifie la syntaxe de JavaScript.

## Activer la synchronisation R2

1. Créer un bucket R2 privé dans le même compte Cloudflare que le projet Pages. Ne pas activer d'accès public au bucket et ne pas créer de clé API R2 pour le navigateur.
2. Dans **Workers & Pages → ton projet Pages → Settings → Bindings → Add → R2 bucket**, choisir ce bucket et nommer la variable **`GARDEN_BUCKET`**. Ajouter le binding à **Production** (et aussi à **Preview** uniquement si les aperçus doivent synchroniser les mêmes données).
3. **Redéployer** le dernier commit du projet pour activer le binding. Sans celui-ci, l'API `/api/sync` répond 503 et la synchronisation n'est pas active.
4. Dans l'application, ouvrir **☁ Synchronisation**, cliquer sur **Créer / connecter** puis **Copier la clé**. Coller cette clé sur le deuxième appareil et cliquer sur **Créer / connecter**. Conserver la clé dans un endroit sûr : elle sert à accéder aux données et ne peut pas être retrouvée depuis le serveur.

Les données, photos incluses, sont chiffrées dans le navigateur avec AES-GCM avant envoi. Le bucket ne reçoit qu'un document chiffré, identifié par une empreinte de la clé. La clé est conservée dans le stockage local de chaque navigateur et envoyée uniquement à la fonction du même site via HTTPS. Une sauvegarde est limitée à 8 Mo. Les modifications locales sont envoyées après édition ; les autres appareils récupèrent le cloud à l'ouverture ou au retour sur l'onglet. Si deux appareils changent des données hors ligne, l'application bloque l'écrasement et affiche un conflit. Déconnecter puis reconnecter la clé permet de choisir la version cloud ; conserver une copie locale avant de confirmer son remplacement.

## Données et limites du MVP

Les données et photos sont enregistrées **dans le navigateur de cet appareil** avec `localStorage`. Sans le binding R2 et une clé connectée, elles ne se synchronisent pas entre téléphone et ordinateur. Elles peuvent disparaître si les données du site sont effacées. Les photos sont réduites à 1 000 pixels avant stockage. Un export/import indépendant du cloud reste une prochaine étape utile.

La fréquence été s'applique d'avril à septembre et la fréquence hiver d'octobre à mars (hémisphère nord). Les échéances sont des rappels : vérifier le terreau avant d'arroser. Cliquer sur ✓ enregistre le soin fait aujourd'hui et recalcule sa prochaine date. Aucun compte ni notification n'est encore inclus.
