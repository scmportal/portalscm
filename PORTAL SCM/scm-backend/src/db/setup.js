const bcrypt = require('bcryptjs');
const pool = require('./connection');

async function setupDatabase() {
  try {
    console.log('Iniciando setup do banco...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL,
        role VARCHAR(30) NOT NULL CHECK (role IN ('admin', 'consult', 'client')),
        cnpj VARCHAR(20),
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        cnpj VARCHAR(20) UNIQUE NOT NULL,
        email VARCHAR(150),
        consultor VARCHAR(150),
        status VARCHAR(30) DEFAULT 'ativo',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
  CREATE TABLE IF NOT EXISTS comprovantes (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    cnpj VARCHAR(20),
    competencia VARCHAR(7) NOT NULL,
    nome_original VARCHAR(255) NOT NULL,
    nome_arquivo VARCHAR(255) NOT NULL,
    caminho_arquivo TEXT NOT NULL,
    tipo_arquivo VARCHAR(120),
    tamanho_bytes INTEGER,
    enviado_por VARCHAR(150),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS planilhas_coleta (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    cnpj VARCHAR(20),
    cliente_nome VARCHAR(150),
    competencia VARCHAR(30),
    nome_arquivo VARCHAR(255),
    tipo_arquivo VARCHAR(20),
    total_original INTEGER DEFAULT 0,
    total_final INTEGER DEFAULT 0,
    duplicidades INTEGER DEFAULT 0,
    status VARCHAR(30) DEFAULT 'Importada',
    dados_json JSONB NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
await pool.query(`
  ALTER TABLE planilhas_coleta
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
`);
    console.log('Tabelas criadas/verificadas com sucesso.');

    const senhaPadrao = await bcrypt.hash('123456', 10);

    const usuariosIniciais = [
      {
  nome: 'Lucas',
  email: 'lucas@scm.com',
  senha_hash: senhaPadrao,
  role: 'consult',
  cnpj: null,
},
{
  nome: 'Carlos',
  email: 'carlos@scm.com',
  senha_hash: senhaPadrao,
  role: 'consult',
  cnpj: null,
},
{
  nome: 'Cauã',
  email: 'cauaa@scm.com',
  senha_hash: senhaPadrao,
  role: 'consult',
  cnpj: null,
},
{
  nome: 'João',
  email: 'joao@scm.com',
  senha_hash: senhaPadrao,
  role: 'consult',
  cnpj: null,
},
{
  nome: 'Noemi',
  email: 'noemi@scm.com',
  senha_hash: senhaPadrao,
  role: 'consult',
  cnpj: null,
},
{
  nome: 'Cleyton',
  email: 'cleyton@scm.com',
  senha_hash: senhaPadrao,
  role: 'consult',
  cnpj: null,
},
{
  nome: 'Bárbara',
  email: 'barbara@scm.com',
  senha_hash: senhaPadrao,
  role: 'consult',
  cnpj: null,
},
{
  nome: 'Eduardo',
  email: 'eduardo@scm.com',
  senha_hash: senhaPadrao,
  role: 'consult',
  cnpj: null,
},
{
  nome: 'Erik',
  email: 'erik@scm.com',
  senha_hash: senhaPadrao,
  role: 'consult',
  cnpj: null,
},
      {
        nome: 'Administrador',
        email: 'admin@scm.com',
        senha_hash: senhaPadrao,
        role: 'admin',
        cnpj: null,
      },
      {
        nome: 'Consultor SCM',
        email: 'consultor@scm.com',
        senha_hash: senhaPadrao,
        role: 'consult',
        cnpj: null,
      },
      {
        nome: 'Cliente SetWifi',
        email: 'cliente@scm.com',
        senha_hash: senhaPadrao,
        role: 'client',
        cnpj: '08.640.151/0001-16',
      },
      {
        nome: 'Cliente NetPrime',
        email: 'cliente2@scm.com',
        senha_hash: senhaPadrao,
        role: 'client',
        cnpj: '98.765.432/0001-10',
      },
    ];

    for (const usuario of usuariosIniciais) {
      await pool.query(
        `
        INSERT INTO usuarios (nome, email, senha_hash, role, cnpj)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (email) DO NOTHING;
        `,
        [
          usuario.nome,
          usuario.email,
          usuario.senha_hash,
          usuario.role,
          usuario.cnpj,
        ]
      );
    }

    const clientesIniciais = [
      {
        nome: 'SetWifi Telecom',
        cnpj: '08.640.151/0001-16',
        email: 'contato@setwifi.com.br',
        consultor: 'Consultor SCM',
        status: 'ativo',
      },
      {
        nome: 'NetPrime ISP',
        cnpj: '98.765.432/0001-10',
        email: 'dici@netprime.com.br',
        consultor: 'Consultor SCM',
        status: 'ativo',
      },
    ];

    for (const cliente of clientesIniciais) {
      await pool.query(
        `
        INSERT INTO clientes (nome, cnpj, email, consultor, status)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (cnpj) DO NOTHING;
        `,
        [
          cliente.nome,
          cliente.cnpj,
          cliente.email,
          cliente.consultor,
          cliente.status,
        ]
      );
    }

    console.log('Usuários e clientes iniciais criados com sucesso.');
    console.log('');
    console.log('Usuários para teste:');
    console.log('Admin: admin@scm.com / 123456');
    console.log('Consultor: consultor@scm.com / 123456');
    console.log('Cliente: cliente@scm.com / 123456');
    console.log('Cliente 2: cliente2@scm.com / 123456');

    await pool.end();
  } catch (error) {
    console.error('Erro ao configurar banco:', error.message);
    console.error(error);
    process.exit(1);
  }
}

setupDatabase();