# Photo QR Site

Petit site perso pour héberger des photos : chaque photo a son propre QR code.
Quand quelqu'un scanne le QR code, il arrive directement sur la photo. Nulle
part la photo n'apparaît à côté du QR code dans l'espace admin — seulement
le nom que vous lui avez donné.

## Comment ça marche

- **`/login`** — espace protégé par mot de passe (vous seul)
- **`/upload`** — ajouter une photo (avec un nom)
- **`/gallery`** — liste de vos photos : nom + QR code, jamais l'image
- **`/photo/:id`** — page publique, sans mot de passe, qui affiche la photo.
  C'est CETTE page que le QR code encode, et c'est elle qui s'ouvre au scan.

Les fichiers sont stockés avec un nom aléatoire non devinable, et ne sont
servis que via leur identifiant — impossible de lister le dossier des photos.

## Installation en local

1. Installez [Node.js](https://nodejs.org/) (version 18 ou plus récente).
2. Dans le dossier du projet :
   ```bash
   npm install
   ```
3. Copiez `.env.example` en `.env` et modifiez au minimum `ADMIN_PASSWORD`
   et `SESSION_SECRET` :
   ```bash
   cp .env.example .env
   ```
4. Lancez le site :
   ```bash
   npm start
   ```
5. Ouvrez `http://localhost:3000`.

⚠️ En local, les QR codes généreront des liens `http://localhost:3000/...`,
qui ne fonctionneront que sur votre propre ordinateur. Pour que le scan
fonctionne depuis un vrai téléphone, il faut déployer le site en ligne
(voir ci-dessous) et mettre l'URL publique dans `BASE_URL`.

## Déploiement en ligne

Ce site est un simple serveur Node.js/Express, il peut être déployé sur
n'importe quel hébergeur qui supporte Node.js. Deux options simples et peu
coûteuses (voire gratuites pour un usage personnel) :

### Option A — Railway ou Render (le plus simple)

1. Créez un dépôt Git (GitHub par exemple) avec ce projet.
2. Créez un compte sur [Railway](https://railway.app) ou
   [Render](https://render.com).
3. Créez un nouveau service "Web Service" relié à votre dépôt.
4. Dans les variables d'environnement du service, ajoutez :
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
   - `BASE_URL` = l'URL publique fournie par l'hébergeur
     (ex : `https://mon-site.up.railway.app`)
5. Déployez. Le site sera accessible à cette URL.

⚠️ Sur ces hébergeurs, le système de fichiers est souvent **éphémère**
(les photos uploadées peuvent être effacées à chaque redéploiement). Pour un
usage sérieux, pensez à ajouter un volume persistant (les deux plateformes
proposent une option "volume" ou "disk" payante à faible coût), sinon vos
photos disparaîtront lors des mises à jour.

### Option B — VPS (ex: OVH, Hetzner, DigitalOcean)

1. Installez Node.js sur le serveur.
2. Copiez le projet dessus (`git clone` ou `scp`).
3. `npm install`, configurez `.env` avec votre vrai nom de domaine dans
   `BASE_URL`.
4. Utilisez [pm2](https://pm2.keymetrics.io/) pour garder le site actif :
   ```bash
   npm install -g pm2
   pm2 start server.js --name photo-qr-site
   ```
5. Mettez un reverse proxy (nginx) devant, avec un certificat HTTPS
   (Let's Encrypt / Certbot) — recommandé pour que les navigateurs des
   téléphones affichent le site correctement.

Sur un VPS, le dossier `uploads/` est bien persistant (pensez simplement à
faire des sauvegardes régulières).

## Sécurité — quelques recommandations

- Choisissez un `ADMIN_PASSWORD` réellement solide (ce n'est pas un compte
  avec identifiant, juste un mot de passe : autant le rendre long).
- Servez toujours le site en HTTPS une fois en ligne (sinon le mot de passe
  circule en clair).
- Le dossier `uploads/` ne doit jamais être exposé directement via
  `express.static` — c'est pour ça que les photos sont servies via la route
  `/img/:id` uniquement.
