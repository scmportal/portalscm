const express = require('express');
const router = express.Router();

const {
  listarClientes,
  criarCliente,
  atualizarCliente,
  excluirCliente,
} = require('../controllers/clientes.controller');

const {
  autenticarToken,
  autorizarRoles,
} = require('../middlewares/auth.middleware');

router.get('/', autenticarToken, listarClientes);

router.post(
  '/',
  autenticarToken,
  autorizarRoles('admin', 'supervisor', 'consult'),
  criarCliente
);

router.put(
  '/:id',
  autenticarToken,
  autorizarRoles('admin', 'supervisor', 'consult'),
  atualizarCliente
);

router.delete(
  '/:id',
  autenticarToken,
  autorizarRoles('admin', 'supervisor'),
  excluirCliente
);

router.get('/teste', (req, res) => {
  res.json({
    mensagem: 'Rota de clientes funcionando',
  });
});

module.exports = router;