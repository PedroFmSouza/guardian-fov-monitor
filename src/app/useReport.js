import { useCallback, useMemo, useState } from 'react'

import { parseEventFile, WorkbookContractError } from '../ingest/parseEventFile.js'
import { normalizeRows, datasetMeta } from '../data/normalize.js'
import { aggregateByVehicle } from '../aggregate/byVehicle.js'
import { aggregateDailyByVehicle } from '../aggregate/byDailyVehicle.js'
import { computeKpis, fmtInt } from '../ui/kpis.js'
import { loadHistory, snapshotFrom, recordSnapshot } from '../persistence/history.js'

const IDLE = {
  status: 'idle',
  message: 'Nenhum arquivo carregado. O processamento acontece integralmente neste navegador.',
  detail: '',
}

/**
 * União das linhas de todos os arquivos, deduplicada por `event_id`.
 *
 * O overlap de dias entre exports é comum — a semana 2 costuma repetir o último
 * dia da semana 1 — e não pode contar duas vezes. `duplicates` alimenta o aviso
 * da ingestão; sem ele, o relatório encolhe em relação à soma dos arquivos e
 * ninguém sabe por quê.
 *
 * @param {{rows: object[]}[]} files
 * @returns {{rows: object[], duplicates: number}}
 */
function uniteRows(files) {
  const seen = new Set()
  const rows = []
  let duplicates = 0
  for (const f of files) {
    for (const r of f.rows) {
      if (r.eventId) {
        if (seen.has(r.eventId)) {
          duplicates++
          continue
        }
        seen.add(r.eventId)
      }
      rows.push(r)
    }
  }
  rows.sort((a, b) => a.detectionTime - b.detectionTime)
  return { rows, duplicates }
}

/**
 * Os arquivos que compõem o relatório atual.
 *
 * Eles se ACUMULAM: cada arquivo novo soma ao período já carregado em vez de
 * substituí-lo — é o que permite ler várias semanas (ou várias bases, `.xlsx` e
 * `.csv` misturados) de uma vez. A união é deduplicada por `event_id`, então
 * overlap entre exports não infla nada; re-subir o mesmo arquivo apenas
 * substitui a versão anterior dele, pelo nome.
 *
 * @param {(series: object) => void} onDailySeries recebe a série diária de cada
 *        recálculo, para o painel de observação acumular no localStorage
 */
export function useReport(onDailySeries) {
  const [files, setFiles] = useState([])
  const [ingest, setIngest] = useState(IDLE)
  const [historyCount, setHistoryCount] = useState(() => loadHistory().length)

  /**
   * União deduplicada de todos os arquivos. Derivada, nunca guardada em estado:
   * duas fontes de verdade para a mesma lista é como o relatório e a lista de
   * arquivos passam a divergir.
   */
  const { rows } = useMemo(() => uniteRows(files), [files])

  const meta = useMemo(() => (rows.length ? datasetMeta(rows) : null), [rows])

  /** Período/linhas/FOV por arquivo, para a lista abaixo da dropzone. */
  const fileStats = useMemo(
    () =>
      files.map((f) => {
        const m = datasetMeta(f.rows)
        return {
          name: f.name,
          rows: m.rowCount,
          fov: m.fovCount,
          periodStart: m.periodStart,
          periodEnd: m.periodEnd,
        }
      }),
    [files],
  )

  const summaryOf = useCallback(
    (list, m) =>
      `${list.length} arquivo(s) · ${fmtInt(m.rowCount)} eventos · ${fmtInt(
        m.fovCount,
      )} exceções de FOV · ${m.periodStart} a ${m.periodEnd}`,
    [],
  )

  /**
   * Ponto único de recálculo: adicionar, remover ou limpar arquivos passa aqui.
   *
   * Recalcula a união na hora em vez de esperar o `useMemo`: `setFiles` não é
   * síncrono, e o resumo da ingestão precisa dos números DESTE conjunto de
   * arquivos, não do render anterior.
   *
   * @returns {{meta: object|null, duplicates: number}}
   */
  const apply = useCallback(
    (nextFiles) => {
      setFiles(nextFiles)
      if (!nextFiles.length) return { meta: null, duplicates: 0 }

      const { rows: united, duplicates } = uniteRows(nextFiles)
      const m = datasetMeta(united)
      const kpis = computeKpis(united, aggregateByVehicle(united))
      // numera a revisão exibida nos metadados; a fingerprint impede que o MESMO
      // conjunto de arquivos conte como revisão nova
      const { history } = recordSnapshot(snapshotFrom(m, kpis, new Date().toISOString()))
      setHistoryCount(history.length)

      // série diária para TODOS os equipamentos, não só os observados: é o que
      // faz recolocar um equipamento em observação trazer o histórico de volta
      const { series } = aggregateDailyByVehicle(united)
      onDailySeries(series)
      return { meta: m, duplicates }
    },
    [onDailySeries],
  )

  const handleFiles = useCallback(
    async (fileList) => {
      const incoming = [...fileList]
      setIngest({
        status: 'busy',
        message:
          incoming.length === 1
            ? `Processando ${incoming[0].name}…`
            : `Processando ${incoming.length} arquivos…`,
        detail: '',
      })

      const loaded = new Map(files.map((f) => [f.name, f]))
      const notes = []
      const failures = []

      for (const file of incoming) {
        try {
          const { sheetName, rows: rawRows, missingOptional, format } = await parseEventFile(file)
          const { rows: normalized, dropped, duplicates, reclassified } = normalizeRows(rawRows)

          if (!normalized.length) {
            throw new WorkbookContractError(
              `Nenhuma linha válida em ${file.name}.`,
              `${rawRows.length} linhas lidas, todas descartadas por falta de vehicle / event_type / detection_time.`,
            )
          }

          loaded.set(file.name, {
            name: file.name,
            sheetName,
            format,
            rows: normalized,
          })
          if (duplicates)
            notes.push(`${file.name}: ${duplicates} event_id duplicado(s) ignorado(s)`)
          if (dropped) notes.push(`${file.name}: ${dropped} linha(s) incompleta(s) descartada(s)`)
          // O detector erra o tipo com frequência e a revisão corrige; sem esse
          // aviso, a diferença entre "132 FOV" e "91 FOV" fica invisível.
          if (reclassified) {
            notes.push(
              `${file.name}: ${reclassified} evento(s) reclassificado(s) pela revisão (o event_type do detector divergia)`,
            )
          }
          if (missingOptional.length) {
            notes.push(`${file.name}: colunas opcionais ausentes (${missingOptional.join(', ')})`)
          }
        } catch (err) {
          if (err instanceof WorkbookContractError) {
            failures.push(`${file.name}: ${err.message}`)
          } else {
            failures.push(`${file.name}: falha inesperada — ${String((err && err.message) || err)}`)
            console.error(err)
          }
        }
      }

      if (!loaded.size) {
        setIngest({
          status: 'error',
          message: 'Nenhum arquivo pôde ser lido.',
          detail: failures.join(' · '),
        })
        return
      }

      const next = [...loaded.values()]
      const { meta: m, duplicates: cross } = apply(next)

      if (cross) notes.push(`${cross} evento(s) repetido(s) entre arquivos`)
      if (failures.length) notes.push(`ignorados — ${failures.join(' · ')}`)

      setIngest({
        status: failures.length ? 'error' : 'ok',
        message: summaryOf(next, m),
        detail: notes.join(' · '),
      })
    },
    [files, apply, summaryOf],
  )

  const removeFile = useCallback(
    (name) => {
      const rest = files.filter((f) => f.name !== name)
      const { meta: m } = apply(rest)
      if (!rest.length) {
        setIngest(IDLE)
        return
      }
      setIngest({
        status: 'ok',
        message: summaryOf(rest, m),
        detail: `${name} removido do relatório`,
      })
    },
    [files, apply, summaryOf],
  )

  const clearFiles = useCallback(() => {
    apply([])
    setIngest(IDLE)
  }, [apply])

  return {
    files,
    fileStats,
    rows,
    meta,
    ingest,
    historyCount,
    // ".xlsx" traz o nome da aba, ".csv" traz o delimitador — com mais de um
    // arquivo o campo vira só a contagem de origens
    sourceLabel: files.length === 1 ? files[0].sheetName : `${files.length} origens`,
    handleFiles,
    removeFile,
    clearFiles,
  }
}
