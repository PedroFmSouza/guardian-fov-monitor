import * as XLSX from 'xlsx'

import {
  REQUIRED_COLUMNS,
  OPTIONAL_COLUMNS,
  WorkbookContractError,
  normalizeHeaderName,
  scoreHeader,
  missingOptionalOf,
} from './contract.js'

/**
 * Leitor da planilha `.xlsx`.
 *
 * A aba é detectada por conteúdo do header — o nome muda a cada semana
 * (ex. `events-2026-07-27T07_45_11`) e nunca deve ser hardcoded.
 *
 * O contrato de colunas vive em `contract.js`, compartilhado com o leitor de
 * CSV; estes re-exports existem para não quebrar quem já importava daqui.
 */
export { REQUIRED_COLUMNS, OPTIONAL_COLUMNS, WorkbookContractError }

function readHeader(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: true })
  const first = matrix.find((row) => Array.isArray(row) && row.some((c) => c != null && c !== ''))
  return (first || []).map(normalizeHeaderName)
}

/**
 * Lê os bytes de um `.xlsx` e devolve as linhas cruas da aba de eventos.
 *
 * Importante: lemos com `cellDates: false` de propósito. Datetimes chegam como
 * serial do Excel (número) e são convertidos para UTC explícito em normalize.js.
 * Deixar o SheetJS materializar `Date` introduz o timezone da máquina no meio
 * do caminho — exatamente o que quebra o agrupamento por hora/dia.
 *
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {{sheetName: string, header: string[], rows: object[], missingOptional: string[]}}
 */
export function parseWorkbookBuffer(buf) {
  let wb
  try {
    wb = XLSX.read(buf, { cellDates: false, cellNF: false, cellText: false })
  } catch (err) {
    throw new WorkbookContractError(
      'Arquivo não pôde ser aberto como planilha .xlsx.',
      String((err && err.message) || err),
    )
  }

  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new WorkbookContractError('A planilha não contém nenhuma aba.')
  }

  // O arquivo real costuma trazer abas auxiliares (tabelas dinâmicas, filtros)
  // cujo cabeçalho também contém "event_type". Por isso NÃO paramos na primeira
  // aba que casa: pontuamos todas e ficamos com a melhor candidata.
  const inspected = []
  const candidates = []

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const header = readHeader(sheet)
    const { missing, known } = scoreHeader(header)
    inspected.push({ sheetName, header, missing, known })
    if (missing.length) continue

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
    if (!rows.length) continue
    candidates.push({ sheetName, header, rows, known })
  }

  if (candidates.length) {
    // mais colunas conhecidas primeiro; empate resolve por volume de linhas
    candidates.sort((a, b) => b.known - a.known || b.rows.length - a.rows.length)
    const best = candidates[0]
    return {
      sheetName: best.sheetName,
      header: best.header,
      rows: best.rows,
      missingOptional: missingOptionalOf(best.header),
      otherCandidates: candidates.slice(1).map((c) => c.sheetName),
      ignoredSheets: inspected.filter((s) => s.missing.length).map((s) => s.sheetName),
    }
  }

  const near = inspected.filter((s) => s.header.includes('event_type'))
  if (near.length) {
    throw new WorkbookContractError(
      `Nenhuma aba completa de eventos. "${near[0].sheetName}" tem event_type mas falta: ${near[0].missing.join(', ')}.`,
      `Abas inspecionadas — ${inspected
        .map((s) => `${s.sheetName}: [${s.header.slice(0, 6).join(', ')}]`)
        .join(' · ')}`,
    )
  }

  throw new WorkbookContractError(
    'Nenhuma aba com coluna "event_type" foi encontrada — o arquivo não parece ser um export de eventos do Guardian.',
    inspected.map((s) => `${s.sheetName}: [${s.header.slice(0, 6).join(', ')}]`).join(' · '),
  )
}

/**
 * Versão para `File`/`Blob`. Mantida para quem já ingeria só planilha;
 * a ingestão da aplicação passa por `parseEventFile`, que aceita os dois formatos.
 *
 * @param {File|Blob} file
 */
export async function parseWorkbook(file) {
  let buf
  try {
    buf = await file.arrayBuffer()
  } catch (err) {
    throw new WorkbookContractError('Não foi possível ler o arquivo.', String(err && err.message))
  }
  return parseWorkbookBuffer(buf)
}
