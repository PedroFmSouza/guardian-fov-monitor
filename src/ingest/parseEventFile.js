/**
 * Porta de entrada única da ingestão.
 *
 * Escolhe o leitor pelo **conteúdo**, não pela extensão: `.xlsx` é um zip e
 * começa com `PK`, `.xls` começa com o header de OLE2; qualquer outra coisa é
 * tratada como texto delimitado. Extensão errada (o portal já entregou `.csv`
 * com nome `.xls`) não muda o resultado, e o `accept` do input continua sendo
 * só uma dica para o seletor de arquivos do sistema.
 *
 * Todos os leitores devolvem a MESMA forma — `{ sheetName, header, rows,
 * missingOptional }` — para que `normalizeRows` e o resto do pipeline não
 * saibam de onde os dados vieram.
 */

import { WorkbookContractError } from './contract.js'
import { parseWorkbookBuffer } from './parseWorkbook.js'
import { parseDelimitedBuffer } from './parseDelimited.js'

export { WorkbookContractError }

/** `PK\x03\x04` (zip/xlsx) e `\xD0\xCF\x11\xE0` (OLE2/xls legado). */
function looksBinary(bytes) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return true
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return true
  return false
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{sheetName: string, header: string[], rows: object[],
 *                    missingOptional: string[], format: 'xlsx'|'csv'}>}
 */
export async function parseEventFile(file) {
  let buf
  try {
    buf = await file.arrayBuffer()
  } catch (err) {
    throw new WorkbookContractError('Não foi possível ler o arquivo.', String(err && err.message))
  }

  const bytes = new Uint8Array(buf)
  if (!bytes.length) {
    throw new WorkbookContractError(`${file.name || 'O arquivo'} está vazio.`)
  }

  if (looksBinary(bytes)) {
    return { ...parseWorkbookBuffer(buf), format: 'xlsx' }
  }
  return {
    ...parseDelimitedBuffer(buf, { sourceName: file.name }),
    format: 'csv',
  }
}
