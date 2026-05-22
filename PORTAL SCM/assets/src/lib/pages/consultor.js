import {
  buscarConsultorLogado,
  listarColetasConsultor,
  sairConsultor
} from '../services/consultorService.js';

async function carregarConsultor() {
  const usuario = await buscarConsultorLogado();

  if (!usuario) return;

  const nomeElemento = document.getElementById('nomeConsultor');
  if (nomeElemento) {
    nomeElemento.textContent = usuario.nome;
  }

  const btnSair = document.getElementById('btnSair');
  if (btnSair) {
    btnSair.addEventListener('click', sairConsultor);
  }

  await carregarColetas();
}

async function carregarColetas() {
  const tabela = document.getElementById('tabelaColetasConsultor');

  if (!tabela) {
    console.warn('Elemento tabelaColetasConsultor não encontrado.');
    return;
  }

  tabela.innerHTML = `
    <tr>
      <td colspan="8">Carregando coletas...</td>
    </tr>
  `;

  try {
    const coletas = await listarColetasConsultor();

    if (!coletas || coletas.length === 0) {
      tabela.innerHTML = `
        <tr>
          <td colspan="8">Nenhuma coleta encontrada.</td>
        </tr>
      `;
      return;
    }

    tabela.innerHTML = coletas.map((coleta) => {
      const competencia = `${String(coleta.competencia_mes).padStart(2, '0')}/${coleta.competencia_ano}`;

      return `
        <tr>
          <td>${coleta.cliente_nome || '-'}</td>
          <td>${coleta.cnpj || '-'}</td>
          <td>${competencia}</td>
          <td>${coleta.nome_arquivo_original || '-'}</td>
          <td>${coleta.total_original ?? 0}</td>
          <td>${coleta.total_final ?? 0}</td>
          <td>${coleta.duplicidades ?? 0}</td>
          <td>${coleta.status || '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    tabela.innerHTML = `
      <tr>
        <td colspan="8">Erro ao carregar coletas.</td>
      </tr>
    `;

    console.error(error);
  }
}

carregarConsultor();