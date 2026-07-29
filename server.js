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

// --- Petite "base de donnees" en fichier JSON ---
function readDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  return raw ? JSON.parse(raw) : [];
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
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
app.get('/gallery', requireAuth, async (req, res) => {
  const photos = readDB().sort((a, b) => b.createdAt - a.createdAt);

  const photosWithQr = await Promise.all(
    photos.map(async (p) => {
      const url = `${BASE_URL}/photo/${p.id}`;
      const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
      return { ...p, url, qrDataUrl };
    })
  );

  res.render('gallery', { photos: photosWithQr });
});

// --- Formulaire d'upload ---
app.get('/upload', requireAuth, (req, res) => {
  res.render('upload', { error: null });
});

app.post('/upload', requireAuth, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      return res.render('upload', { error: err.message });
    }
    if (!req.file) {
      return res.render('upload', { error: 'Aucune image selectionnee.' });
    }

    const name = (req.body.name || '').trim() || req.file.originalname;
    const photos = readDB();

    photos.push({
      id: nanoid(10),
      name,
      filename: req.file.filename,
      createdAt: Date.now()
    });

    writeDB(photos);
    res.redirect('/gallery');
  });
});

// --- Suppression d'une photo ---
app.post('/delete/:id', requireAuth, (req, res) => {
  const photos = readDB();
  const photo = photos.find((p) => p.id === req.params.id);

  if (photo) {
    const filePath = path.join(UPLOAD_DIR, photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    writeDB(photos.filter((p) => p.id !== req.params.id));
  }

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
app.get('/photo/:id', (req, res) => {
  const photos = readDB();
  const photo = photos.find((p) => p.id === req.params.id);

  if (!photo) {
    return res.status(404).send('Photo introuvable.');
  }

  res.render('photo', { photo });
});

// --- Sert le fichier image reel, uniquement via l'id (pas de listing du dossier uploads) ---
app.get('/img/:id', (req, res) => {
  const photos = readDB();
  const photo = photos.find((p) => p.id === req.params.id);
  if (!photo) return res.status(404).send('Introuvable');

  res.sendFile(path.join(UPLOAD_DIR, photo.filename));
});

app.listen(PORT, () => {
  console.log(`Site photo-QR lance sur ${BASE_URL} (port ${PORT})`);
});
