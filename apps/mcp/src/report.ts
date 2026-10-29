import { renderLongitudinalChapter } from './report-longitudinal.js';
import { DISCIPLINES, shiftDate, type Discipline } from '@sportos/analytics';
import type { Snapshot } from './contracts.js';
type Volume = Snapshot['disciplines']['run']['lifetime'];
type Evidence = Snapshot['disciplines']['run']['recent'][number];
const names: Record<Discipline, string> = { run: 'Бег', bike: 'Велосипед', swim: 'Плавание' };
const n = (v: number | null, places = 1) =>
  v === null
    ? 'н/д'
    : v.toLocaleString('ru-RU', { maximumFractionDigits: places, useGrouping: false });
const km = (v: number | null) => n(v === null ? null : v / 1000, 3);
const hours = (v: number | null) => n(v === null ? null : v / 3600, 2);
const time = (v: number | null) => {
  if (v === null) return 'н/д';
  const s = Math.round(v);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const pace = (v: number | null) => {
  if (v === null) return 'н/д';
  const s = Math.round(v);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const percent = (current: number | null, previous: number | null) =>
  current === null || previous === null || previous === 0
    ? 'н/д'
    : n((current / previous - 1) * 100, 1) + '%';
const table = (headers: string[], rows: (string | number)[][]) =>
  [
    '| ' + headers.join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
    ...rows.map((r) => '| ' + r.join(' | ') + ' |'),
  ].join('\n');
const ref = (a: Evidence) => `activity:${a.id}`;
const evidenceTable = (rows: Evidence[]) =>
  table(
    [
      'Дата',
      'Источник / условия',
      'км (точно)',
      'Движение',
      'Полное время',
      'Темп /км',
      'ЧСС',
      'Поправка',
      'Метод',
      'Ссылка Sportos',
    ],
    rows.map((a) => [
      a.date,
      `${a.source} / ${a.subtype ?? 'неизвестно'}`,
      km(a.distanceM),
      time(a.movingS),
      time(a.elapsedS),
      pace(a.paceSPerKm),
      n(a.avgHrBpm, 0),
      a.distanceCorrected ? `${km(a.recordedDistanceM)} → ${km(a.distanceM)} км` : 'нет',
      a.method,
      ref(a),
    ]),
  );
const windowTable = (s: Snapshot['disciplines']['run']) =>
  table(
    [
      'Дней',
      'Границы включительно',
      'Сессии',
      'Активные дни',
      'км',
      'Часы движения',
      'Полные часы',
      'Сессий/нед.',
      'Медиана сессии, мин',
      'Взвеш. темп /км',
      'ЧСС известных / всего',
    ],
    s.windows.map((v) => [
      v.days,
      `${v.from} — ${v.to}`,
      v.sessions,
      v.activeDays,
      km(v.distanceM),
      hours(v.movingS),
      hours(v.elapsedS),
      n(v.sessionsPerWeek, 2),
      n(v.medianSessionMovingS === null ? null : v.medianSessionMovingS / 60),
      pace(v.weightedPaceSPerKm),
      `${v.hrKnown}/${v.sessions}`,
    ]),
  );
function performanceTable(bests: Snapshot['runningBests']) {
  return table(
    [
      'Цель, м',
      'Место',
      'Дата',
      'Время',
      'Источник',
      'Класс',
      'Паузы',
      'Альтернатив',
      'Точная ссылка',
    ],
    bests.flatMap((b) =>
      b.rows.map((r) => [
        n(b.targetDistanceM, 1),
        r.rank,
        r.date,
        time(r.durationS),
        r.source,
        r.source === 'excel'
          ? 'импорт достижения; сертификация не установлена'
          : 'расчёт непрерывного участка по сохранённым данным',
        r.pausePolicy,
        r.alternativeCount,
        r.eventId ? `event:${r.eventId}` : r.activityId ? `activity:${r.activityId}` : 'н/д',
      ]),
    ),
  );
}
export function renderReport(s: Snapshot): string {
  const lines: string[] = [];
  const add = (...text: string[]) => lines.push(...text, '');
  const chapter = (number: number, title: string) => {
    add(`## ${number}. ${title}`);
    add(...renderLongitudinalChapter(s, number));
  };
  const find = (sport: Discipline, days: number) =>
    s.disciplines[sport].windows.find((w) => w.days === days);
  const allRefs = new Map<string, Evidence>();
  for (const sport of DISCIPLINES) {
    const d = s.disciplines[sport];
    for (const a of [
      ...d.longest,
      ...d.recent,
      ...d.recentLongest,
      ...d.wholeActivityBenchmarks.flatMap((b) => b.candidates),
    ])
      allRefs.set(a.id, a);
  }
  add(
    `# Профиль спортивной результативности Sportos — ${s.asOfDate}`,
    '**Частный локальный документ. Для ручной передачи агенту IronMan. Не помещать в публичный Git, задачи, PR или журналы CI.**',
    `Срез: **${s.asOfDate}**; полные дни по **${s.completeThrough}** включительно. Часовой пояс: **${s.timezone}**. Создан: ${s.generatedAt}.`,
    `Схема: \`${s.schemaVersion}\`; методика: \`${s.calculationVersion}\`. Машинный источник всех таблиц: \`athlete-snapshot-${s.asOfDate}.json\`.`,
    'Отчёт фиксирует наблюдения и воспроизводимые вычисления. Спортивные гипотезы отмечены отдельно; прогнозы гонок и тренировочные назначения принадлежат IronMan.',
  );
  add(
    '### Содержание',
    ...[
      'Идентичность и обзор',
      'Многодисциплинарный профиль',
      'Историческая глубина',
      'Последние 12 месяцев',
      '52 полные недели',
      'Скользящие окна',
      'Бег',
      'Велосипед',
      'Плавание',
      'Каталог лучших результатов',
      'Объём и регулярность',
      'Интенсивность и физиология',
      'Длительная выносливость',
      'Входы для триатлона',
      'Сильные стороны и ограничения',
      'Текущая и историческая форма',
      'Методика',
      'Прослеживаемость',
      'Как читать JSON',
      'Передача IronMan',
    ].map((t, i) => `${i + 1}. ${t}`),
  );
  chapter(1, 'Идентичность отчёта и обзор');
  add(
    `Включены ${s.coverage.canonicalSessions} канонических сессий трёх дисциплин. Первая сохранённая дата: ${s.coverage.firstDate ?? 'н/д'}; последняя: ${s.coverage.lastDate ?? 'н/д'}. Последнее изменение канонической записи: ${s.coverage.lastCanonicalUpdate ?? 'н/д'}.`,
    `Текущий неполный день исключён: ${s.coverage.incompleteDayExcluded ? 'да' : 'нет'}; исключено сессий этого дня: ${s.coverage.incompleteDaySessions}. Сохранённые дополнительные численные проекции доступны для ${s.coverage.projectedMetricSessions} канонических сессий.`,
    'Основная единица учёта — UUID канонической активности. Связанные Strava и Garmin не являются двумя тренировками. Канонические поправки дистанции уже применены; данные Garmin служат дополнением и не заменяют официальные факты Strava.',
    'Импортированное историческое достижение, вычисленный непрерывный участок и средний темп всей тренировки — три разных вида свидетельств. Название тренировки, заметки, GPS и произвольные поля поставщиков исключены.',
    'Полнота архива неизвестна. Дата последней активности описывает сохранённые данные, а не успешность последней синхронизации. Никакие загрузки, повторные импорты, пересчёты баллов или изменения базы при подготовке не выполняются.',
  );
  chapter(2, 'Исходный многодисциплинарный профиль');
  add(
    table(
      [
        'Дисциплина',
        'Сессии за историю',
        'км',
        'Часы движения',
        'Полные часы',
        'Известна дистанция',
        'Известно движение',
        'Известна ЧСС',
      ],
      DISCIPLINES.map((sport) => {
        const d = s.disciplines[sport].lifetime;
        return [
          names[sport],
          d.sessions,
          km(d.distanceM),
          hours(d.movingS),
          hours(d.elapsedS),
          `${d.distanceKnown}/${d.sessions}`,
          `${d.movingKnown}/${d.sessions}`,
          `${d.hrKnown}/${d.sessions}`,
        ];
      }),
    ),
    'Нулевое число сессий означает отсутствие сохранённых сессий в периоде. «н/д» в сумме дистанции/времени означает отсутствие известных значений, а не нулевой объём. Полные часы включают остановки, движение — только явно сохранённое движущееся время.',
  );
  for (const sport of DISCIPLINES) {
    const d = s.disciplines[sport],
      w = find(sport, 28);
    add(
      `### ${names[sport]}: исходная шкала`,
      `Историческая частота, размазанная по общему архивному диапазону: ${n(d.lifetime.sessionsPerWeek, 2)} сессий/нед. Это не частота в активный сезон. Медианная дистанция известной сессии: ${km(d.lifetime.medianSessionDistanceM)} км; медианное время движения: ${time(d.lifetime.medianSessionMovingS)}.`,
      w
        ? `За последние 28 полных календарных дней: ${w.sessions} сессий, ${km(w.distanceM)} км, ${hours(w.movingS)} ч движения; активных дней ${w.activeDays}.`
        : 'Окно 28 дней не запрошено.',
      `Источник канонических записей: ${
        Object.entries(d.lifetime.sourceCounts)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ') || 'нет записей'
      }. Условия: ${
        Object.entries(d.lifetime.subtypeCounts)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ') || 'н/д'
      }.`,
    );
  }
  chapter(3, 'Историческая глубина: все сохранённые годы');
  add(
    'Каждый год разделён по дисциплинам. Первый и текущий год могут быть неполными. Сравнение годовых километров не контролирует длину сезона, полноту импорта и тип тренировок.',
  );
  add(
    table(
      [
        'Год',
        'Дисциплина',
        'Сессии',
        'км',
        'Движение, ч',
        'Полное, ч',
        'Дней с сессией',
        'Сесс./нед.',
        'Медиана, км',
        'Средний темп /км',
        'Взвеш. темп /км',
        'ЧСС, покрытие',
      ],
      s.annual.flatMap((y) =>
        DISCIPLINES.map((sport) => {
          const v = y.disciplines[sport];
          return [
            y.key.slice(0, 4) + (y.partial ? '*' : ''),
            names[sport],
            v.sessions,
            km(v.distanceM),
            hours(v.movingS),
            hours(v.elapsedS),
            v.activeDays,
            n(v.sessionsPerWeek, 2),
            km(v.medianSessionDistanceM),
            pace(v.meanSessionPaceSPerKm),
            pace(v.weightedPaceSPerKm),
            `${v.hrKnown}/${v.sessions}`,
          ];
        }),
      ),
    ),
  );
  for (let i = 0; i < s.annual.length; i++) {
    const year = s.annual[i],
      previous = s.annual[i - 1];
    add(`### Сезон ${year.key.slice(0, 4)}${year.partial ? ' — неполный календарный охват' : ''}`);
    for (const sport of DISCIPLINES) {
      const v = year.disciplines[sport],
        p = previous?.disciplines[sport];
      add(
        `**${names[sport]}.** ${v.sessions} сессий на ${v.activeDays} днях; ${km(v.distanceM)} км; ${hours(v.movingS)} ч движения и ${hours(v.elapsedS)} ч полного времени. Средняя/медианная дистанция: ${km(v.averageSessionDistanceM)} / ${km(v.medianSessionDistanceM)} км. Изменение известной дистанции относительно предыдущего сохранённого года: ${p ? percent(v.distanceM, p.distanceM) : 'база отсутствует'}.`,
        `Покрытие сезона: дистанция ${v.distanceKnown}/${v.sessions}, движение ${v.movingKnown}/${v.sessions}, полное время ${v.elapsedKnown}/${v.sessions}, ЧСС ${v.hrKnown}/${v.sessions}, набор высоты ${v.elevationKnown}/${v.sessions}. Исторических реконструкций по сводке: ${v.historicalSummarySessions}; исправленных дистанций: ${v.correctedSessions}.`,
      );
    }
  }
  chapter(4, 'Последние 12 календарных месяцев, помесячно');
  add(
    'Таблица включает текущий месяц только до последнего полного дня. Первый день и конец каждого интервала присутствуют в JSON. Сумма часов движения может быть ниже реального тренировочного времени, если движущееся время не было сохранено.',
  );
  add(
    table(
      [
        'Месяц',
        'Дисциплина',
        'Сессии',
        'км',
        'Движение, ч',
        'Полное, ч',
        'Активные дни',
        'Медиана движения',
        'Взвеш. темп /км',
        'Известное движение',
      ],
      s.monthly.flatMap((m) =>
        DISCIPLINES.map((sport) => {
          const v = m.disciplines[sport];
          return [
            m.key.slice(0, 7) + (m.partial ? '*' : ''),
            names[sport],
            v.sessions,
            km(v.distanceM),
            hours(v.movingS),
            hours(v.elapsedS),
            v.activeDays,
            time(v.medianSessionMovingS),
            pace(v.weightedPaceSPerKm),
            `${v.movingKnown}/${v.sessions}`,
          ];
        }),
      ),
    ),
  );
  for (let i = 0; i < s.monthly.length; i++) {
    const m = s.monthly[i],
      prev = s.monthly[i - 1];
    add(
      `### ${m.key.slice(0, 7)}: сравнение дисциплин`,
      table(
        [
          'Дисциплина',
          'км к предыдущему месяцу',
          'Часы движения к предыдущему',
          'Сессий/нед.',
          'Средняя сессия, мин',
          'Средняя ЧСС / известных',
        ],
        DISCIPLINES.map((sport) => {
          const v = m.disciplines[sport],
            p = prev?.disciplines[sport];
          return [
            names[sport],
            p ? percent(v.distanceM, p.distanceM) : 'н/д',
            p ? percent(v.movingS, p.movingS) : 'н/д',
            n(v.sessionsPerWeek, 2),
            n(v.averageSessionMovingS === null ? null : v.averageSessionMovingS / 60),
            `${n(v.meanRecordedHrBpm, 1)} / ${v.hrKnown}`,
          ];
        }),
      ),
      m.partial
        ? 'Интервал неполный: сравнение с полным месяцем отражает и разную длину наблюдения.'
        : 'Сравнение календарных месяцев: число дней может различаться.',
    );
  }
  chapter(5, 'Последние 52 полные недели ISO');
  add(
    `Полные недели: ${s.completeWeeks[0]?.key} — ${s.completeWeeks.at(-1)?.disciplines.run.to}. Понедельник–воскресенье. Текущая незавершённая неделя исключена независимо от календарных 7-дневных окон.`,
    'Пустая неделя обозначает только отсутствие сохранённых сессий; она не доказывает отдых, болезнь, отпуск или прекращение тренировок.',
  );
  add(
    table(
      [
        'Понедельник',
        'Бег: сессии / км / ч',
        'Велосипед: сессии / км / ч',
        'Плавание: сессии / км / ч',
        'Все сессии',
        'Все известные часы движения',
      ],
      s.completeWeeks.map((w) => {
        const v = DISCIPLINES.map((sport) => w.disciplines[sport]);
        return [
          w.key,
          ...v.map((d) => `${d.sessions} / ${km(d.distanceM)} / ${hours(d.movingS)}`),
          v.reduce((a, b) => a + b.sessions, 0),
          hours(
            v.some((d) => d.movingS !== null) ? v.reduce((a, b) => a + (b.movingS ?? 0), 0) : null,
          ),
        ];
      }),
    ),
  );
  for (const sport of DISCIPLINES) {
    const weeks = s.completeWeeks.map((w) => w.disciplines[sport]);
    let current = 0,
      longest = 0;
    for (const w of weeks) {
      current = w.sessions > 0 ? current + 1 : 0;
      longest = Math.max(longest, current);
    }
    const active = weeks.filter((w) => w.sessions > 0);
    add(
      `### ${names[sport]}: регулярность по неделям`,
      `Недель с хотя бы одной сохранённой сессией: ${active.length}/52; без записей: ${52 - active.length}. Наибольшая последовательность недель с записью: ${longest}. Это регулярность записей, а не подтверждённый непрерывный тренировочный блок.`,
      table(
        [
          'Понедельник',
          'Сессии',
          'км',
          'Движение, ч',
          'Полное, ч',
          'Сессий с ЧСС',
          'Средняя сессия движения',
        ],
        s.completeWeeks.map((w) => {
          const v = w.disciplines[sport];
          return [
            w.key,
            v.sessions,
            km(v.distanceM),
            hours(v.movingS),
            hours(v.elapsedS),
            v.hrKnown,
            time(v.averageSessionMovingS),
          ];
        }),
      ),
    );
  }
  chapter(6, 'Скользящие окна 7/28/30/90/180/365 дней');
  add(
    'Все окна заканчиваются одним последним полным днём. Окна вложены друг в друга: их нельзя складывать. 28 дней — четыре календарные недели длительностью 28 дней, но не обязательно четыре завершённые недели ISO. 30 дней — отдельная календарная длина, не синоним месяца.',
  );
  for (const sport of DISCIPLINES) add(`### ${names[sport]}`, windowTable(s.disciplines[sport]));
  add(
    table(
      [
        'Окно',
        'Дисциплина',
        'Средняя известная дистанция, км',
        'Среднее/медиана темпа /км',
        'Сессии с парой дистанция–время',
        'Движение / fallback',
        'Набор высоты, м',
      ],
      DISCIPLINES.flatMap((sport) =>
        s.disciplines[sport].windows.map((v) => [
          v.days,
          names[sport],
          km(v.averageSessionDistanceM),
          `${pace(v.meanSessionPaceSPerKm)} / ${pace(v.medianSessionPaceSPerKm)}`,
          v.pacePairedSessions,
          `${v.paceMovingSessions} / ${v.paceElapsedFallbackSessions}`,
          n(v.elevationM, 0),
        ]),
      ),
    ),
  );
  chapter(7, 'Бег: достижения, современная выборка и условия');
  add(
    '### Исторические достижения и непрерывные участки',
    performanceTable(s.runningBests),
    'Приоритет импортированного результата внутри одной сопоставленной тренировки сохраняется из Sportos Run Lab. Отдельное событие без уверенной связи с активностью не становится второй тренировкой в объёме. Альтернативы означают другие представления того же достижения, а не дополнительные PR.',
  );
  add('### Последние 90 полных дней: сравнимая таблица', performanceTable(s.recentRunningBests));
  add(
    '### Покрытие расчёта усилий',
    table(
      [
        'Цель, м',
        'Результатов',
        'Подходящих пробежек',
        'Измеренных текущих',
        'Только оценки',
        'Не обработано',
        'Устарело/ошибка',
        'Нет rich detail',
        'Импорт связан / не связан',
      ],
      s.runningBests.map((b) => [
        b.targetDistanceM,
        b.total,
        b.coverage.eligibleRuns ?? 0,
        b.coverage.measuredCurrent ?? 0,
        b.coverage.estimatedOnly ?? 0,
        b.coverage.unprocessed ?? 0,
        b.coverage.staleOrFailed ?? 0,
        b.coverage.missingRichDetail ?? 0,
        `${b.coverage.legacyLinked ?? 0} / ${b.coverage.legacyUnmatched ?? 0}`,
      ]),
    ),
  );
  add(
    '### Последние сохранённые пробежки',
    evidenceTable(s.disciplines.run.recent),
    '### Самые длинные пробежки за историю',
    evidenceTable(s.disciplines.run.longest),
    '### Длинные пробежки последних 90 дней',
    evidenceTable(s.disciplines.run.recentLongest),
  );
  const r = s.disciplines.run.lifetime;
  add(
    `Среднее сессионных темпов за историю: ${pace(r.meanSessionPaceSPerKm)}/км; медиана: ${pace(r.medianSessionPaceSPerKm)}/км; взвешенный темп: ${pace(r.weightedPaceSPerKm)}/км. Пары пригодных дистанций и времени: ${r.pacePairedSessions}; с движением ${r.paceMovingSessions}, с полным временем вместо движения ${r.paceElapsedFallbackSessions}.`,
    'Среднее темпов даёт каждой сессии равный вес. Медиана устойчива к отдельным крайним значениям. Взвешенный темп — сумма секунд подходящих сессий, делённая на сумму их километров. Эти статистики описывают смесь тренировок, а не темп соревнования.',
    `Условия бега: ${
      Object.entries(r.subtypeCounts)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ') || 'неизвестно'
    }. Дорожка и стадион выделяются только по каноническому подтипу или актуальной компактной классификации Garmin. Отсутствующая классификация не означает улицу.`,
    'ЧСС и динамика представлены ниже только для существующих проекций. Общий cadence в rpm не преобразуется молча в шаги/мин; running_cadence имеет собственную определённую единицу.',
  );
  chapter(8, 'Велосипед: целые поездки и длительность');
  add(
    windowTable(s.disciplines.bike),
    '### Самые длинные поездки',
    evidenceTable(s.disciplines.bike.longest),
    '### Последние поездки',
    evidenceTable(s.disciplines.bike.recent),
    '### Длинные поездки последних 90 дней',
    evidenceTable(s.disciplines.bike.recentLongest),
  );
  for (const b of s.disciplines.bike.wholeActivityBenchmarks)
    add(
      `### Около ${km(b.targetDistanceM)} км: только целые поездки`,
      `Допуск ±${n(b.toleranceM, 0)} м. Представлено ${b.candidates.length} выбранных сессий; ранг — по полному времени в допуске. Точная дистанция не нормируется к цели.`,
      b.candidates.length
        ? evidenceTable(b.candidates)
        : 'Подходящих сохранённых целых поездок в выбранном допуске нет. Отрезок из более длинной поездки не синтезируется.',
    );
  add(
    'Скорость зависит от покрытия, рельефа, ветра, остановок, группы и оборудования. Сопоставимость установлена лишь частично через подтип. Средняя скорость не доказывает FTP, мощность на пороге или возможность удерживать её на полной дистанции.',
    'Разница полного и движущегося времени отражает тайминг записи и остановки; она не устанавливает причину остановок. Часы с отсутствующим движущимся временем не восстанавливаются из средней скорости.',
  );
  chapter(9, 'Плавание: дистанции, темп и измеримость');
  add(
    windowTable(s.disciplines.swim),
    '### Самые длинные плавательные сессии',
    evidenceTable(s.disciplines.swim.longest),
    '### Последние плавательные сессии',
    evidenceTable(s.disciplines.swim.recent),
  );
  for (const b of s.disciplines.swim.wholeActivityBenchmarks)
    add(
      `### Около ${n(b.targetDistanceM, 0)} м: реально записанные сессии`,
      `Допуск ±${n(b.toleranceM, 1)} м; нет интерполяции времени.`,
      b.candidates.length
        ? table(
            [
              'Дата',
              'Точная дистанция, м',
              'Движение',
              'Полное',
              'Темп/100 м (движ./fallback)',
              'Условия',
              'Исправление',
              'Ссылка',
            ],
            b.candidates.map((a) => [
              a.date,
              n(a.distanceM, 1),
              time(a.movingS),
              time(a.elapsedS),
              pace(a.paceSPer100m),
              a.subtype ?? 'неизвестно',
              a.distanceCorrected ? `${n(a.recordedDistanceM, 0)} → ${n(a.distanceM, 0)} м` : 'нет',
              ref(a),
            ]),
          )
        : 'Нет записанной целой сессии в этом диапазоне. Время 1500 м из среднего темпа 1600 м не выводится.',
    );
  const corrections = [...allRefs.values()].filter(
    (a) => a.discipline === 'swim' && a.distanceCorrected,
  );
  add(
    '### Исправления дистанции и условия',
    corrections.length
      ? evidenceTable(corrections)
      : 'В отобранных значимых примерах исправлений дистанции нет; общий счёт исправлений указан в сводках.',
    `Всего исправленных плавательных сессий в истории: ${s.disciplines.swim.lifetime.correctedSessions}. Подтипы: ${
      Object.entries(s.disciplines.swim.lifetime.subtypeCounts)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ') || 'н/д'
    }.`,
    'Indoor означает сохранённую классификацию бассейна; outdoor не даёт сведений о течении, температуре, гидрокостюме, точности GPS и безопасности. Длина бассейна, гребки, число длин и SWOLF приводятся только при сохранённых единицах и актуальной проекции.',
    'Средний темп сессии с паузами, движущийся темп и темп отдельного бассейнового отрезка различаются. Здесь нет выдуманных интервалов или CSS. Наличие корректировки сохраняет исходную дистанцию рядом с эффективной, но не подтверждает корректность каждого круга.',
  );
  chapter(10, 'Каталог значимых лучших результатов');
  add(
    '### Бег: самые быстрые сохранённые результаты по целям',
    table(
      [
        'Дистанция, м',
        'Дата',
        'Время',
        'Источник',
        'Возраст к полному дню, дней',
        'Класс',
        'Ссылка',
      ],
      s.runningBests.flatMap((b) =>
        b.rows
          .slice(0, 1)
          .map((a) => [
            b.targetDistanceM,
            a.date,
            time(a.durationS),
            a.source,
            Math.round((Date.parse(s.completeThrough) - Date.parse(a.date)) / 86400000),
            a.source === 'excel' ? 'импортированное достижение' : 'расчёт непрерывного участка',
            a.eventId ? `event:${a.eventId}` : `activity:${a.activityId}`,
          ]),
      ),
    ),
  );
  for (const sport of ['bike', 'swim'] as const)
    add(
      `### ${names[sport]}: проверяемые целые сессии`,
      table(
        [
          'Целевая дистанция, м',
          'Дата',
          'Реально, м',
          'Полное время',
          'Движение',
          'Возраст, дней',
          'Метод / сопоставимость',
          'Ссылка',
        ],
        s.disciplines[sport].wholeActivityBenchmarks.flatMap((b) =>
          b.candidates.map((a) => [
            b.targetDistanceM,
            a.date,
            n(a.distanceM, 1),
            time(a.elapsedS),
            time(a.movingS),
            Math.round((Date.parse(s.completeThrough) - Date.parse(a.date)) / 86400000),
            'whole_activity; условия частично известны',
            ref(a),
          ]),
        ),
      ),
    );
  add(
    '«Проверяемый» означает наличие конкретной канонической записи и точных значений, а не подтверждённый официальный спортивный протокол. Ни один результат не маркируется сертифицированным без такого свидетельства.',
  );
  chapter(11, 'Объём и регулярность тренировок');
  add(
    'Здесь нагрузка означает наблюдаемые километры, сессии и часы. Баллы Sportos не используются как TSS, физиологическая нагрузка или уровень формы. Неизвестные минуты не заменяются нулями.',
  );
  for (const sport of DISCIPLINES) {
    const w28 = find(sport, 28),
      w90 = find(sport, 90),
      w365 = find(sport, 365);
    add(
      `### ${names[sport]}: сопоставление частоты и темпа накопления объёма`,
      table(
        ['База', 'км/нед. (по известным)', 'Движение, ч/нед.', 'Сессии/нед.', 'Полнота движения'],
        [w28, w90, w365]
          .filter((w): w is NonNullable<typeof w> => !!w)
          .map((w) => [
            `${w.days} дней`,
            n(w.distanceM === null ? null : (w.distanceM * 7) / w.days, 2),
            n(w.movingS === null ? null : ((w.movingS / 3600) * 7) / w.days, 2),
            n(w.sessionsPerWeek, 2),
            `${w.movingKnown}/${w.sessions}`,
          ]),
      ),
      w28 && w365
        ? `Темп накопления километров последних 28 дней к 365-дневной базе: ${percent(w28.distanceM === null ? null : w28.distanceM / 28, w365.distanceM === null ? null : w365.distanceM / 365)}. Сравнение включает вложенные периоды и не является причинным тестом прогресса.`
        : 'Сравнение не вычислено: нужные окна не запрошены.',
    );
  }
  add(
    'Сумма сессий разных дисциплин — число тренировочных записей, а не число уникальных тренировочных дней. Утро/вечер, двойные дни и переходы не восстанавливаются из одного календарного дня.',
  );
  chapter(12, 'Интенсивность и физиологические свидетельства');
  for (const sport of DISCIPLINES) {
    const d = s.disciplines[sport];
    add(
      `### ${names[sport]}: сохранённые численные проекции`,
      d.metrics.length
        ? table(
            ['Метрика', 'Единица', 'Сессий', 'Среднее', 'Медиана', 'Минимум', 'Максимум', 'Метод'],
            d.metrics.map((m) => [
              m.key,
              m.unit,
              m.sessions,
              n(m.mean, 3),
              n(m.median, 3),
              n(m.min, 3),
              n(m.max, 3),
              'актуальная проекция; среднее по сессиям',
            ]),
          )
        : 'Дополнительных актуальных численных проекций нет.',
      `Каноническая средняя ЧСС доступна в ${d.lifetime.hrKnown}/${d.lifetime.sessions} сессиях; среднее известных средних: ${n(d.lifetime.meanRecordedHrBpm, 1)} bpm. Это не взвешенное по времени среднее и не оценка зон.`,
      '### Темп целых сессий: распределение',
      table(
        ['От, с/км', 'До, с/км (исключая)', 'Сессии'],
        d.paceDistribution.map((b) => [
          b.minSPerKm,
          b.maxSPerKm === null ? 'без верхней границы' : b.maxSPerKm,
          b.sessions,
        ]),
      ),
    );
    for (const m of d.metrics)
      add(
        `#### ${m.key}: последние выбранные доказательства`,
        table(
          ['Активность', 'Поставщик', 'Значение', 'Единица', 'Происхождение', 'Время проекции'],
          m.evidence.map((e) => [
            `activity:${e.activityId}`,
            e.provider,
            n(e.value, 3),
            e.unit,
            `${e.origin} / ${e.sourceKind} / ${e.method}`,
            e.projectedAt,
          ]),
        ),
      );
  }
  add(
    'Когда канонические ЧСС, калории или набор высоты отсутствуют, сохранённая проекция поставщика может быть показана отдельно в таблице metrics. Она не заполняет каноническое поле и не меняет его счётчик полноты.',
    'Из среднего пульса нельзя получить распределение времени по зонам. Поля мощности поставщика могут быть вычисленными, а не измеренными измерителем: origin сохранён для каждого примера. Общий cadence rpm и running_cadence steps/min не взаимозаменяемы.',
    'Garmin Training Effect, SWOLF, Strava Relative Effort и другие индексы описывают показатели поставщика. Они не являются диагнозом, оценкой восстановления или сопоставимой между видами спорта шкалой.',
    'FTP, CSS, лактатный порог, HRmax, зоны, VO2max и текущая готовность здесь не устанавливаются. Отсутствие этих метрик — неизвестность, а не подтверждённая слабость.',
  );
  chapter(13, 'Свидетельства длительной выносливости и повторяемости');
  for (const sport of DISCIPLINES) {
    const d = s.disciplines[sport];
    add(
      `### ${names[sport]}: распределение дистанций`,
      table(
        ['От, км', 'До, км (исключая)', 'Сессии'],
        d.distanceDistribution.map((b) => [
          km(b.minM),
          b.maxM === null ? 'без верхней границы' : km(b.maxM),
          b.sessions,
        ]),
      ),
      '### Недавние длинные сессии',
      evidenceTable(d.recentLongest),
      `Самая длинная выбранная запись за историю: ${d.longest[0] ? `${km(d.longest[0].distanceM)} км, ${d.longest[0].date}, ${ref(d.longest[0])}` : 'не установлена'}. Это граница наблюдаемого опыта, а не гарантия повторения на соревновании.`,
    );
  }
  add(
    'Наличие длинной одиночной сессии поддерживает утверждение «такая сессия записана», но не доказывает устойчивость темпа на серии, переносимость питания или восстановление. Повторяемость следует оценивать совместно с календарём недель и датами выбранных длинных сессий.',
    'Специальные brick-тренировки, переходы T1/T2 и сочетание всех дисциплин в условиях старта не идентифицированы как отдельное измерение. Совпадение календарной даты не используется для автоматического вывода о brick.',
  );
  chapter(14, 'Триатлон: наблюдения и входы для сценариев IronMan');
  add(
    table(
      ['Формат', 'Плавание', 'Велосипед', 'Бег', 'Что требуется дополнительно'],
      [
        [
          'Олимпийский',
          '1500 м',
          '40 км',
          '10 км',
          'условия воды, переходы, темп после велосипеда',
        ],
        ['70.3', '1900 м', '90 км', '21.0975 км', 'питание, длительный велоэтап, бег после него'],
        [
          'Полная дистанция',
          '3800 м',
          '180 км',
          '42.195 км',
          'связность всего дня, открытая вода, питание и длительная устойчивость',
        ],
      ],
    ),
    'Дистанции в таблице — ориентиры форматов для сопоставления с каталогом, а не обещание конкретного маршрута. Реальная дистанция и регламент выбранного старта требуют проверки отдельно. Время финиша из суммы лучших изолированных результатов не вычисляется.',
  );
  for (const sport of DISCIPLINES)
    add(
      `### ${names[sport]}: доступные входы сценариев`,
      table(
        ['Измеримый вход', 'Наблюдение / указатель JSON', 'Ограничение'],
        [
          ['Текущий объём', `disciplines.${sport}.windows`, 'не равно соревновательной готовности'],
          [
            'Длинные сессии',
            `disciplines.${sport}.recentLongest / longest`,
            'изолированные тренировки; смесь условий',
          ],
          [
            'Сравнимый тест',
            sport === 'run' ? 'recentRunningBests' : `disciplines.${sport}.wholeActivityBenchmarks`,
            'точная дистанция, дата и семантика времени обязательны',
          ],
          [
            'Интенсивность',
            `disciplines.${sport}.metrics`,
            'только фактически сохранённые показатели',
          ],
          ['Регулярность', 'completeWeeks', 'пробелы записей не доказывают отдых'],
        ],
      ),
    );
  add(
    '**Правило интерпретации.** IronMan может построить консервативный, базовый и оптимистичный сценарии только с явными допущениями о темпе, переходах, воде, трассе и питании. Настоящий отчёт предоставляет входы и диапазон неопределённости; численного прогноза финиша не содержит.',
    'Наблюдаемый опыт каждой дисциплины отделяется от переноса на триатлон. Открытая вода, групповая езда, посадка, навигация, гидрокостюм и переносимость питания не устанавливаются из канонических средних. Медицинский допуск и способность безопасно пройти полный Ironman по этим данным не определяются.',
  );
  chapter(15, 'Сильные стороны, ограничения и пробелы');
  for (const sport of DISCIPLINES) {
    const d = s.disciplines[sport].lifetime;
    add(
      `### ${names[sport]}`,
      `**Подтверждённая опора:** ${d.sessions} сохранённых сессий; ${km(d.distanceM)} известных километров; ${hours(d.movingS)} известных часов движения. Значимые примеры приведены с UUID.`,
      `**Ограничение измерения:** дистанция неизвестна у ${d.sessions - d.distanceKnown} сессий; движение у ${d.sessions - d.movingKnown}; полное время у ${d.sessions - d.elapsedKnown}; средняя ЧСС у ${d.sessions - d.hrKnown}.`,
      '**Интерпретация с неопределённостью:** объём и регулярность подтверждают опыт только в пределах сохранённой истории. Отсутствующий тест или метрика не считается доказанной слабостью. Результаты разных условий не ранжируются как эквивалентные спортивные достижения.',
    );
  }
  add(
    '### Известные неизвестные',
    ...s.knownUnknowns.map((t) => `- ${translateUnknown(t)}`),
    'Дополнительно не установлены: медицинский статус, восстановление, травмы, субъективное усилие, доступность тренировочного времени, питание на длинной нагрузке, цель конкретного старта и предпочтения спортсмена. Эти вопросы требуют отдельного разговора, а не домысливания из записей.',
  );
  chapter(16, 'Текущая форма относительно исторического максимума');
  add(
    table(
      [
        'Беговая цель, м',
        'Лучшее за историю',
        'Дата',
        'Лучшее за 90 дней',
        'Дата',
        'Разница времени',
        'Оговорка',
      ],
      s.runningBests.map((b) => {
        const a = b.rows[0],
          recent = s.recentRunningBests.find((r) => r.targetDistanceM === b.targetDistanceM)
            ?.rows[0];
        return [
          b.targetDistanceM,
          a ? time(a.durationS) : 'н/д',
          a?.date ?? 'н/д',
          recent ? time(recent.durationS) : 'н/д',
          recent?.date ?? 'н/д',
          a && recent ? percent(recent.durationS, a.durationS) : 'н/д',
          'источники/паузы могут различаться; не прогноз',
        ];
      }),
    ),
    'Отсутствие свежего результата на конкретной дистанции не означает утрату способности; тест мог не проводиться или не иметь сохранённых потоков. Старый PR не используется как прямой темп текущего старта.',
  );
  for (const sport of DISCIPLINES) {
    const d = s.disciplines[sport];
    add(
      `### ${names[sport]}: историческое и недавнее длинное занятие`,
      table(
        ['Период', 'Дата', 'км', 'Движение', 'Полное', 'Ссылка'],
        [
          ['История', d.longest[0]],
          ['Последние 90 дней', d.recentLongest[0]],
        ].map(([label, raw]) => {
          const a = raw as Evidence | undefined;
          return [
            String(label),
            a?.date ?? 'н/д',
            a ? km(a.distanceM) : 'н/д',
            a ? time(a.movingS) : 'н/д',
            a ? time(a.elapsedS) : 'н/д',
            a ? ref(a) : 'н/д',
          ];
        }),
      ),
    );
  }
  chapter(17, 'Методика и расчётные примечания');
  add(
    '### Источники и дедупликация',
    'Канонические активности являются единицей объёма. Проекции Garmin/Strava привязаны к тому же UUID. Дубли источников не суммируются. Импортированные результаты Run Lab сохраняют собственный event UUID и не добавляют сессию к объёму.',
    'Проекции допускаются только при совпадении текущей ссылки источника, версии, parser version и ожидаемого input hash. Частичная проекция может дать отдельную валидную метрику, но не подтверждает наличие всех метрик сессии.',
  );
  add(
    '### Даты и периоды',
    `Календарные даты хранят исходную локальную семантику; часовой пояс ${s.timezone} применяется к дню исполнения и исключению незавершённого дня. Он не переинтерпретирует все исторические временные метки.`,
    `Для окна N дней: from = ${s.completeThrough} − (N−1) дней; to = ${s.completeThrough}; обе границы включены. В таблице недель каждая неделя начинается в понедельник. Годовые и месячные края могут быть неполными.`,
    'Показатель sessionsPerWeek равен sessions × 7 / числу календарных дней периода. Он не ограничен активными днями. Для всей истории используется единый диапазон трёх дисциплин, поэтому ранняя/поздняя специализация влияет на среднее.',
  );
  add(
    '### Время, расстояние, средние',
    'Суммы distanceM, movingS и elapsedS суммируют только известные значения. Полнота каждой суммы показана отдельным счётчиком. При полном отсутствии известных значений сумма null. Сессии с нулём могут иметь известное значение, но не входят в расчёт темпа.',
    'Для темпа нужны положительная дистанция и положительное движущееся время; при отсутствии/нуле движения допустим положительный elapsed fallback, явно посчитанный отдельно. Взвешенный темп = сумма этих секунд / сумма этих километров. Среднее и медиана темпа считаются по сессиям. Скорость km/h = 3600 / (s/km); swim s/100m = (s/km)/10.',
    'Каноническое elapsedS соответствует duration_s Sportos. В старых импортированных источниках разделение полного и активного времени может отсутствовать; это ограничение источника, а не подтверждённый таймер остановок.',
    'Средняя ЧСС здесь — среднее имеющихся средних значений сессий; без интеграла времени это не средний пульс всей тренировочной истории. Аналогично среднее дополнительных метрик даёт каждой сессии один вес.',
    'Для whole-activity каталога bike/swim используется допуск ±1% цели (минимум 1 м), ранжирование по полному времени; точная дистанция и moving time не скрываются. Это не интерполяция сегментов. Исторически реконструированные summary_estimated записи исключены из этого рейтинга.',
  );
  add(
    '### Почему показатели могут различаться',
    'Разные паузы, ручная коррекция дистанции, исторический импорт, устаревшая проекция, неполный текущий день, неполный месяц и разная полнота полей объясняют часть различий. Конкретная семантика всегда указывается рядом с результатом. Универсальный выбор «самого быстрого» источника не применяется.',
    '### Технические ограничения',
    ...s.limitations.map((t) => `- ${translateLimitation(t)}`),
  );
  chapter(18, 'Приложение прослеживаемости');
  add(
    '### Выбранные канонические записи',
    'Ссылки вида activity:UUID и event:UUID являются стабильными ссылками Sportos. Для активности пользователь открывает /activity/UUID в своём авторизованном Sportos. Внешние provider ID, owner ID, хеши источников, пути хранилища и сырой JSON сюда не включены.',
  );
  add(
    table(
      [
        'UUID',
        'Дата',
        'Дисциплина',
        'Источник',
        'Дистанция, м',
        'Записано до исправления, м',
        'Движение, с',
        'Полное, с',
        'Класс',
      ],
      [...allRefs.values()]
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        .map((a) => [
          ref(a),
          a.date,
          names[a.discipline],
          a.source,
          n(a.distanceM, 3),
          n(a.recordedDistanceM, 3),
          n(a.movingS, 3),
          n(a.elapsedS, 3),
          a.method,
        ]),
    ),
  );
  add(
    '### Точные границы скользящих окон',
    table(
      [
        'Дисциплина',
        'Дней',
        'От',
        'До',
        'Сессии',
        'Дистанция известна',
        'Движение известно',
        'Полное известно',
      ],
      DISCIPLINES.flatMap((sport) =>
        s.disciplines[sport].windows.map((w) => [
          names[sport],
          w.days,
          w.from,
          w.to,
          w.sessions,
          w.distanceKnown,
          w.movingKnown,
          w.elapsedKnown,
        ]),
      ),
    ),
  );
  add(
    '### События исторических достижений и вычисленные участки',
    performanceTable(s.runningBests),
    'Схема сохраняет source, pausePolicy, alternativeCount и coverage. Альтернативные источники намеренно не превращаются в новые тренировочные сессии. Для подробного просмотра конкретного run effort доступен тот же UUID активности в Sportos.',
  );
  chapter(19, 'Руководство по машинному снимку');
  add(
    `Соседний файл: \`athlete-snapshot-${s.asOfDate}.json\`. Схема \`${s.schemaVersion}\`, методика \`${s.calculationVersion}\`. Относительное расположение пары и SHA-256 каждого файла записаны в локальном \`manifest.json\`. Проверить хеши до чтения пары после повторной генерации.`,
    table(
      ['Поле', 'Смысл', 'Правило потребления'],
      [
        [
          'coverage',
          'диапазон, исключённый день, численность, время изменения',
          'не считать гарантией полного архива или последнего sync',
        ],
        ['disciplines.run/bike/swim.lifetime', 'суммы и полнота истории', 'null не заменять нулём'],
        ['disciplines.*.windows', 'вложенные N-дневные окна', 'не складывать окна'],
        ['annual / monthly / completeWeeks', 'календарные тренды', 'учитывать partial и границы'],
        [
          'runningBests / recentRunningBests',
          'исторический импорт и непрерывные усилия',
          'проверять source и pausePolicy',
        ],
        [
          'wholeActivityBenchmarks',
          'целые сессии около цели',
          'не считать интервалом и не нормировать время',
        ],
        ['metrics', 'актуальные дополнительные проекции', 'origin и единицы обязательны'],
        ['longest / recentLongest / recent', 'отобранные примеры', 'не полный экспорт архива'],
        [
          'knownUnknowns / limitations',
          'границы интерпретации',
          'сохранить при передаче будущему агенту',
        ],
      ],
    ),
    'При сравнении будущих снимков сначала проверить schemaVersion, calculationVersion, timezone и completeThrough. Сравнивать одинаковые окна и семантику moving/elapsed. Если первичные записи исправлены, изменение агрегата не обязательно означает новую тренировку.',
    'Измеренные факты для performance/results.csv IronMan требуют явного ручного решения: не копировать рассчитанный прогноз как результат, не импортировать всю историю автоматически. Полный отчёт остаётся за пределами Git.',
  );
  chapter(20, 'Инструкции передачи IronMan');
  add(
    '### Правила безопасной интерпретации',
    'Передать JSON и этот документ вручную доверенному локальному агенту. Сначала прочитать AGENTS.md и STATUS.md IronMan, затем performance/README.md и forecasts.md. Русский язык Markdown и английские поля схемы сохранены.',
    'Sportos предоставляет наблюдения, арифметику, источники и флаги качества. IronMan отвечает за гипотезы, выбор цели, прогноз, план и решения. Изменение профиля, плана, ограничений или прогнозов требует отдельного явного поручения; эта передача ничего в IronMan не обновляет.',
  );
  add(
    '### Вопросы спортсмену, которых нет в записях',
    '- Какой конкретно старт и дата являются целью, и какие дистанции подтверждены организатором?',
    '- Каковы фактическая доступность тренировок, ограничения по времени, воде, велосипеду и оборудованию?',
    '- Каковы самочувствие, субъективное усилие, опыт питания и ограничения, сообщённые самим спортсменом?',
    '- Какие записи являются соревнованиями/контрольными тестами и есть ли официальный протокол?',
    '- Каковы опыт открытой воды, переходов и длинного сочетания велосипеда с бегом?',
    '- Где неизвестные поля вызваны отсутствием датчика, а где — отсутствием сохранённой детализации?',
  );
  add(
    '### Следующие объективные измерения — предложения, не назначенный план',
    'После согласования цели полезно выбрать воспроизводимые тесты с известной дистанцией, условиями и семантикой времени. Для бега — свежий контрольный результат на нужной дистанции; для велосипеда — длительная ровная сессия с известным оборудованием и измерителем мощности, если он есть; для плавания — реальные непрерывные контрольные дистанции с известной длиной бассейна.',
    'Для будущего CSS нужны реальные отдельные контрольные измерения по выбранной методике, а не пропорция средней скорости одной сессии. Для FTP нужна согласованная тестовая методика и пригодная измеренная мощность. Конкретную интенсивность и расписание этот документ не назначает.',
    '### Готовая стартовая заметка для IronMan',
    `> Получен частный фактический срез Sportos на ${s.asOfDate}; полные дни по ${s.completeThrough}, ${s.timezone}. JSON: athlete-snapshot-${s.asOfDate}.json; методика ${s.calculationVersion}. Использовать канонические UUID и отдельные классы исторического импорта, рассчитанных непрерывных усилий и целых сессий. Не считать старые PR текущей готовностью. Не выводить FTP/CSS, зоны, медицинский статус или время полного Ironman из средних. Сначала уточнить цель и неизвестные условия; прогнозы и планы хранить отдельно от фактических результатов. Никакие файлы IronMan автоматически не изменялись.`,
    '### Контроль согласованности',
    `Отчёт отрисован детерминированно из валидированного JSON (${s.schemaVersion}). Все таблицы с числами получены из его агрегатов или выбранных примеров; нет внешней генерации, скачивания данных или скрытого восстановления интервалов. Хеши пары доступны только в частном manifest.json. Округление в Markdown служит читаемости; JSON сохраняет расчётные числа с точностью методики.`,
  );
  return lines.join('\n') + '\n';
}
function translateUnknown(t: string): string {
  if (t.startsWith('FTP'))
    return 'FTP, CSS, физиологические зоны, порог и VO2max этим снимком не установлены.';
  if (t.startsWith('Race'))
    return 'Сертификация результатов, трасса, погода, драфтинг, безопасность воды и питание не установлены по сводке сессий.';
  if (t.startsWith('No retained'))
    return 'Отрезки не синтезируются из среднего темпа всей тренировки.';
  return 'Несколько дисциплин в один день не доказывают brick-тренировку или практику переходов.';
}
function translateLimitation(t: string): string {
  const index = [
    'Скачивания, синхронизации и пересчёты не выполнялись.',
    'Покрытие относится к сохранённым записям; пропуски не доказывают отдых или полноту архива.',
    'Календарные даты сохраняют исходную локальную семантику; timezone не переносит исторические даты.',
    'Темп использует положительное движение, иначе явный elapsed fallback; суммы времени раздельны.',
    'Допуск целой сессии — 1% цели (не менее метра); точная дистанция и полное время сохранены без интерполяции.',
    'Реконструкции исторических сводок отмечены summary_estimated и исключены из рейтинга целых сессий.',
    'Беговой рейтинг сохраняет авторитет исторического импорта и актуальные рассчитанные непрерывные усилия отдельно от среднего темпа сессии.',
    'Индексы поставщиков являются наблюдениями, а не диагнозом или оценкой готовности.',
  ];
  const starts = [
    'No provider',
    'Coverage',
    'Calendar',
    'Pace uses',
    'Whole-activity',
    'Historical',
    'Running',
    'Provider',
  ];
  return index[starts.findIndex((start) => t.startsWith(start))] ?? t;
}
