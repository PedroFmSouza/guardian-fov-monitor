import { useMemo, useRef } from 'react'

import { renderWatchlistChart } from '../../charts/watchlistChart.js'
import { resetZoom } from '../../charts/base.js'
import { buildVehicleDetail } from '../../aggregate/vehicleDetail.js'
import {
  OBS_STATUS,
  OBSERVATION_DAYS,
  chartWindow,
  daysOutsideWindow,
  dayCountFor,
  dayShiftsFor,
  missingDayRuns,
  missingDayCount,
  unsplitDayRuns,
  unsplitDayCount,
  causelessDayRuns,
  causelessDayCount,
} from '../../aggregate/byDailyVehicle.js'
import { useChart, useNativeListener } from '../hooks.js'
import { Detail } from './Detail.jsx'
import { STATUS_LABEL, canvasIdFor, fmtInt } from './shared.js'

/** Veredito em uma frase, no vocabulário do status. */
function Verdict({ res }) {
  if (res.status === OBS_STATUS.RECURRED) {
    return (
      <>
        Voltou a ocorrer em <b className="mono">{res.firstRecurrence}</b> ·{' '}
        <b className="mono">{res.recurrenceDays.length}</b> dia(s) acima do limiar de{' '}
        <b className="mono">{res.threshold.toFixed(1)}</b>/dia
      </>
    )
  }
  if (res.status === OBS_STATUS.CLEARED) {
    return (
      <>
        <b className="mono">{res.daysObserved}</b> dias sem reincidência — pode sair da observação
      </>
    )
  }
  if (res.status === OBS_STATUS.MONITORING) {
    return res.postDays ? (
      <>
        Sem reincidência há <b className="mono">{res.cleanStreak}</b> dia(s) · faltam{' '}
        <b className="mono">{res.daysRemaining}</b> de {OBSERVATION_DAYS}
      </>
    ) : (
      <>Manutenção registrada — aguardando o primeiro export posterior à data</>
    )
  }
  if (res.status === OBS_STATUS.NO_DATA) {
    return <>Sem série diária para este equipamento. Carregue um export que cubra o período.</>
  }
  return <>Defina a data da manutenção para iniciar a observação.</>
}

/** Série diária por turno, com as faixas de vão desenhadas por cima. */
function DailySeries({ vehicle, byDay, days, res, maintenanceDate, cause, isOpen }) {
  const id = canvasIdFor(vehicle)

  const values = useMemo(
    () => ({
      // dias fora da série viram null (buraco na linha), não zero — e o mesmo
      // vale para dia que não sabe responder pela causa isolada
      shift1: days.map((d) => (d in byDay ? dayShiftsFor(byDay[d], cause)[0] : null)),
      shift2: days.map((d) => (d in byDay ? dayShiftsFor(byDay[d], cause)[1] : null)),
    }),
    [days, byDay, cause],
  )

  useChart(
    id,
    () =>
      renderWatchlistChart(id, days, values, {
        maintenanceDate,
        status: res.status,
        // Sem data de manutenção não há baseline, e `evaluateObservation`
        // devolve o piso (RECURRENCE_FLOOR) só como valor de partida. Passá-lo
        // adiante desenhava uma linha LIMIAR sobre a série sem que critério
        // nenhum estivesse sendo aplicado.
        threshold: maintenanceDate ? res.threshold : null,
        recurrenceDays: res.recurrenceDays,
        // os mesmos buracos, marcados na área do gráfico — separados por motivo
        gaps: missingDayRuns(days, byDay),
        // com causa isolada, dia sem a quebra por causa é hachurado junto: a
        // linha some ali, e sem faixa o vão pareceria "zero exceções"
        unsplit: cause
          ? [...unsplitDayRuns(days, byDay), ...causelessDayRuns(days, byDay)]
          : unsplitDayRuns(days, byDay),
        // Zoom só no card aberto: fechado, a roda do mouse precisa continuar
        // rolando a página em vez de ampliar uma miniatura de 132px.
        zoom: isOpen,
      }),
    `${days.join()}|${values.shift1.join()}|${values.shift2.join()}|${res.status}|${maintenanceDate || ''}|${res.threshold}|${cause || ''}|${isOpen}`,
  )

  return (
    <div className={`chartbox chartbox--mini${isOpen ? ' chartbox--zoom' : ''}`}>
      <canvas
        id={id}
        role="img"
        aria-label={`Série diária de exceções do equipamento ${vehicle}, por turno`}
      />
    </div>
  )
}

export function Card({ entry, res, byDay, rows, range, cause, isOpen, onToggle, onRemove, onPatch }) {
  const { vehicle, maintenanceDate, note } = entry
  const dateRef = useRef(null)
  const noteRef = useRef(null)

  // total da causa exibida; dias que não sabem responder não somam nada
  const total = useMemo(
    () =>
      Object.values(byDay).reduce((a, v) => a + (dayCountFor(v, cause) || 0), 0),
    [byDay, cause],
  )
  // o gráfico desenha só o período exibido; o veredito segue vindo da série toda
  const days = useMemo(
    () => chartWindow(byDay, maintenanceDate, range),
    [byDay, maintenanceDate, range],
  )
  const gapDays = missingDayCount(days, byDay)
  const unsplitDays = unsplitDayCount(days, byDay)
  const outsideDays = daysOutsideWindow(byDay, days)
  // só conta quando há causa isolada: sem filtro, a falta da quebra por causa
  // não muda absolutamente nada do que o card mostra
  const causelessDays = cause ? causelessDayCount(days, byDay) : 0
  const hasSeries = Object.keys(byDay).length > 0

  // O detalhe varre as linhas do export inteiro; só vale a pena para o card
  // aberto — calcular para todos a cada render seria desperdício.
  const detail = useMemo(
    () => (isOpen ? buildVehicleDetail(rows || [], vehicle, maintenanceDate, byDay) : null),
    [isOpen, rows, vehicle, maintenanceDate, byDay],
  )

  // `change` nativo, não `onChange` do React: comita quando o valor é
  // confirmado, e não a cada tecla — ver `useNativeListener`
  const attachDate = useNativeListener(dateRef, 'change', () =>
    onPatch(vehicle, { maintenanceDate: dateRef.current.value || null }),
  )
  const attachNote = useNativeListener(noteRef, 'change', () =>
    onPatch(vehicle, { note: noteRef.current.value.trim() }),
  )

  const delta =
    res.delta === null || !Number.isFinite(res.delta)
      ? '—'
      : `${res.delta > 0 ? '+' : ''}${(res.delta * 100).toFixed(1)}%`
  const progress = Math.min(100, Math.round((res.daysObserved / OBSERVATION_DAYS) * 100))

  return (
    <article className={`wl-card wl-card--${res.status}${isOpen ? ' wl-card--open' : ''}`}>
      <div className="wl-card__head">
        <span className="wl-card__id">{vehicle}</span>
        <span className={`badge badge--${res.status}`}>
          {STATUS_LABEL[res.status]}
          <span className="badge__delta">{delta}</span>
        </span>
      </div>

      <div className="wl-card__ctrl">
        <label className="wl-card__date">
          <span className="field__k">Manutenção</span>
          <input
            className="field__input field__input--sm mono"
            type="date"
            defaultValue={maintenanceDate || ''}
            data-date={vehicle}
            ref={attachDate}
          />
        </label>
        <input
          className="field__input field__input--sm wl-card__note"
          type="text"
          maxLength={90}
          defaultValue={note || ''}
          placeholder="observação da manutenção"
          data-note={vehicle}
          ref={attachNote}
        />
        <button
          className="btn btn--sm"
          type="button"
          data-detail={vehicle}
          aria-expanded={isOpen}
          title="Hora, causa raiz e duração deste equipamento"
          onClick={() => onToggle(vehicle)}
        >
          {isOpen ? 'Ocultar detalhe' : 'Detalhar'}
        </button>
        <button
          className="btn btn--ghost btn--danger btn--sm"
          type="button"
          data-remove={vehicle}
          title="Encerrar a observação (o histórico diário é preservado)"
          onClick={() => onRemove(vehicle)}
        >
          Encerrar
        </button>
      </div>

      <div
        className="wl-progress"
        title={`${res.daysObserved} de ${OBSERVATION_DAYS} dias de observação`}
      >
        <span className="wl-progress__fill" style={{ width: `${progress}%` }}></span>
      </div>

      <p className="wl-card__verdict">
        <Verdict res={res} />
      </p>

      <div className="wl-card__stats">
        <span>
          pré <b>{res.preMean.toFixed(2)}</b>/dia <span className="mono">({res.preDays}d)</span>
        </span>
        <span>
          pós <b>{res.postMean.toFixed(2)}</b>/dia <span className="mono">({res.postDays}d)</span>
        </span>
        <span>
          total <b>{fmtInt(total)}</b>
        </span>
        {/* As médias contam só os dias COM dado. Sem dizer quantos faltam,
            "pós 17.14/dia (7d)" parece cobrir os 12 dias de calendário desde a
            manutenção — e o vão na linha parece bug de renderização. */}
        {gapDays ? (
          <span
            className="wl-card__gap"
            title="Dias da janela que nenhum arquivo carregado cobre. Não entram nas médias e aparecem hachurados no gráfico."
          >
            sem dado <b>{gapDays}</b> dia(s)
          </span>
        ) : null}
        {/* Dia gravado antes da quebra por turno: o total é real e conta em
            tudo, só as duas linhas é que não têm o que plotar. */}
        {unsplitDays ? (
          <span
            className="wl-card__gap"
            title="Dias gravados antes da divisão por turno: o total conta nas médias e nos vereditos, mas não há como separar 1º e 2º turno. Recarregue um export que cubra esses dias para recuperar a divisão."
          >
            sem turno <b>{unsplitDays}</b> dia(s)
          </span>
        ) : null}
        {/* O gráfico mostra só o período exibido, mas o veredito conta a série
            inteira. Sem dizer quantos dias ficaram de fora, o card afirma
            "reincidente" sobre um gráfico onde a evidência não aparece. */}
        {outsideDays ? (
          <span
            className="wl-card__gap"
            title="Dias da série acumulada fora do período exibido: não são desenhados, mas continuam contando nas médias e no veredito de reincidência. Use o filtro de período, ou carregue os exports daqueles dias, para vê-los."
          >
            fora do período <b>{outsideDays}</b> dia(s)
          </span>
        ) : null}
        {/* Dia gravado antes da quebra por causa: o total dele é real, mas não
            há como atribuí-lo a uma causa. Com filtro de causa ativo ele fica
            fora de tudo — dizer isso é o que separa "não ocorreu" de "não sei". */}
        {causelessDays ? (
          <span
            className="wl-card__gap"
            title="Dias gravados antes de a série passar a guardar a causa raiz. Enquanto há uma causa isolada eles não entram nas médias nem no veredito, e aparecem hachurados no gráfico. Recarregue os exports desses dias para preencher."
          >
            sem causa <b>{causelessDays}</b> dia(s)
          </span>
        ) : null}
      </div>

      {hasSeries && days.length ? (
        <>
          <DailySeries
            vehicle={vehicle}
            byDay={byDay}
            days={days}
            res={res}
            maintenanceDate={maintenanceDate}
            cause={cause}
            isOpen={isOpen}
          />
          {isOpen ? (
            <p className="wl-zoomhint">
              Roda do mouse amplia · arraste para deslocar ·{' '}
              {gapDays
                ? `${days.length} dias na janela, ${days.length - gapDays} com dado`
                : `${days.length} dias na série`}
              {unsplitDays ? ` · ${unsplitDays} sem divisão por turno` : ''}
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                data-zoomreset={vehicle}
                onClick={() => resetZoom(canvasIdFor(vehicle))}
              >
                Ver tudo
              </button>
            </p>
          ) : null}
        </>
      ) : hasSeries ? (
        // tem série, mas nenhum dia dela cai no período exibido — dizer isso é
        // o que impede a leitura de "este equipamento não tem histórico"
        <div className="empty">
          A série deste equipamento ({outsideDays} dia(s)) está inteira fora do período exibido.
          Amplie o filtro de período para vê-la; o veredito acima já a considera.
        </div>
      ) : (
        <div className="empty">Sem série diária registrada para este equipamento.</div>
      )}

      {isOpen && detail ? (
        <Detail vehicle={vehicle} detail={detail} res={res} maintenanceDate={maintenanceDate} />
      ) : null}
    </article>
  )
}
