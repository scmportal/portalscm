const pool = require('../db/connection');

async function listarClientes(req, res) {
  try {
    let resultado;

    if (req.user.role === 'client') {
      resultado = await pool.query(
        `
        SELECT id, nome, cnpj, email, consultor, status, criado_em
        FROM clientes
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(cnpj, '.', ''), '/', ''), '-', ''), ' ', '')
            = REPLACE(REPLACE(REPLACE(REPLACE($1, '.', ''), '/', ''), '-', ''), ' ', '')
        ORDER BY nome
        `,
        [req.user.cnpj]
      );
    } else if (req.user.role === 'consult') {
      resultado = await pool.query(
        `
        SELECT id, nome, cnpj, email, consultor, status, criado_em
        FROM clientes
        WHERE LOWER(TRIM(consultor)) = LOWER(TRIM($1))
        ORDER BY nome
        `,
        [req.user.nome || '']
      );
    } else {
      // admin, supervisor — acesso total
      resultado = await pool.query(
        `
        SELECT id, nome, cnpj, email, consultor, status, criado_em
        FROM clientes
        ORDER BY nome
        `
      );
    }

    return res.json(resultado.rows);
  } catch (error) {
    console.error('Erro ao listar clientes:', error);
    return res.status(500).json({
      mensagem: 'Erro ao listar clientes.',
    });
  }
}

async function criarCliente(req, res) {
  try {
    const { nome, cnpj, email, consultor, status } = req.body;

    if (!nome || !cnpj) {
      return res.status(400).json({
        mensagem: 'Nome e CNPJ são obrigatórios.',
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO clientes (nome, cnpj, email, consultor, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, nome, cnpj, email, consultor, status, criado_em
      `,
      [nome, cnpj, email || null, consultor || null, status || 'ativo']
    );

    return res.status(201).json(resultado.rows[0]);
  } catch (error) {
    console.error('Erro ao criar cliente:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        mensagem: 'Já existe um cliente com esse CNPJ.',
      });
    }

    return res.status(500).json({
      mensagem: 'Erro ao criar cliente.',
    });
  }
}

async function atualizarCliente(req, res) {
  try {
    const { id } = req.params;
    const { nome, cnpj, email, consultor, status } = req.body;

    // Consultor só pode atualizar empresas das quais ele já é responsável.
    if (req.user.role === 'consult') {
      const dono = await pool.query(
        `
        SELECT id, consultor
        FROM clientes
        WHERE id = $1
        `,
        [id]
      );

      if (dono.rows.length === 0) {
        return res.status(404).json({
          mensagem: 'Cliente não encontrado.',
        });
      }

      const consultorAtual = String(dono.rows[0].consultor || '').trim().toLowerCase();
      const nomeUsuario = String(req.user.nome || '').trim().toLowerCase();

      if (!consultorAtual || consultorAtual !== nomeUsuario) {
        return res.status(403).json({
          mensagem: 'Você não tem permissão para alterar este cliente.',
        });
      }
    }

    const resultado = await pool.query(
      `
      UPDATE clientes
      SET nome = $1,
          cnpj = $2,
          email = $3,
          consultor = $4,
          status = $5
      WHERE id = $6
      RETURNING id, nome, cnpj, email, consultor, status, criado_em
      `,
      [nome, cnpj, email || null, consultor || null, status || 'ativo', id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        mensagem: 'Cliente não encontrado.',
      });
    }

    return res.json(resultado.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar cliente:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        mensagem: 'Já existe um cliente com esse CNPJ.',
      });
    }

    return res.status(500).json({
      mensagem: 'Erro ao atualizar cliente.',
    });
  }
}

async function excluirCliente(req, res) {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      DELETE FROM clientes
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        mensagem: 'Cliente não encontrado.',
      });
    }

    return res.json({
      mensagem: 'Cliente excluído com sucesso.',
    });
  } catch (error) {
    console.error('Erro ao excluir cliente:', error);
    return res.status(500).json({
      mensagem: 'Erro ao excluir cliente.',
    });
  }
}

module.exports = {
  listarClientes,
  criarCliente,
  atualizarCliente,
  excluirCliente,
};