const path = require('path');
const fs = require('fs');
const pool = require('../db/connection');

async function listarComprovantes(req, res) {
  try {
    let resultado;

    if (req.user.role === 'client') {
      resultado = await pool.query(
        `
        SELECT id, usuario_id, cnpj, competencia, nome_original, nome_arquivo,
               tipo_arquivo, tamanho_bytes, enviado_por, criado_em
        FROM comprovantes
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(cnpj, '.', ''), '/', ''), '-', ''), ' ', '') =
              REPLACE(REPLACE(REPLACE(REPLACE($1, '.', ''), '/', ''), '-', ''), ' ', '')
        ORDER BY competencia DESC, criado_em DESC
        `,
        [req.user.cnpj]
      );
    } else if (req.user.role === 'consult') {
      // Consultor: apenas comprovantes das empresas que ele atende.
      resultado = await pool.query(
        `
        SELECT cp.id, cp.usuario_id, cp.cnpj, cp.competencia, cp.nome_original,
               cp.nome_arquivo, cp.tipo_arquivo, cp.tamanho_bytes, cp.enviado_por,
               cp.criado_em
        FROM comprovantes cp
        INNER JOIN clientes c
          ON REPLACE(REPLACE(REPLACE(REPLACE(c.cnpj, '.', ''), '/', ''), '-', ''), ' ', '')
             = REPLACE(REPLACE(REPLACE(REPLACE(cp.cnpj, '.', ''), '/', ''), '-', ''), ' ', '')
        WHERE LOWER(TRIM(c.consultor)) = LOWER(TRIM($1))
        ORDER BY cp.competencia DESC, cp.criado_em DESC
        `,
        [req.user.nome || '']
      );
    } else {
      // admin, supervisor
      resultado = await pool.query(
        `
        SELECT id, usuario_id, cnpj, competencia, nome_original, nome_arquivo,
               tipo_arquivo, tamanho_bytes, enviado_por, criado_em
        FROM comprovantes
        ORDER BY competencia DESC, criado_em DESC
        `
      );
    }

    return res.json(resultado.rows);
  } catch (error) {
    console.error('Erro ao listar comprovantes:', error);
    return res.status(500).json({
      mensagem: 'Erro ao listar comprovantes.',
    });
  }
}

async function consultorAtendeCnpj(req, cnpj) {
  if (req.user.role !== 'consult') return true;

  const resultado = await pool.query(
    `
    SELECT 1
    FROM clientes
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(cnpj, '.', ''), '/', ''), '-', ''), ' ', '') =
          REPLACE(REPLACE(REPLACE(REPLACE($1, '.', ''), '/', ''), '-', ''), ' ', '')
      AND LOWER(TRIM(consultor)) = LOWER(TRIM($2))
    LIMIT 1
    `,
    [cnpj || '', req.user.nome || '']
  );

  return resultado.rowCount > 0;
}

async function anexarComprovante(req, res) {
  try {
    const { competencia } = req.body;

    if (!competencia) {
      return res.status(400).json({
        mensagem: 'Competência é obrigatória.',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        mensagem: 'Arquivo não enviado.',
      });
    }

    const cnpj = req.user.role === 'client'
      ? req.user.cnpj
      : req.body.cnpj || null;

    if (!cnpj) {
      return res.status(400).json({
        mensagem: 'CNPJ do cliente é obrigatório para anexar comprovante.',
      });
    }

    if (!(await consultorAtendeCnpj(req, cnpj))) {
      return res.status(403).json({
        mensagem: 'Você não tem permissão para anexar comprovantes para este cliente.',
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO comprovantes (
        usuario_id,
        cnpj,
        competencia,
        nome_original,
        nome_arquivo,
        caminho_arquivo,
        tipo_arquivo,
        tamanho_bytes,
        enviado_por
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, usuario_id, cnpj, competencia, nome_original, nome_arquivo,
                tipo_arquivo, tamanho_bytes, enviado_por, criado_em
      `,
      
      [
        req.user.id,
        cnpj,
        competencia,
        req.file.originalname,
        req.file.filename,
        req.file.path,
        req.file.mimetype,
        req.file.size,
        req.user.role === 'consult'
  ? `${req.user.nome || req.user.email} — Consultor SCM`
  : req.user.nome || req.user.email
      ]
    );
    await pool.query(
  `
  UPDATE planilhas_coleta
  SET status = 'comprovante_anexado',
      atualizado_em = CURRENT_TIMESTAMP
  WHERE REPLACE(REPLACE(REPLACE(REPLACE(cnpj, '.', ''), '/', ''), '-', ''), ' ', '') =
        REPLACE(REPLACE(REPLACE(REPLACE($1, '.', ''), '/', ''), '-', ''), ' ', '')
    AND competencia = $2
  `,
  [cnpj, competencia]
);

    return res.status(201).json({
      mensagem: 'Comprovante anexado com sucesso.',
      comprovante: resultado.rows[0],
    });
  } catch (error) {
    console.error('Erro ao anexar comprovante:', error);
    return res.status(500).json({
      mensagem: 'Erro ao anexar comprovante.',
    });
  }
}

async function baixarComprovante(req, res) {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      SELECT *
      FROM comprovantes
      WHERE id = $1
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        mensagem: 'Comprovante não encontrado.',
      });
    }

    const comprovante = resultado.rows[0];

    if (req.user.role === 'client') {
      const cnpjUsuario = String(req.user.cnpj || '').replace(/\D/g, '');
      const cnpjComp = String(comprovante.cnpj || '').replace(/\D/g, '');

      if (cnpjUsuario !== cnpjComp) {
        return res.status(403).json({
          mensagem: 'Você não tem permissão para baixar este comprovante.',
        });
      }
    }

    if (!(await consultorAtendeCnpj(req, comprovante.cnpj))) {
      return res.status(403).json({
        mensagem: 'Você não tem permissão para baixar este comprovante.',
      });
    }

    const caminho = path.resolve(comprovante.caminho_arquivo);

    if (!fs.existsSync(caminho)) {
      return res.status(404).json({
        mensagem: 'Arquivo não encontrado no servidor.',
      });
    }

    return res.download(caminho, comprovante.nome_original);
  } catch (error) {
    console.error('Erro ao baixar comprovante:', error);
    return res.status(500).json({
      mensagem: 'Erro ao baixar comprovante.',
    });
  }
}

async function excluirComprovante(req, res) {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      SELECT *
      FROM comprovantes
      WHERE id = $1
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        mensagem: 'Comprovante não encontrado.',
      });
    }

    const comprovante = resultado.rows[0];

    if (req.user.role === 'client') {
      const cnpjUsuario = String(req.user.cnpj || '').replace(/\D/g, '');
      const cnpjComp = String(comprovante.cnpj || '').replace(/\D/g, '');

      if (cnpjUsuario !== cnpjComp) {
        return res.status(403).json({
          mensagem: 'Você não tem permissão para excluir este comprovante.',
        });
      }
    }

    if (!(await consultorAtendeCnpj(req, comprovante.cnpj))) {
      return res.status(403).json({
        mensagem: 'Você não tem permissão para excluir este comprovante.',
      });
    }

    const caminho = path.resolve(comprovante.caminho_arquivo);

    if (fs.existsSync(caminho)) {
      fs.unlinkSync(caminho);
    }

    await pool.query(
      `
      DELETE FROM comprovantes
      WHERE id = $1
      `,
      [id]
    );

    return res.json({
      mensagem: 'Comprovante excluído com sucesso.',
    });
  } catch (error) {
    console.error('Erro ao excluir comprovante:', error);
    return res.status(500).json({
      mensagem: 'Erro ao excluir comprovante.',
    });
  }
}

module.exports = {
  listarComprovantes,
  anexarComprovante,
  baixarComprovante,
  excluirComprovante,
};