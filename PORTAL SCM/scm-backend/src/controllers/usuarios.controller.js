const bcrypt = require('bcryptjs');
const pool = require('../db/connection');

async function listarUsuarios(req, res) {
  try {
    const resultado = await pool.query(`
      SELECT id, nome, email, role, cnpj, ativo, criado_em
      FROM usuarios
      ORDER BY 
        CASE role
          WHEN 'admin' THEN 1
          WHEN 'consult' THEN 2
          WHEN 'client' THEN 3
          ELSE 4
        END,
        nome ASC
    `);

    return res.json(resultado.rows);
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    return res.status(500).json({
      mensagem: 'Erro ao listar usuários.',
    });
  }
}

async function criarUsuario(req, res) {
  try {
    const { nome, email, senha, role, cnpj, ativo } = req.body;

    if (!nome || !email || !senha || !role) {
      return res.status(400).json({
        mensagem: 'Nome, e-mail, senha e perfil são obrigatórios.',
      });
    }

    if (!['admin', 'consult', 'client', 'supervisor'].includes(role)) {
      return res.status(400).json({
        mensagem: 'Perfil inválido.',
      });
    }

    if (senha.length < 6) {
      return res.status(400).json({
        mensagem: 'A senha deve ter pelo menos 6 caracteres.',
      });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const resultado = await pool.query(
      `
      INSERT INTO usuarios (nome, email, senha_hash, role, cnpj, ativo)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, nome, email, role, cnpj, ativo, criado_em
      `,
      [
        nome,
        email,
        senhaHash,
        role,
        cnpj || null,
        ativo !== undefined ? ativo : true,
      ]
    );

    return res.status(201).json({
      mensagem: 'Usuário criado com sucesso.',
      usuario: resultado.rows[0],
    });
  } catch (error) {
    console.error('Erro ao criar usuário:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        mensagem: 'Já existe um usuário com esse e-mail.',
      });
    }

    return res.status(500).json({
      mensagem: 'Erro ao criar usuário.',
    });
  }
}

async function atualizarUsuario(req, res) {
  try {
    const { id } = req.params;
    const { nome, email, role, cnpj, ativo, senha } = req.body;

    if (!nome || !email || !role) {
      return res.status(400).json({
        mensagem: 'Nome, e-mail e perfil são obrigatórios.',
      });
    }

    if (!['admin', 'consult', 'client', 'supervisor'].includes(role)) {
      return res.status(400).json({
        mensagem: 'Perfil inválido.',
      });
    }

    let resultado;

    if (senha && senha.trim()) {
      if (senha.length < 6) {
        return res.status(400).json({
          mensagem: 'A nova senha deve ter pelo menos 6 caracteres.',
        });
      }

      const senhaHash = await bcrypt.hash(senha, 10);

      resultado = await pool.query(
        `
        UPDATE usuarios
        SET nome = $1,
            email = $2,
            role = $3,
            cnpj = $4,
            ativo = $5,
            senha_hash = $6
        WHERE id = $7
        RETURNING id, nome, email, role, cnpj, ativo, criado_em
        `,
        [nome, email, role, cnpj || null, ativo, senhaHash, id]
      );
    } else {
      resultado = await pool.query(
        `
        UPDATE usuarios
        SET nome = $1,
            email = $2,
            role = $3,
            cnpj = $4,
            ativo = $5
        WHERE id = $6
        RETURNING id, nome, email, role, cnpj, ativo, criado_em
        `,
        [nome, email, role, cnpj || null, ativo, id]
      );
    }

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        mensagem: 'Usuário não encontrado.',
      });
    }

    return res.json({
      mensagem: 'Usuário atualizado com sucesso.',
      usuario: resultado.rows[0],
    });
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        mensagem: 'Já existe um usuário com esse e-mail.',
      });
    }

    return res.status(500).json({
      mensagem: 'Erro ao atualizar usuário.',
    });
  }
}

async function excluirUsuario(req, res) {
  try {
    const { id } = req.params;

    if (Number(id) === req.user.id) {
      return res.status(400).json({
        mensagem: 'Você não pode excluir sua própria conta logada.',
      });
    }

    const resultado = await pool.query(
      `
      DELETE FROM usuarios
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        mensagem: 'Usuário não encontrado.',
      });
    }

    return res.json({
      mensagem: 'Usuário excluído com sucesso.',
    });
  } catch (error) {
    console.error('Erro ao excluir usuário:', error);
    return res.status(500).json({
      mensagem: 'Erro ao excluir usuário.',
    });
  }
}

module.exports = {
  listarUsuarios,
  criarUsuario,
  atualizarUsuario,
  excluirUsuario,
};