/**
 * Agregações da visão geral — a frota inteira do export carregado, não um
 * equipamento.
 *
 * Respondem quatro perguntas, nesta ordem de utilidade operacional:
 *  · a frota está melhorando ou piorando?  → `fleetDaily`
 *  · quais equipamentos estão piores?      → `aggregateByVehicle` (já existia)
 *  · em que hora do dia acontece?          → `fleetByHour`
 *  · por quê?                              → `fleetByCause`
 *
 * Todas puras: mesma entrada, mesma saída, sem DOM nem storage.
 */

import { isFirstShiftHour } from './byHour.js'
import { dayRange } from './byDailyVehicle.js'
import { KNOWN_CAUSES, OTHER_CAUSE } from '../data/normalize.js'

/**
 * Rótulo em pt-BR das causas canônicas.
 *
 * As chaves são canônicas em inglês porque é assim que `.xlsx` e `.csv` colapsam
 * na mesma contagem (ver `CAUSE_ALIASES`). A tela é em português, então a
 * tradução mora aqui — no limite entre o dado e o que se lê.
 */
export const CAUSE_LABEL = {
  'tracking issue': 'Problema de rastreamento',
  'camera misaligned': 'Câmera desalinhada',
  'sensor covered': 'Sensor coberto',
}

export const causeLabel = (cause) =>
  CAUSE_LABEL[cause] || String(cause).charAt(0).toUpperCase() + String(cause).slice(1)

/**
 * Total de exceções de FOV por dia, com a divisão por turno junto.
 *
 * Diferente da série do painel de observação: aqui é a frota somada e só o
 * export carregado agora — não atravessa uploads, não vai para o localStorage.
 *
 * O eixo é a faixa CONTÍNUA de dias entre o primeiro e o último. Dia coberto
 * pelos arquivos mas sem exceção vale `0`; dia que nenhum arquivo cobre vale
 * `null`. Sem essa distinção, um eixo só com os dias presentes cola 19/07 em
 * 26/07 como se fossem vizinhos e a linha atravessa uma semana inexistente sem
 * deixar rastro — a mesma armadilha que a série do card já trata.
 *
 * @param {object[]} rows linhas normalizadas
 * @returns {{days: string[], total: (number|null)[], shift1: (number|null)[],
 *            shift2: (number|null)[], covered: number, missing: number}}
 */
export function fleetDaily(rows) {
  const byDay = new Map()
  /** dias que ALGUM arquivo cobre — inclusive os sem nenhuma exceção */
  const covered = new Set()

  for (const r of rows || []) {
    if (!r.dayKey) continue
    covered.add(r.dayKey)
    if (!r.isFov) continue
    let acc = byDay.get(r.dayKey)
    if (!acc) {
      acc = { s1: 0, s2: 0 }
      byDay.set(r.dayKey, acc)
    }
    if (isFirstShiftHour(r.hour)) acc.s1++
    else acc.s2++
  }

  const present = [...covered].sort()
  if (!present.length) {
    return { days: [], total: [], shift1: [], shift2: [], covered: 0, missing: 0 }
  }

  const days = dayRange(present[0], present[present.length - 1])
  const pick = (day, get) => {
    if (!covered.has(day)) return null
    const acc = byDay.get(day)
    return acc ? get(acc) : 0
  }

  return {
    days,
    total: days.map((d) => pick(d, (a) => a.s1 + a.s2)),
    shift1: days.map((d) => pick(d, (a) => a.s1)),
    shift2: days.map((d) => pick(d, (a) => a.s2)),
    covered: covered.size,
    missing: days.length - covered.size,
  }
}

/**
 * Exceções de FOV por hora do dia (0–23), frota inteira.
 * Sempre 24 posições: hora sem evento vale 0, não "sem dado" — o export cobre
 * o dia inteiro, então zero aqui é informação, não lacuna.
 *
 * @param {object[]} rows
 * @returns {{hours: number[], peakHour: number|null, total: number}}
 */
export function fleetByHour(rows) {
  const hours = new Array(24).fill(0)
  let total = 0
  for (const r of rows || []) {
    if (!r.isFov) continue
    hours[r.hour]++
    total++
  }

  let peakHour = null
  let peak = 0
  for (let h = 0; h < 24; h++) {
    if (hours[h] > peak) {
      peak = hours[h]
      peakHour = h
    }
  }
  return { hours, peakHour, total }
}

/**
 * Causa raiz das exceções de FOV, frota inteira, em ordem decrescente.
 *
 * As causas conhecidas entram MESMO COM ZERO: "sensor coberto: 0" é uma
 * afirmação útil ("verificamos e não é isso"), enquanto a ausência da barra
 * deixa o leitor sem saber se foi zero ou se a causa nem é rastreada.
 *
 * `only` desliga exatamente isso. Com uma causa isolada no filtro, as demais
 * viriam zeradas — e aí a barra vazia passaria a MENTIR: ela afirma "verificada
 * e não ocorreu", quando o que houve foi o filtro escondê-la. Isolar "câmera
 * desalinhada" num export com 95 sensores cobertos desenhava "sensor coberto:
 * 0" ao lado. Com `only`, o gráfico mostra só a causa pedida.
 *
 * @param {object[]} rows
 * @param {string|null} [only] causa isolada pelo filtro da tela
 * @returns {{cause: string, label: string, count: number, share: number}[]}
 */
export function fleetByCause(rows, only = null) {
  const counts = new Map((only ? [only] : KNOWN_CAUSES).map((c) => [c, 0]))
  let total = 0
  for (const r of rows || []) {
    if (!r.isFov) continue
    const cause = r.cause || OTHER_CAUSE
    counts.set(cause, (counts.get(cause) || 0) + 1)
    total++
  }

  return [...counts.entries()]
    .map(([cause, count]) => ({
      cause,
      label: causeLabel(cause),
      count,
      share: total ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
}
