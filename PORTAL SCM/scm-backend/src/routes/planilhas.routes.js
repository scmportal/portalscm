const express = require('express');
const router = express.Router();

const {
  listarPlanilhas,
  criarPlanilha,
  buscarPlanilhaPorId,
  atualizarStatusPlanilha,
  atualizarPlanilha,
  excluirPlanilha,
} = require('../controllers/planilhas.controller');

const {
  autenticarToken,
} = require('../middlewares/auth.middleware');

router.get('/', autenticarToken, listarPlanilhas);
router.post('/', autenticarToken, criarPlanilha);
router.get('/:id', autenticarToken, buscarPlanilhaPorId);
router.patch('/:id/status', autenticarToken, atualizarStatusPlanilha);
router.put('/:id', autenticarToken, atualizarPlanilha);
router.delete('/:id', autenticarToken, excluirPlanilha);

module.exports = router;