const express = require('express');
const router = express.Router();

const { login, register, me } = require('../controllers/auth.controller');
const { autenticarToken } = require('../middlewares/auth.middleware');

router.post('/login', login);
router.post('/register', register);
router.get('/me', autenticarToken, me);


router.get('/teste', (req, res) => {
  res.json({
    mensagem: 'Rota de autenticação funcionando',
  });
});

module.exports = router;