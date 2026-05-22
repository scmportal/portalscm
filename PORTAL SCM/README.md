# SCM Portal Regulatório — Regras Anatel DICI SCM

## Telas
- `index.html`: tela principal
- `adm/index.html`: tela do administrador
- `cliente/index.html`: tela do cliente
- `consultor-scm/index.html`: tela do consultor SCM

## Alterações desta versão
- A tela do cliente importa arquivos `.xlsx`, `.xls` e `.csv`.
- O CSV baixado é gerado em **UTF-8 com BOM**.
- O delimitador de linha do CSV gerado é **CRLF**, conforme orientação do manual do Sistema Coleta de Dados da Anatel.
- O separador de colunas é `;`.
- Linhas com `COD_IBGE` vazio são ignoradas.
- Duplicidades são unificadas somando o campo `ACESSOS`.

## Regra de duplicidade
A linha é considerada duplicada quando todos os campos abaixo são iguais:

`CNPJ;ANO;MES;COD_IBGE;TIPO_CLIENTE;TIPO_ATENDIMENTO;TIPO_MEIO;TIPO_PRODUTO;TIPO_TECNOLOGIA;VELOCIDADE`

O campo `ACESSOS` não entra na chave de duplicidade. Quando houver duplicidade, os acessos são somados.

Exemplo:

```csv
11767820000120;2026;2;2931350;PF;URBANO;fibra;internet;FTTH;250;1
11767820000120;2026;2;2931350;PF;URBANO;fibra;internet;FTTH;250;59
```

Saída:

```csv
11767820000120;2026;2;2931350;PF;URBANO;fibra;internet;FTTH;250;60
```

## Competência
A competência é identificada pelos campos `ANO` e `MES`.

Exemplo:

`11767820000120;2026;2;...`

Significa **fevereiro de 2026**.

## Nova aba
Na tela do cliente, abaixo de **Minha Coleta DICI**, foi adicionada a aba/menu **Planilhas**.

Essa aba lista as planilhas importadas/encaminhadas separadas por competência, mostrando:
- nome do arquivo;
- tipo do arquivo;
- data de importação;
- linhas originais;
- duplicidades somadas;
- linhas finais;
- botão para baixar novamente o CSV sem duplicidade.
