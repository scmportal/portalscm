const pool = require('../db/connection');

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

async function listarPlanilhas(req, res) {
  try {
    let resultado;

    if (req.user.role === 'client') {
      resultado = await pool.query(
        `
        SELECT id, usuario_id, cnpj, cliente_nome, competencia, nome_arquivo,
               tipo_arquivo, total_original, total_final, duplicidades,
               status, criado_em
        FROM planilhas_coleta
        WHERE cnpj = $1
        ORDER BY criado_em DESC
        `,
        [req.user.cnpj]
      );
    } else if (req.user.role === 'consult') {
      resultado = await pool.query(
        `
        SELECT p.id, p.usuario_id, p.cnpj, p.cliente_nome, p.competencia,
               p.nome_arquivo, p.tipo_arquivo, p.total_original,
               p.total_final, p.duplicidades, p.status, p.criado_em
        FROM planilhas_coleta p
        INNER JOIN clientes c
          ON REPLACE(REPLACE(REPLACE(REPLACE(c.cnpj, '.', ''), '/', ''), '-', ''), ' ', '') =
             REPLACE(REPLACE(REPLACE(REPLACE(p.cnpj, '.', ''), '/', ''), '-', ''), ' ', '')
        WHERE LOWER(TRIM(c.consultor)) = LOWER(TRIM($1))
        ORDER BY p.criado_em DESC
        `,
        [req.user.nome]
      );
    } else {
      resultado = await pool.query(
        `
        SELECT id, usuario_id, cnpj, cliente_nome, competencia, nome_arquivo,
               tipo_arquivo, total_original, total_final, duplicidades,
               status, criado_em
        FROM planilhas_coleta
        ORDER BY criado_em DESC
        `
      );
    }

    return res.json(resultado.rows);
  } catch (error) {
    console.error('Erro ao listar planilhas:', error);
    return res.status(500).json({
      mensagem: 'Erro ao listar planilhas.',
    });
  }
}

async function criarPlanilha(req, res) {
  try {
    const {
      cnpj,
      cliente_nome,
      competencia,
      nome_arquivo,
      tipo_arquivo,
      total_original,
      total_final,
      duplicidades,
      dados_json,
    } = req.body;

    if (!competencia || !nome_arquivo || !dados_json) {
      return res.status(400).json({
        mensagem: 'Competência, nome do arquivo e dados da planilha são obrigatórios.',
      });
    }

    const resultado = await pool.query(
      `
      INSERT INTO planilhas_coleta (
        usuario_id,
        cnpj,
        cliente_nome,
        competencia,
        nome_arquivo,
        tipo_arquivo,
        total_original,
        total_final,
        duplicidades,
        status,
        dados_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, usuario_id, cnpj, cliente_nome, competencia, nome_arquivo,
                tipo_arquivo, total_original, total_final, duplicidades,
                status, criado_em
      `,
      [
        req.user.id,
        req.user.cnpj || cnpj,
        cliente_nome || req.user.nome,
        competencia,
        nome_arquivo,
        tipo_arquivo || 'XLSX/CSV',
        total_original || 0,
        total_final || 0,
        duplicidades || 0,
        'recebido',
        JSON.stringify(dados_json),
      ]
    );

    return res.status(201).json({
      mensagem: 'Planilha salva com sucesso.',
      planilha: resultado.rows[0],
    });
  } catch (error) {
    console.error('Erro ao salvar planilha:', error);
    return res.status(500).json({
      mensagem: 'Erro ao salvar planilha.',
    });
  }
}
async function atualizarPlanilha(req, res) {
  try {
    const { id } = req.params;
    const { dados_json, total_final } = req.body;

    if (!Array.isArray(dados_json)) {
      return res.status(400).json({
        mensagem: 'dados_json deve ser uma lista de linhas.',
      });
    }

    if (req.user.role === 'consult') {
      const dono = await pool.query(
        `SELECT cnpj FROM planilhas_coleta WHERE id = $1`,
        [id]
      );

      if (dono.rows.length === 0) {
        return res.status(404).json({ mensagem: 'Planilha não encontrada.' });
      }

      if (!(await consultorAtendeCnpj(req, dono.rows[0].cnpj))) {
        return res.status(403).json({
          mensagem: 'Você não tem permissão para editar esta planilha.',
        });
      }
    }

    let query = `
      UPDATE planilhas_coleta
      SET dados_json = $1,
          total_final = $2
      WHERE id = $3
    `;

    const params = [
      JSON.stringify(dados_json),
      total_final || dados_json.length,
      id,
    ];

    if (req.user.role === 'client') {
      query += ` AND cnpj = $4`;
      params.push(req.user.cnpj);
    }

    query += `
      RETURNING id, nome_arquivo, total_final
    `;

    const resultado = await pool.query(query, params);

    if (resultado.rowCount === 0) {
      return res.status(404).json({
        mensagem: 'Planilha não encontrada ou sem permissão para editar.',
      });
    }

    return res.json({
      mensagem: 'Planilha atualizada com sucesso.',
      planilha: resultado.rows[0],
    });
  } catch (error) {
    console.error('Erro ao atualizar planilha:', error);

    return res.status(500).json({
      mensagem: 'Erro ao atualizar planilha.',
      detalhe: error.message,
    });
  }
}

async function excluirPlanilha(req, res) {
  try {
    const { id } = req.params;

    if (req.user.role === 'consult') {
      const dono = await pool.query(
        `SELECT cnpj FROM planilhas_coleta WHERE id = $1`,
        [id]
      );

      if (dono.rows.length === 0) {
        return res.status(404).json({ mensagem: 'Planilha não encontrada.' });
      }

      if (!(await consultorAtendeCnpj(req, dono.rows[0].cnpj))) {
        return res.status(403).json({
          mensagem: 'Você não tem permissão para excluir esta planilha.',
        });
      }
    }

    let query = `
      DELETE FROM planilhas_coleta
      WHERE id = $1
    `;

    const params = [id];

    if (req.user.role === 'client') {
      query += ` AND cnpj = $2`;
      params.push(req.user.cnpj);
    }

    query += `
      RETURNING id, nome_arquivo
    `;

    const resultado = await pool.query(query, params);

    if (resultado.rowCount === 0) {
      return res.status(404).json({
        mensagem: 'Planilha não encontrada ou sem permissão para excluir.',
      });
    }

    return res.json({
      mensagem: 'Planilha excluída com sucesso.',
      planilha: resultado.rows[0],
    });
  } catch (error) {
    console.error('Erro ao excluir planilha:', error);

    return res.status(500).json({
      mensagem: 'Erro ao excluir planilha.',
      detalhe: error.message,
    });
  }
}
async function obterPlanilha(req, res) {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      SELECT *
      FROM planilhas_coleta
      WHERE id = $1
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        mensagem: 'Planilha não encontrada.',
      });
    }

    const planilha = resultado.rows[0];

    if (req.user.role === 'client') {
      const cnpjUsuario = String(req.user.cnpj || '').replace(/\D/g, '');
      const cnpjPlanilha = String(planilha.cnpj || '').replace(/\D/g, '');

      if (cnpjUsuario !== cnpjPlanilha) {
        return res.status(403).json({
          mensagem: 'Você não tem permissão para acessar esta planilha.',
        });
      }
    }

    if (!(await consultorAtendeCnpj(req, planilha.cnpj))) {
      return res.status(403).json({
        mensagem: 'Você não tem permissão para acessar esta planilha.',
      });
    }

    return res.json(planilha);
  } catch (error) {
    console.error('Erro ao obter planilha:', error);
    return res.status(500).json({
      mensagem: 'Erro ao obter planilha.',
    });
  }
}
async function atualizarStatusPlanilha(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const statusPermitidos = [
      'recebido',
      'em_processamento',
      'finalizado',
      'comprovante_anexado',
    ];

    if (!statusPermitidos.includes(status)) {
      return res.status(400).json({
        mensagem: 'Status inválido.',
      });
    }

    if (req.user.role === 'consult') {
      const dono = await pool.query(
        `SELECT cnpj FROM planilhas_coleta WHERE id = $1`,
        [id]
      );

      if (dono.rows.length === 0) {
        return res.status(404).json({ mensagem: 'Planilha não encontrada.' });
      }

      if (!(await consultorAtendeCnpj(req, dono.rows[0].cnpj))) {
        return res.status(403).json({
          mensagem: 'Você não tem permissão para alterar esta planilha.',
        });
      }
    }

    const resultado = await pool.query(
      `
      UPDATE planilhas_coleta
      SET status = $1,
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, status, atualizado_em
      `,
      [status, id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        mensagem: 'Planilha não encontrada.',
      });
    }

    return res.json({
      mensagem: 'Status atualizado com sucesso.',
      planilha: resultado.rows[0],
    });
  } catch (error) {
    console.error('Erro ao atualizar status da planilha:', error);
    return res.status(500).json({
      mensagem: 'Erro ao atualizar status da planilha.',
    });
  }
}
async function buscarPlanilhaPorId(req, res) {
  try {
    const { id } = req.params;

    let query = `
      SELECT
        id,
        usuario_id,
        cnpj,
        cliente_nome,
        competencia,
        nome_arquivo,
        tipo_arquivo,
        total_original,
        total_final,
        duplicidades,
        status,
        dados_json,
        criado_em
      FROM planilhas_coleta
      WHERE id = $1
    `;

    const params = [id];

    if (req.user.role === 'client') {
      query += ` AND cnpj = $2`;
      params.push(req.user.cnpj);
    }

    query += ` LIMIT 1`;

    const resultado = await pool.query(query, params);

    if (resultado.rowCount === 0) {
      return res.status(404).json({
        mensagem: 'Planilha não encontrada ou sem permissão para acessar.',
      });
    }

    if (!(await consultorAtendeCnpj(req, resultado.rows[0].cnpj))) {
      return res.status(403).json({
        mensagem: 'Você não tem permissão para acessar esta planilha.',
      });
    }

    return res.json(resultado.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar planilha:', error);

    return res.status(500).json({
      mensagem: 'Erro ao buscar planilha.',
      detalhe: error.message,
    });
  }
}
module.exports = {
  listarPlanilhas,
  criarPlanilha,
  buscarPlanilhaPorId,
  atualizarStatusPlanilha,
  atualizarPlanilha,
  excluirPlanilha,
};