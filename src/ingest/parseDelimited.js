/**
 * Leitor de export delimitado (`.csv`) — o formato novo do portal.
 *
 * Por que um parser próprio em vez de jogar o CSV no SheetJS: o SheetJS tenta
 * adivinhar tipos ao ler texto e converte `2026-08-10 23:58:03` para serial de
 * Excel **usando o fuso da máquina**. Isso desloca hora e dia do evento — o
 * erro exato que `normalize.js` existe para evitar. Aqui todo campo sai como
 * string crua e quem decide o tipo é o `normalize.js`, sempre ancorando em UTC.
 *
 * Tolerâncias que o arquivo real exige:
 *  · BOM (UTF-8 e UTF-16) — Excel grava;
 *  · UTF-8 com fallback para windows-1252, senão "Exceção" vira "Exce��o";
 *  · delimitador `,` ou `;` (Excel pt-BR salva com ponto e vírgula), tab e pipe;
 *  · campos entre aspas com vírgula, aspas escapadas (`""`) e quebra de linha;
 *  · CRLF e linhas em branco no meio e no fim do arquivo.
 */

import {
  WorkbookContractError,
  normalizeHeaderName,
  scoreHeader,
  missingOptionalOf,
} from './contract.js'

const DELIMITERS = [',', ';', '\t', '|']

/**
 * Decodifica os bytes do arquivo em texto.
 *
 * UTF-8 é validado com `fatal: true` de propósito: sem isso, um arquivo
 * latin-1 decodifica "com sucesso" cuspindo U+FFFD e os acentos se perdem
 * silenciosamente — e `Exceção FOV` deixa de casar com o tipo de evento.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {{text: string, encoding: string}}
 */
export function decodeText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

/** Primeira linha lógica do arquivo, respeitando aspas (que podem conter \n). */
function firstLine(text) {
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === '\n' || c === '\r')) return text.slice(0, i)
  }
  return text
}

/**
 * Delimitador do arquivo, decidido pelo cabeçalho.
 *
 * O cabeçalho é a linha mais confiável: não tem número decimal (`43,2` em
 * pt-BR) nem texto livre com vírgula para confundir a contagem.
 *
 * @param {string} text
 * @returns {string}
 */
export function detectDelimiter(text) {
  const head = firstLine(text)
  let best = ','
  let bestCount = 0
  for (const d of DELIMITERS) {
    let count = 0
    let quoted = false
    for (let i = 0; i < head.length; i++) {
      const c = head[i]
      if (c === '"') quoted = !quoted
      else if (!quoted && c === d) count++
    }
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

/**
 * Parser RFC 4180 (com as folgas descritas no topo do arquivo).
 * @param {string} text
 * @param {string} delimiter
 * @returns {string[][]} matriz de células, linhas em branco já removidas
 */
export function parseDelimitedRows(text, delimiter) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let dirty = false // a linha tem conteúdo? distingue "" de linha vazia

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    if (dirty) rows.push(row)
    row = []
    dirty = false
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
      continue
    }

    // aspas só abrem campo no início dele; no meio são literais
    if (c === '"' && field === '') {
      quoted = true
      dirty = true
      continue
    }
    if (c === delimiter) {
      endField()
      continue
    }
    if (c === '\r') continue // CRLF: o \n seguinte fecha a linha
    if (c === '\n') {
      endRow()
      continue
    }
    field += c
    if (c.trim() !== '') dirty = true
  }

  if (field !== '' || row.length) endRow()
  return rows
}

/**
 * Lê o texto delimitado e devolve linhas-objeto, no mesmo formato que o leitor
 * de planilha entrega — é o que permite `normalizeRows` não saber a origem.
 *
 * @param {string} text
 * @param {{sourceName?: string}} [options]
 * @returns {{sheetName, header, rows, missingOptional, delimiter, ignoredSheets, otherCandidates}}
 */
export function parseDelimitedText(text, { sourceName = '' } = {}) {
  const delimiter = detectDelimiter(text)
  const matrix = parseDelimitedRows(text, delimiter)

  if (!matrix.length) {
    throw new WorkbookContractError(
      `${sourceName || 'O arquivo'} está vazio.`,
      'Nenhuma linha encontrada no CSV.',
    )
  }

  const header = matrix[0].map(normalizeHeaderName)
  const { missing } = scoreHeader(header)
  if (missing.length) {
    throw new WorkbookContractError(
      `O CSV não tem as colunas obrigatórias: ${missing.join(', ')}.`,
      `Cabeçalho lido (delimitador "${delimiter === '\t' ? '\\t' : delimiter}") — [${header
        .slice(0, 8)
        .join(', ')}]`,
    )
  }

  const rows = []
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]
    const obj = {}
    for (let c = 0; c < header.length; c++) {
      const key = header[c]
      if (!key) continue
      const value = cells[c]
      // string vazia vira null, como o `defval: null` do leitor de planilha
      obj[key] = value === undefined || value === '' ? null : value
    }
    rows.push(obj)
  }

  return {
    sheetName: `CSV (${delimiter === '\t' ? 'tab' : delimiter})`,
    header,
    rows,
    missingOptional: missingOptionalOf(header),
    delimiter,
    otherCandidates: [],
    ignoredSheets: [],
  }
}

/**
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {{sourceName?: string}} [options]
 */
export function parseDelimitedBuffer(buffer, options = {}) {
  const { text, encoding } = decodeText(buffer)
  const parsed = parseDelimitedText(text, options)
  return { ...parsed, encoding }
}
