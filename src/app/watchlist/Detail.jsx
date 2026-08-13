import { renderWorstDayChart } from '../../charts/worstDayChart.js'
import { renderShiftChart } from '../../charts/shiftChart.js'
import { WORST_DAY_PROFILES } from '../../aggregate/vehicleDetail.js'
import { useChart } from '../hooks.js'
import { dayCanvasIdFor, shiftCanvasIdFor, dm, dow, exc, hh, fmtInt } from './shared.js'

/**
 * Zonas do bloco de piores dias.
 *
 * Com data de manutenção são duas — antes e depois —, cada uma com o seu próprio
 * pódio. O dia da intervenção fica fora das duas, como em todo o resto do card.
 * Sem data não há lados: cai numa zona única.
 *
 * Fonte única para o texto e para os gráficos, para que rótulo e canvas não
 * possam divergir.
 */
export function dayZonesOf(detail) {
  if (!detail.maintenanceDate) {
    return [
      {
        key: 'all',
        label: 'Piores dias do export',
        // situação do dia, para o leitor de tela: sem data não há lado nenhum
        context: 'sem data de manutenção definida',
        side: detail.all,
        profiles: detail.dayProfiles.all,
        empty: 'Sem exceção registrada para este equipamento no export atual.',
      },
    ]
  }
  return [
    {
      key: 'before',
      label: 'Antes da manutenção',
      context: 'antes da manutenção',
      side: detail.before,
      profiles: detail.dayProfiles.before,
      empty: 'Nenhum dia com exceção antes da manutenção dentro do export carregado.',
    },
    {
      key: 'after',
      label: 'Depois da manutenção',
      context: 'depois da manutenção',
      side: detail.after,
      profiles: detail.dayProfiles.after,
      empty: 'Nenhum dia com exceção depois da manutenção dentro do export carregado.',
    },
  ]
}

/** Um dia: cabeçalho rotulado, mini-gráfico por hora e leitura de pico/turno. */
function DayCard({ vehicle, zone, index, profile, yMax }) {
  const id = dayCanvasIdFor(vehicle, zone.key, index)
  const peak =
    profile.peakHour === null
      ? null
      : { at: hh(profile.peakHour), n: profile.hours[profile.peakHour] }

  useChart(
    id,
    () => renderWorstDayChart(id, profile, { yMax }),
    `${profile.day}|${profile.total}|${yMax}`,
  )

  return (
    <figure className="wl-day">
      <figcaption className="wl-day__head">
        <span className="wl-day__date mono">{dm(profile.day)}</span>
        <span className="wl-day__dow">{dow(profile.day)}</span>
        <span className="wl-day__n">
          <b className="mono">{fmtInt(profile.total)}</b>{' '}
          {profile.total === 1 ? 'exceção' : 'exceções'} no dia
        </span>
      </figcaption>
      <div className="chartbox chartbox--day">
        <canvas
          id={id}
          role="img"
          aria-label={
            `Exceções de FOV por hora do equipamento ${vehicle} em ${profile.day}, ${zone.context}: ` +
            `${exc(profile.total)} no dia` +
            (peak ? `, com pico às ${peak.at} somando ${exc(peak.n)}` : '') +
            `. 1º turno ${exc(profile.shift1)}, 2º turno ${exc(profile.shift2)}`
          }
        />
      </div>
      <p className="wl-day__foot">
        {peak ? (
          <>
            pico às <b>{peak.at}</b> — {exc(peak.n)}
          </>
        ) : (
          'sem hora de pico'
        )}
        <br />
        1º turno <b>{fmtInt(profile.shift1)}</b> · 2º turno <b>{fmtInt(profile.shift2)}</b>
      </p>
    </figure>
  )
}

/**
 * Uma zona: título, o agregado do LADO COMPLETO e os piores dias dele.
 *
 * O agregado do cabeçalho não é dos três dias mostrados — é o que permite
 * comparar as duas zonas mesmo quando cobrem quantidades diferentes de dias, e
 * a média/dia é o número honesto para isso.
 */
function DayZone({ vehicle, zone, yMax }) {
  const s = zone.side
  return (
    <section className={`wl-zone wl-zone--${zone.key}`}>
      <h5 className="wl-zone__title">
        <i className="wl-zone__mark" aria-hidden="true"></i>
        {zone.label}
        {s.fov ? (
          <span className="wl-zone__stats">
            <b className="mono">{fmtInt(s.fov)}</b> {s.fov === 1 ? 'exceção' : 'exceções'} em{' '}
            <b className="mono">{fmtInt(s.days)}</b> {s.days === 1 ? 'dia' : 'dias'} · média{' '}
            <b className="mono">{s.perDay.toFixed(1)}</b> por dia
          </span>
        ) : null}
      </h5>
      {zone.profiles.length ? (
        <div className="wl-daygrid">
          {zone.profiles.map((profile, i) => (
            <DayCard
              key={profile.day}
              vehicle={vehicle}
              zone={zone}
              index={i}
              profile={profile}
              yMax={yMax}
            />
          ))}
        </div>
      ) : (
        <p className="wl-detail__none">{zone.empty}</p>
      )}
    </section>
  )
}

/**
 * Legenda do bloco: o que a faixa de fundo significa. Amostras reais das cores
 * usadas no gráfico — ler a legenda e olhar o gráfico tem que ser a mesma
 * leitura. A cor da LINHA é explicada no título de cada zona, junto do dado que
 * ela representa, em vez de numa legenda distante.
 */
function DayLegend() {
  return (
    <div className="wl-daylegend">
      <span className="wl-daylegend__item">
        <i className="wl-daylegend__band" data-shift="1" aria-hidden="true"></i>
        fundo claro = 1º turno (06h–18h)
      </span>
      <span className="wl-daylegend__item">
        <i className="wl-daylegend__band" data-shift="2" aria-hidden="true"></i>
        fundo escuro = 2º turno (18h–06h)
      </span>
    </div>
  )
}

/**
 * Os piores dias do export, um mini-gráfico por dia — onde a falha se concentra
 * DENTRO do dia, que a contagem diária esconde.
 *
 * Todos os gráficos do bloco compartilham o mesmo teto de eixo y, inclusive
 * entre zonas: comparar antes com depois em escalas diferentes seria mentira.
 */
function WorstDayZones({ vehicle, detail }) {
  const zones = dayZonesOf(detail)
  if (!zones.some((z) => z.profiles.length)) {
    return (
      <p className="wl-detail__none">
        Sem exceção deste equipamento no export carregado agora — o perfil por hora vem do arquivo
        atual. A série diária ao lado atravessa uploads.
      </p>
    )
  }

  const yMax = zones.reduce((m, z) => z.profiles.reduce((mm, d) => Math.max(mm, ...d.hours), m), 0)

  return (
    <>
      <DayLegend />
      {zones.map((zone) => (
        <DayZone key={zone.key} vehicle={vehicle} zone={zone} yMax={yMax} />
      ))}
      <p className="wl-detail__meta">
        {zones.length > 1
          ? `Todos os gráficos acima usam a mesma escala vertical — inclusive entre as duas zonas —, então a altura de um pico antes da manutenção pode ser comparada diretamente com a de depois.`
          : `Os gráficos acima usam a mesma escala vertical, então as alturas podem ser comparadas entre si. Informe a data da manutenção para separar os dias em antes e depois.`}
      </p>
    </>
  )
}

const SHIFT_RANGE = { 1: '06–18', 2: '18–06' }

/**
 * A leitura que justifica partir por turno: a falha MIGROU de turno depois da
 * manutenção, em vez de sumir. Só faz sentido com os dois lados disponíveis.
 */
function Migration({ detail }) {
  if (!detail.hasSplit) return null
  const beforeDom = detail.before.shift1 >= detail.before.shift2 ? 1 : 2
  if (beforeDom === detail.worstShift) return <>Já era o turno mais crítico antes da manutenção.</>
  return (
    <>
      <b>
        Migrou do {beforeDom}º para o {detail.worstShift}º turno
      </b>{' '}
      depois da manutenção.
    </>
  )
}

/**
 * Pior turno: decidido pelo pós-manutenção (o total só desempata) e plotado como
 * volume diário empilhado. É o que revela a falha MIGRANDO de turno em vez de
 * sumir — o que a contagem total do dia esconde.
 */
function ShiftBlock({ vehicle, detail, maintenanceDate }) {
  const id = shiftCanvasIdFor(vehicle)
  const hasSeries = detail.shiftSeries.length > 0

  useChart(
    hasSeries ? id : null,
    () =>
      renderShiftChart(id, detail.shiftSeries, {
        maintenanceDate,
        worstShift: detail.worstShift,
      }),
    `${detail.shiftSeries.length}|${maintenanceDate || ''}|${detail.worstShift}`,
  )

  if (!hasSeries) {
    return (
      <p className="wl-detail__none">
        Sem exceções deste equipamento no export atual — o recorte por turno depende do arquivo
        carregado.
      </p>
    )
  }

  const worst = detail.worstShift
  const share = `${(detail.worstShiftShare * 100).toFixed(0)}%`
  const basis = detail.worstShiftBasis === 'pos' ? 'depois da manutenção' : 'no período'

  return (
    <div className="wl-shift">
      <p className="wl-shift__sum">
        Pior turno:{' '}
        <b>
          {worst}º · {SHIFT_RANGE[worst]}
        </b>{' '}
        com <b className="mono">{fmtInt(detail.worstShiftCount)}</b> exceções ({share}) {basis}.{' '}
        <Migration detail={detail} />
        {detail.hasSplit ? (
          <>
            <br />
            1º/2º turno — antes {detail.before.shift1}/{detail.before.shift2} · depois{' '}
            {detail.after.shift1}/{detail.after.shift2}
          </>
        ) : (
          <>
            <br />
            1º/2º turno — {detail.all.shift1}/{detail.all.shift2}
          </>
        )}
      </p>
      <div className="chartbox chartbox--detail">
        <canvas id={id} aria-hidden="true" />
      </div>
    </div>
  )
}

/** Detalhe do equipamento: sempre partido em antes × depois da manutenção. */
export function Detail({ vehicle, detail, res, maintenanceDate }) {
  return (
    <div className="wl-detail">
      <div className="wl-detail__block">
        <h4 className="wl-detail__title">
          Piores dias hora a hora — até {WORST_DAY_PROFILES} por lado da manutenção
        </h4>
        <WorstDayZones vehicle={vehicle} detail={detail} />
      </div>
      <div className="wl-detail__block">
        <h4 className="wl-detail__title">Piores dias · série acumulada</h4>
        {detail.worstDays.length ? (
          <ul className="wl-worst">
            {detail.worstDays.map((d) => (
              <li key={d.day}>
                <span className="mono">{d.day}</span> <b className="mono">{fmtInt(d.count)}</b>{' '}
                <span className="tag">{d.after ? 'pós-manutenção' : 'pré'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wl-detail__none">Sem dias com exceção registrada.</p>
        )}
        <ShiftBlock vehicle={vehicle} detail={detail} maintenanceDate={maintenanceDate} />
        <p className="wl-detail__meta">
          Limiar de reincidência <b className="mono">{res.threshold.toFixed(1)}</b>/dia · baseline{' '}
          <b className="mono">{res.preMean.toFixed(2)}</b>/dia em {res.preDays}d ·{' '}
          {detail.driverCount ? (
            <>
              <b className="mono">{fmtInt(detail.driverCount)}</b> operador(es) distinto(s) no
              export
            </>
          ) : (
            'sem operador identificado no export'
          )}
        </p>
      </div>
    </div>
  )
}
