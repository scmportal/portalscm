const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/connection');

async function register(req, res) {
  try {
    const { nome, email, senha, role, cnpj } = req.body;

    if (!nome || !email || !senha || !role) {
      return res.status(400).json({
        mensagem: 'Nome, email, senha e perfil são obrigatórios.',
      });
    }

    if (!['admin', 'consult', 'client', 'supervisor'].includes(role)) {
      return res.status(400).json({
        mensagem: 'Perfil inválido.',
      });
    }

    if (role === 'client' && !cnpj) {
      return res.status(400).json({
        mensagem: 'CNPJ é obrigatório para cadastro de cliente.',
      });
    }

    if (senha.length < 6) {
      return res.status(400).json({
        mensagem: 'A senha deve ter pelo menos 6 caracteres.',
      });
    }

    const usuarioExistente = await pool.query(
      `
      SELECT id
      FROM usuarios
      WHERE LOWER(email) = LOWER($1)
      `,
      [email]
    );

    if (usuarioExistente.rows.length > 0) {
      return res.status(409).json({
        mensagem: 'Já existe um usuário com esse email.',
      });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const resultado = await pool.query(
      `
      INSERT INTO usuarios (nome, email, senha_hash, role, cnpj, ativo)
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING id, nome, email, role, cnpj, ativo, criado_em
      `,
      [
        nome.trim(),
        email.trim(),
        senhaHash,
        role,
        cnpj ? cnpj.trim() : null,
      ]
    );

    const usuario = resultado.rows[0];

    if (usuario.role === 'client') {
      await pool.query(
        `
        INSERT INTO clientes (nome, cnpj, email, consultor, status)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (cnpj) DO UPDATE SET
          nome = EXCLUDED.nome,
          email = EXCLUDED.email,
          status = 'ativo'
        `,
        [
          usuario.nome,
          usuario.cnpj,
          usuario.email,
          null,
          'ativo',
        ]
      );
    }

    return res.status(201).json({
      mensagem: 'Usuário cadastrado com sucesso.',
      usuario,
    });
  } catch (error) {
    console.error('Erro ao cadastrar usuário:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        mensagem: 'Já existe um usuário com esse email ou CNPJ.',
      });
    }

    return res.status(500).json({
      mensagem: 'Erro interno ao cadastrar usuário.',
      detalhe: error.message,
    });
  }
}

async function login(req, res) {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({
        mensagem: 'E-mail/CNPJ e senha são obrigatórios.',
      });
    }

    const identificador = String(email).trim();
    const apenasNumeros = identificador.replace(/\D/g, '');

    const resultado = await pool.query(
      `
      SELECT id, nome, email, senha_hash, role, cnpj, ativo
      FROM usuarios
      WHERE LOWER(email) = LOWER($1)
         OR REPLACE(REPLACE(REPLACE(REPLACE(cnpj, '.', ''), '/', ''), '-', ''), ' ', '') = $2
      `,
      [identificador, apenasNumeros]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({
        mensagem: 'Email/CNPJ ou senha inválidos.',
      });
    }

    const usuario = resultado.rows[0];

    if (!usuario.ativo) {
      return res.status(403).json({
        mensagem: 'Usuário inativo.',
      });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);

    if (!senhaValida) {
      return res.status(401).json({
        mensagem: 'Email/CNPJ ou senha inválidos.',
      });
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        cnpj: usuario.cnpj,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: '8h',
      }
    );

    return res.json({
      mensagem: 'Login realizado com sucesso.',
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        cnpj: usuario.cnpj,
      },
    });
  } catch (error) {
    console.error('Erro no login:', error);

    return res.status(500).json({
      mensagem: 'Erro interno no servidor.',
      detalhe: error.message,
    });
  }
}

async function me(req, res) {
  return res.json({
    usuario: req.user,
  });
}

module.exports = {
  login,
  register,
  me,
};