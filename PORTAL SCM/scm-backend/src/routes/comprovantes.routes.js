const express = require('express');
const multer = require('multer');
const path = require('path');

const {
  listarComprovantes,
  anexarComprovante,
  baixarComprovante,
  excluirComprovante,
} = require('../controllers/comprovantes.controller');

const { autenticarToken } = require('../middlewares/auth.middleware');

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/comprovantes');
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const nomeSeguro = file.originalname
      .replace(ext, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase();

    cb(null, `${Date.now()}_${nomeSeguro}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

router.get('/', autenticarToken, listarComprovantes);

router.post(
  '/',
  autenticarToken,
  upload.single('arquivo'),
  anexarComprovante
);

router.get('/:id/download', autenticarToken, baixarComprovante);

router.delete('/:id', autenticarToken, excluirComprovante);

module.exports = router;