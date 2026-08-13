/**
 * Contrato de colunas do export de eventos — compartilhado por TODAS as fontes.
 *
 * O mesmo relatório é alimentado hoje por dois formatos:
 *  · a planilha `.xlsx` (uma aba por semana, valores em inglês);
 *  · o `.csv` delimitado do portal (valores em pt-BR, colunas extras de GPS,
 *    alertas e totais de viagem).
 *
 * Os **cabeçalhos são os mesmos nos dois** — é só o conteúdo que muda de idioma.
 * Por isso a validação de contrato mora aqui, fora do leitor de cada formato:
 * um formato novo precisa entregar `header` + `rows`, nada mais.
 */

/** Colunas mínimas para a fonte ser considerada um export de eventos válido. */
export const REQUIRED_COLUMNS = ['event_type', 'vehicle', 'detection_time']

/** Colunas lidas pelo pipeline mas não obrigatórias — ausência vira aviso. */
export const OPTIONAL_COLUMNS = [
  'event_id',
  'vehicle_id',
  'driver',
  'utc_offset',
  'detected_event_type',
  'duration_seconds',
  'speed_kph',
  'travel_metres',
  'confirmation',
  'classification',
  'fleet',
  'shift',
  'crew',
  'guardian_unit',
]

/**
 * Colunas que o export `.csv` traz e o pipeline ainda NÃO lê.
 *
 * Não entram em `OPTIONAL_COLUMNS` de propósito: lá dentro, cada uma viraria um
 * aviso de "coluna ausente" em todo `.xlsx` — que legitimamente não as tem.
 * Aqui elas servem só para desempatar qual aba é a de eventos.
 *
 * `fleet`, `shift`, `crew` e `guardian_unit` NÃO estão nesta lista: o `.csv`
 * também os traz, e são lidos normalmente por estarem em `OPTIONAL_COLUMNS`.
 * Atenção ao `fleet` do `.csv` — ele vem com o nome do SITE da operação, não
 * com um grupo de frota como no `.xlsx`. O agrupamento do relatório não depende
 * dele (ver `fleetGroupOf`).
 */
export const EXTRA_COLUMNS = [
  'latitude',
  'longitude',
  'audio_alert',
  'vibration_alert',
  'visual_alert',
  'trip_distance_metres',
  'trip_time_seconds',
  'confirmation_time',
  'timezone',
  'account',
  'service_provider',
  'software_version',
  'tags',
]

const ALL_KNOWN = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS, ...EXTRA_COLUMNS]

/**
 * Erro de contrato da fonte de dados (planilha ou CSV).
 * O nome é histórico — vale para qualquer formato de entrada.
 */
export class WorkbookContractError extends Error {
  constructor(message, detail) {
    super(message)
    this.name = 'WorkbookContractError'
    this.detail = detail || ''
  }
}

/** `Detection Time` / `detection time` / `DETECTION_TIME` → `detection_time`. */
export const normalizeHeaderName = (v) =>
  String(v ?? '')
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')

/**
 * Quanto este cabeçalho parece um export de eventos.
 * @param {string[]} header nomes já normalizados
 * @returns {{missing: string[], known: number}}
 */
export function scoreHeader(header) {
  return {
    missing: REQUIRED_COLUMNS.filter((c) => !header.includes(c)),
    known: ALL_KNOWN.filter((c) => header.includes(c)).length,
  }
}

/** Colunas opcionais que o pipeline lê e esta fonte não trouxe. */
export function missingOptionalOf(header) {
  return OPTIONAL_COLUMNS.filter((c) => !header.includes(c))
}
