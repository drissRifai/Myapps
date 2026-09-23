# Mon Jardin

Une petite application web pour suivre ses plantes : photo, emplacement, lumière, arrosage été/hiver, nettoyage des feuilles et calendrier des soins. Elle fonctionne sans installation ni serveur et peut être ajoutée à l'écran d'accueil du téléphone.

## Démarrer

Depuis le dossier du projet, lancer `python3 -m http.server 8000`, puis ouvrir `http://localhost:8000`. Aucun paquet à installer.

## Déployer sur Cloudflare Pages

1. Dans Cloudflare, aller à **Workers & Pages → Create → Pages → Connect to Git** et choisir ce dépôt GitHub.
2. Choisir la branche `main`, le preset **None**, laisser la commande de build vide et définir le dossier de sortie sur `.` (racine du dépôt).
3. Chaque push sur `main` publie la version principale. Les autres branches reçoivent des aperçus ; la GitHub Action vérifie la syntaxe de JavaScript.

## Données et limites du MVP

Les données et photos sont enregistrées **dans le navigateur de cet appareil** avec `localStorage`. Elles ne se synchronisent pas entre téléphone et ordinateur, disparaissent si les données du site sont effacées et peuvent être perdues en navigation privée. Les photos sont réduites à 1 000 pixels avant stockage. Un export et une synchronisation via D1/R2 sont les prochaines étapes avant d'y mettre une collection importante.

La fréquence été s'applique d'avril à septembre et la fréquence hiver d'octobre à mars (hémisphère nord). Les échéances sont des rappels : vérifier le terreau avant d'arroser. Cliquer sur ✓ enregistre le soin fait aujourd'hui et recalcule sa prochaine date. Aucun compte ni notification n'est encore inclus.
