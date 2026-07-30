require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { nanoid } = require('nanoid');

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-moi';
const SESSION_SECRET = process.env.SESSION_SECRET || 'secret-a-changer';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(__dirname, 'data', 'photos.json');

// S'assure que les dossiers necessaires existent au demarrage
// (evite un plantage si "uploads" ou "data" ne sont pas presents, par exemple
// s'ils n'ont pas ete correctement envoyes sur GitHub)
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, '[]');
}

// --- Petite "base de donnees" en fichier JSON ---
function readDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  return raw ? JSON.parse(raw) : [];
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Supprime definitivement une photo (fichier + entree en base)
function deletePhoto(id) {
  const photos = readDB();
  const photo = photos.find((p) => p.id === id);
  if (photo) {
    const filePath = path.join(UPLOAD_DIR, photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  writeDB(photos.filter((p) => p.id !== id));
}

// --- Config Multer (upload de fichiers) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${nanoid()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 Mo max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont acceptees'));
  }
});

// --- Middlewares ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 jours
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.redirect('/login');
}

// --- Routes d'authentification ---
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    return res.redirect('/gallery');
  }
  res.render('login', { error: 'Mot de passe incorrect.' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Page d'accueil ---
app.get('/', (req, res) => {
  res.redirect(req.session && req.session.loggedIn ? '/gallery' : '/login');
});

// --- Galerie admin : affiche uniquement le NOM + le QR code, jamais la photo ---
app.get('/gallery', requireAuth, async (req, res, next) => {
  try {
    const photos = readDB().sort((a, b) => b.createdAt - a.createdAt);

    const photosWithQr = await Promise.all(
      photos.map(async (p) => {
        const url = `${BASE_URL}/photo/${p.id}`;
        const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
        return { ...p, url, qrDataUrl };
      })
    );

    res.render('gallery', { photos: photosWithQr });
  } catch (err) {
    next(err);
  }
});

// --- Formulaire d'upload ---
app.get('/upload', requireAuth, (req, res) => {
  res.render('upload', { error: null });
});

app.post('/upload', requireAuth, (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    try {
      if (err) {
        return res.render('upload', { error: err.message });
      }
      if (!req.file) {
        return res.render('upload', { error: 'Aucune image selectionnee.' });
      }

      const name = (req.body.name || '').trim() || req.file.originalname;

      // Nombre max d'ouvertures avant suppression automatique (vide = illimite)
      const maxViewsRaw = (req.body.maxViews || '').trim();
      let maxViews = null;
      if (maxViewsRaw !== '') {
        const parsed = parseInt(maxViewsRaw, 10);
        if (Number.isInteger(parsed) && parsed > 0) {
          maxViews = parsed;
        }
      }

      const photos = readDB();

      photos.push({
        id: nanoid(10),
        name,
        filename: req.file.filename,
        createdAt: Date.now(),
        maxViews,        // null = illimite
        viewCount: 0,
        expired: false
      });

      writeDB(photos);
      res.redirect('/gallery');
    } catch (innerErr) {
      next(innerErr);
    }
  });
});

// --- Suppression d'une photo (manuelle, depuis la galerie) ---
app.post('/delete/:id', requireAuth, (req, res) => {
  deletePhoto(req.params.id);
  res.redirect('/gallery');
});

// --- Telechargement du QR code en PNG ---
app.get('/qr/:id.png', requireAuth, async (req, res) => {
  const photos = readDB();
  const photo = photos.find((p) => p.id === req.params.id);
  if (!photo) return res.status(404).send('Photo introuvable');

  const url = `${BASE_URL}/photo/${photo.id}`;
  res.type('png');
  QRCode.toFileStream(res, url, { width: 500, margin: 2 });
});

// --- Page PUBLIQUE : c'est ce qui s'ouvre quand on scanne le QR code ---
// Important : cette page NE compte PAS encore l'ouverture. Elle affiche
// juste le nom et un bouton. C'est volontaire : les applications de
// messagerie (WhatsApp, Messenger...) chargent automatiquement cette page
// en arriere-plan pour generer un apercu du lien, avant meme que la
// personne ne clique dessus. Si on comptait ici, cet apercu automatique
// consommerait une ouverture "pour rien".
app.get('/photo/:id', (req, res) => {
  const photos = readDB();
  const photo = photos.find((p) => p.id === req.params.id);

  // "expired" = la limite d'ouvertures a deja ete atteinte
  if (!photo || photo.expired) {
    return res.status(404).send('Photo introuvable.');
  }

  res.set('Cache-Control', 'no-store');
  res.render('photo', { photo });
});

// --- Revelation de la photo : appelee uniquement quand la personne clique
// sur le bouton "Afficher la photo". C'est CE moment precis qui compte comme
// une vraie ouverture (un robot d'apercu automatique ne declenche jamais de
// clic, donc il ne consomme plus d'ouverture).
app.post('/reveal/:id', (req, res) => {
  const photos = readDB();
  const photo = photos.find((p) => p.id === req.params.id);

  if (!photo || photo.expired) {
    return res.status(404).json({ ok: false });
  }

  photo.viewCount = (photo.viewCount || 0) + 1;
  writeDB(photos);

  const reachedLimit = photo.maxViews && photo.viewCount >= photo.maxViews;

  if (reachedLimit) {
    const current = readDB();
    const target = current.find((p) => p.id === photo.id);
    if (target) {
      target.expired = true;
      writeDB(current);
    }

    // On laisse quelques secondes pour que l'image ait le temps de charger
    // avant de vraiment supprimer le fichier.
    setTimeout(() => {
      deletePhoto(photo.id);
    }, 8000);
  }

  res.json({ ok: true, imgUrl: `/img/${photo.id}` });
});

// --- Sert le fichier image reel, uniquement via l'id (pas de listing du dossier uploads) ---
// Note : on ne bloque pas sur "photo.expired" ici. Juste apres le clic sur
// "Afficher la photo", la photo peut deja etre marquee comme expiree (pour
// empecher une deuxieme ouverture), mais le fichier existe encore quelques
// secondes le temps que l'image charge vraiment a l'ecran. Si la photo n'est
// plus dans la base (vraiment supprimee), "photo" sera introuvable ci-dessous.
app.get('/img/:id', (req, res) => {
  const photos = readDB();
  const photo = photos.find((p) => p.id === req.params.id);
  if (!photo) return res.status(404).send('Introuvable');

  const filePath = path.join(UPLOAD_DIR, photo.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Introuvable');

  res.set('Cache-Control', 'no-store');
  res.sendFile(filePath);
});

// --- Gestion des erreurs : affiche un message clair au lieu d'une page blanche ---
app.use((err, req, res, next) => {
  console.error('Erreur serveur :', err);
  res.status(500).send(`
    <div style="font-family: sans-serif; max-width: 600px; margin: 60px auto; padding: 20px;">
      <h1>Une erreur est survenue</h1>
      <p>Le site a rencontre un probleme. Details techniques :</p>
      <pre style="background:#f4f4f4; padding:12px; border-radius:8px; white-space: pre-wrap;">${err.message}</pre>
      <p><a href="/gallery">Retour a la galerie</a></p>
    </div>
  `);
});

app.listen(PORT, () => {
  console.log(`Site photo-QR lance sur ${BASE_URL} (port ${PORT})`);
});
