const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { autenticarToken, autorizarRoles } = require('../middlewares/auth.middleware');

router.get('/', autenticarToken, autorizarRoles('admin'), async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT 
        id,
        nome,
        email,
        role,
        cnpj,
        ativo,
        criado_em
      FROM usuarios
      ORDER BY criado_em DESC
    `);

    return res.json(resultado.rows);
  } catch (error) {
    console.error('Erro ao listar usuários:', error);

    return res.status(500).json({
      mensagem: 'Erro ao listar usuários.'
    });
  }
});

router.delete('/:id', autenticarToken, autorizarRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    if (String(req.user.id) === String(id)) {
      return res.status(400).json({
        mensagem: 'Você não pode excluir a própria conta logada.'
      });
    }

    const resultado = await pool.query(
      `
      DELETE FROM usuarios
      WHERE id = $1
      RETURNING id, nome, email
      `,
      [id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({
        mensagem: 'Usuário não encontrado.'
      });
    }

    return res.json({
      mensagem: 'Usuário excluído com sucesso.',
      usuario: resultado.rows[0]
    });
  } catch (error) {
    console.error('Erro ao excluir usuário:', error);

    return res.status(500).json({
      mensagem: 'Erro ao excluir usuário.'
    });
  }
});

module.exports = router;