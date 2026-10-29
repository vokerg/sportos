import { DISCIPLINES, type Discipline } from '@sportos/analytics';
import type { Snapshot } from './contracts.js';
const names: Record<Discipline, string> = { run: 'Бег', bike: 'Велосипед', swim: 'Плавание' };
const n = (value: number | null, digits = 2) =>
  value === null
    ? 'н/д'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits, useGrouping: false });
const km = (v: number | null) => n(v === null ? null : v / 1000, 3),
  h = (v: number | null) => n(v === null ? null : v / 3600);
const table = (headers: string[], rows: (string | number)[][]) =>
  [
    '| ' + headers.join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
    ...rows.map((row) => '| ' + row.join(' | ') + ' |'),
  ].join('\n');
const labels: Record<string, string> = {
  lifetime: 'Вся история',
  recent_7: '7 дней',
  recent_28: '28 дней',
  recent_30: '30 дней',
  recent_90: '90 дней',
  recent_180: '180 дней',
  recent_365: '365 дней',
  previous_28: 'Предыдущие 28 дней',
  previous_90: 'Предыдущие 90 дней',
};
export function renderLongitudinalChapter(s: Snapshot, chapter: number): string[] {
  const result: string[] = [];
  const add = (...v: string[]) => result.push(...v, '');
  const p = s.longitudinal.profiles;
  if (chapter === 1) {
    add(
      '### Сохранённая свежесть источника',
      table(
        ['Поставщик', 'Состояние соединения', 'Последний сохранённый sync', 'Последняя попытка'],
        s.coverage.providerConnections.map((v) => [
          v.provider,
          v.status,
          v.lastSyncAt ?? 'неизвестно',
          v.lastAttemptAt ?? 'неизвестно',
        ]),
      ),
      'Это метаданные соединения на момент генерации. Они не удостоверяют полноту архива, обработку всех деталей или состояние базы в историческую дату asOf. Отсутствующая дата синхронизации остаётся неизвестной.',
    );

    add('### Фактические изменения и масштаб недавней практики');
    for (const sport of DISCIPLINES) {
      const d = p[sport],
        current = d.periods.find((v) => v.key === 'recent_28')!,
        previous = d.periods.find((v) => v.key === 'previous_28')!,
        change = d.adjacentComparisons.find((v) => v.days === 28)!;
      add(
        `**${names[sport]}.** За ${current.volume.from} — ${current.volume.to}: ${current.volume.sessions} записанных сессий, ${km(current.volume.distanceM)} км, ${h(current.volume.movingS)} ч движения. За отдельные предыдущие 28 дней: ${previous.volume.sessions} сессий, ${km(previous.volume.distanceM)} км и ${h(previous.volume.movingS)} ч. Изменение известной дистанции: ${n(change.distanceChangePercent)}%; движения: ${n(change.movingChangePercent)}%.`,
        `Недавний 28-дневный объём составляет ${n(d.recent28DistanceAsPercentOfPeak)}% максимального сохранённого 28-дневного объёма. Последняя запись дисциплины: ${d.lastDate ?? 'нет'}; до границы среза ${n(d.daysSinceLast, 0)} дней. Это свежесть записи, а не установленная пауза в тренировках. Основание: ${current.evidenceId}; покрытие движения ${current.volume.movingKnown}/${current.volume.sessions}.`,
      );
    }
    add(
      'Изменения рассчитаны между неперекрывающимися окнами одинаковой длительности. Проценты по неполным полям описывают известную часть записей. Пик истории служит масштабом наблюдаемого объёма и не является физиологической нормой.',
    );
  }
  if (chapter === 3) {
    add('### Размер типичной сессии, верхний квартиль и сезонные длинные занятия');
    for (const sport of DISCIPLINES)
      add(
        `#### ${names[sport]}`,
        table(
          [
            'Год',
            'Покрытие',
            'Медиана / P75 / P90 дистанции, км',
            'Медиана / P90 движения, мин',
            'Максимальная сессия, км',
            'Дата',
            'Точная ссылка',
          ],
          p[sport].seasons.map((y) => {
            const longest = y.longest[0];
            return [
              y.year,
              y.partial ? 'неполный период' : 'календарный год',
              `${km(y.sessionDistance.median)} / ${km(y.sessionDistance.p75)} / ${km(y.sessionDistance.p90)}`,
              `${n(y.sessionMoving.median === null ? null : y.sessionMoving.median / 60)} / ${n(y.sessionMoving.p90 === null ? null : y.sessionMoving.p90 / 60)}`,
              longest ? km(longest.distanceM) : 'н/д',
              longest?.date ?? 'н/д',
              longest ? `activity:${longest.activityId}` : 'н/д',
            ];
          }),
        ),
        table(
          ['Год', 'Условия', 'Сессии', 'Медиана темпа целой сессии, с/км', 'P10 / P90, с/км'],
          p[sport].seasons.flatMap((y) =>
            y.conditions.map((c) => [
              y.year,
              c.condition,
              c.sessions,
              n(c.pace.median),
              `${n(c.pace.p10)} / ${n(c.pace.p90)}`,
            ]),
          ),
        ),
      );
    add(
      'Эти сезонные темпы описывают смесь тренировок внутри одного сохранённого подтипа. Изменение медианы при изменившихся дистанциях и программах не является самостоятельным тестом спортивного прогресса. P10/P90 — квантили наблюдений, не тренировочные зоны.',
    );
  }
  if (chapter === 6) {
    add(
      '### Соседние периоды: изменение без вложенности',
      table(
        [
          'Дисциплина',
          'Дней',
          'Текущий диапазон',
          'Предыдущий диапазон',
          'Δ сессий',
          'Δ км, %',
          'Δ движения, %',
          'Дистанция известна: сейчас / раньше',
        ],
        DISCIPLINES.flatMap((sport) =>
          p[sport].adjacentComparisons.map((c) => [
            names[sport],
            c.days,
            `${c.recentFrom} — ${c.recentTo}`,
            `${c.previousFrom} — ${c.previousTo}`,
            c.sessionChange,
            n(c.distanceChangePercent),
            n(c.movingChangePercent),
            `${c.recentDistanceKnown} / ${c.previousDistanceKnown}`,
          ]),
        ),
      ),
    );
  }
  if ([7, 8, 9].includes(chapter)) {
    const sport = DISCIPLINES[chapter - 7],
      d = p[sport];
    add(
      '### Характер сессий в каждом периоде',
      table(
        [
          'Период',
          'Даты',
          'Сессии',
          'Медиана / P90 дистанции, км',
          'Медиана / P90 движения, мин',
          'Медиана / P10 / P90 скорости или темпа',
          'Единица',
          'Известных пар',
        ],
        d.periods.map((v) => [
          labels[v.key],
          `${v.volume.from} — ${v.volume.to}`,
          v.volume.sessions,
          `${km(v.sessionDistance.median)} / ${km(v.sessionDistance.p90)}`,
          `${n(v.sessionMoving.median === null ? null : v.sessionMoving.median / 60)} / ${n(v.sessionMoving.p90 === null ? null : v.sessionMoving.p90 / 60)}`,
          `${n(v.sessionRate.median)} / ${n(v.sessionRate.p10)} / ${n(v.sessionRate.p90)}`,
          v.rateUnit,
          v.sessionRate.known,
        ]),
      ),
    );
    const recent = d.periods.find((v) => v.key === 'recent_90')!;
    add(
      '### Распределения последних 90 дней',
      table(
        ['Показатель', 'Единица', 'От (включая)', 'До (исключая)', 'Сессии'],
        Object.entries(recent.distributions).flatMap(([key, v]) =>
          v.bins.map((b) => [
            key,
            v.unit,
            n(b.min),
            b.max === null ? 'без верхней границы' : n(b.max),
            b.sessions,
          ]),
        ),
      ),
      `Пропуски распределений: дистанция ${recent.distributions.distance.missing}, движение ${recent.distributions.duration.missing}, темп/скорость ${recent.distributions.rate.missing}. Границы дистанции и темпа выбраны отдельно для ${names[sport].toLowerCase()}; неизвестные значения не включены в самый медленный/короткий диапазон.`,
    );
    if (sport !== 'run') {
      add(
        '### Сопоставимые целые сессии по сохранённым условиям',
        table(
          [
            'Цель, м',
            'Условия',
            'Всего в допуске',
            'Лучшее историческое: дата / с',
            'Лучшее 90 дней: дата / с',
            'Лучшее 365 дней: дата / с',
            'Δ времени 90 дней к истории, %',
            'Свежая ссылка',
          ],
          d.benchmarks.map((b) => [
            b.targetDistanceM,
            b.condition,
            b.allTime.sessions,
            b.allTime.best ? `${b.allTime.best.date} / ${n(b.allTime.best.elapsedS)}` : 'нет',
            b.recent90.best ? `${b.recent90.best.date} / ${n(b.recent90.best.elapsedS)}` : 'нет',
            b.recent365.best ? `${b.recent365.best.date} / ${n(b.recent365.best.elapsedS)}` : 'нет',
            n(b.recent90VsAllTimeElapsedPercent),
            b.recent90.best ? `activity:${b.recent90.best.activityId}` : 'нет',
          ]),
        ),
      );
      add(
        '### Сезонный каталог контрольных целых сессий',
        table(
          [
            'Цель, м',
            'Условия',
            'Год',
            'Сессий в допуске',
            'Дата лучшего',
            'Реальная дистанция, м',
            'Полное / движущееся время, с',
            'Источник',
            'Ссылка',
          ],
          d.benchmarks.flatMap((b) =>
            b.seasons.map((y) => [
              b.targetDistanceM,
              b.condition,
              y.year,
              y.sessions,
              y.best.date,
              n(y.best.distanceM),
              `${n(y.best.elapsedS)} / ${n(y.best.movingS)}`,
              y.best.source,
              `activity:${y.best.activityId}`,
            ]),
          ),
        ),
      );
      add(
        'Рейтинги используют полное время и только записанную целую сессию в допуске ±1%. Indoor/outdoor и другие подтипы не смешиваются. Время не пересчитывается к условной точной дистанции, интервалы из среднего темпа не создаются. Даже одинаковый подтип не подтверждает совпадение трассы, погоды, течения, оборудования или драфтинга.',
      );
    }
  }
  if (chapter === 11) {
    for (const sport of DISCIPLINES) {
      const d = p[sport],
        c = d.consistency;
      add(
        `### ${names[sport]}: подтверждённая регулярность записей`,
        `Из 52 полных недель (${c.from} — ${c.to}) сессии есть в ${c.recordedWeeks}; минимум две — в ${c.weeksAtLeastTwoSessions}, минимум три — в ${c.weeksAtLeastThreeSessions}. Наибольшая непрерывная серия недель с записью: ${c.longestRecordedWeekStreak}; серия, заканчивающаяся последней полной неделей: ${c.currentRecordedWeekStreak}. Медиана сессий в неделю: ${n(c.weeklySessions.median)}; P90: ${n(c.weeklySessions.p90)}.`,
        table(
          ['Последние полные недели', 'Границы', 'Недель с записью', 'Сессии'],
          c.recentBlocks.map((b) => [b.weeks, `${b.from} — ${b.to}`, b.recordedWeeks, b.sessions]),
        ),
        '#### Самые длинные промежутки без записей в годовом виде',
        table(
          ['От', 'До', 'Дней без сохранённой сессии'],
          c.recordingGaps.map((g) => [g.from, g.to, g.days]),
        ),
        '#### Исторические пики 28 календарных дней — неперекрывающиеся примеры',
        table(
          [
            'Критерий пика',
            'От',
            'До',
            'Сессии',
            'км',
            'Движение, ч',
            'Покрытие дистанции / движения',
          ],
          [
            ...d.rolling28Peaks.distance.map((v) => ({ kind: 'известные км', ...v })),
            ...d.rolling28Peaks.moving.map((v) => ({ kind: 'известные секунды движения', ...v })),
          ].map((v) => [
            v.kind,
            v.from,
            v.to,
            v.sessions,
            km(v.distanceM),
            h(v.movingS),
            `${v.distanceKnown}/${v.sessions} / ${v.movingKnown}/${v.sessions}`,
          ]),
        ),
      );
    }
    add(
      'Пики по километрам и часам выбираются независимо, каждый с тремя неперекрывающимися примерами. Они не являются рекомендацией вернуться к прежнему объёму. Промежутки без записей не интерпретируются как установленный отдых или болезнь.',
    );
  }
  if (chapter === 12) {
    for (const sport of DISCIPLINES) {
      const d = p[sport];
      add(
        `### ${names[sport]}: интенсивностные наблюдения по периодам`,
        table(
          [
            'Период',
            'Метрика / единица',
            'Сессии с метрикой / всего',
            'Среднее / медиана',
            'P10 / P90',
            'Источники',
            'Происхождение',
          ],
          d.periods.flatMap((v) =>
            v.metrics.map((m) => [
              labels[v.key],
              `${m.key} / ${m.unit}`,
              `${m.sessions}/${v.volume.sessions}`,
              `${n(m.stats.mean)} / ${n(m.stats.median)}`,
              `${n(m.stats.p10)} / ${n(m.stats.p90)}`,
              Object.entries(m.sourceCounts)
                .map(([k, c]) => `${k}:${c}`)
                .join('; '),
              Object.entries(m.originCounts)
                .map(([k, c]) => `${k}:${c}`)
                .join('; '),
            ]),
          ),
        ),
      );
      for (const v of d.periods.filter((v) => ['recent_28', 'recent_90'].includes(v.key)))
        add(
          `#### ${names[sport]}, ${labels[v.key]}: точные опорные наблюдения`,
          table(
            ['Метрика', 'Дата', 'Значение', 'Единица', 'Источник / происхождение', 'Ссылка'],
            v.metrics.flatMap((m) =>
              m.evidence.map((e) => [
                m.key,
                e.date,
                n(e.value, 3),
                e.unit,
                `${e.source} / ${e.origin}`,
                `activity:${e.activityId}`,
              ]),
            ),
          ),
        );
    }
    add(
      'Canonical HR имеет приоритет над дополнительным HR одной сессии: пульс не удваивается. Пропущенный canonical HR может дополняться отдельным источником, сохраняя его происхождение. Квантили средних значений сессий не являются временем в пульсовых зонах. Power provider_derived не означает доказанный измеритель мощности. Никакие FTP/CSS, пороги или зоны из этих таблиц не назначаются.',
    );
  }
  if (chapter === 13) {
    for (const sport of DISCIPLINES)
      add(
        `### ${names[sport]}: повторяемость записанных длинных сессий`,
        table(
          [
            'Минимум целой сессии, м',
            'За историю',
            'За 365 дней',
            'За 90 дней',
            'Различных недель за 90 дней',
            'Последняя дата',
            'Дней до среза',
            'Медиана интервала между датами за 90 дней',
          ],
          p[sport].endurance.map((v) => [
            v.minDistanceM,
            v.lifetimeSessions,
            v.recent365Sessions,
            v.recent90Sessions,
            v.recent90DistinctWeeks,
            v.lastDate ?? 'нет',
            n(v.daysSinceLast, 0),
            n(v.recent90GapDays.median),
          ]),
        ),
        table(
          [
            'Минимум, м',
            'Дата',
            'Реальная дистанция, м',
            'Движение / полное, с',
            'Источник',
            'Ссылка',
          ],
          p[sport].endurance.flatMap((v) =>
            v.evidence.map((e) => [
              v.minDistanceM,
              e.date,
              n(e.distanceM),
              `${n(e.movingS)} / ${n(e.elapsedS)}`,
              e.source,
              `activity:${e.activityId}`,
            ]),
          ),
        ),
      );
    add(
      `### Наблюдаемые дни с несколькими дисциплинами`,
      `В сохранённой истории ${s.longitudinal.multisport.sameDayCount} календарных дней с несколькими дисциплинами. Комбинации: ${
        Object.entries(s.longitudinal.multisport.combinationCounts)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ') || 'нет'
      }.`,
      table(
        ['Дата', 'Дисциплины', 'Ссылки', 'Список ограничен'],
        s.longitudinal.multisport.recentExamples.map((v) => [
          v.date,
          v.disciplines.join(' + '),
          v.activityIds.map((id) => `activity:${id}`).join(', '),
          v.truncated ? 'да' : 'нет',
        ]),
      ),
      'Минимальные дистанции обозначают факт целой сессии не короче порога; это не время отрезка на пороге и не официальный финиш. Разные недели с такими сессиями показывают повторяемость записи. Совпавший календарный день не устанавливает последовательность, переход или brick.',
    );
  }
  if (chapter === 14) {
    const formats = [
      { name: 'Олимпийский', run: 10000, bike: 40000, swim: 1500 },
      { name: '70.3', run: 21097.5, bike: 90000, swim: 1900 },
      { name: 'Полная дистанция', run: 42195, bike: 180000, swim: 3800 },
    ];
    add(
      '### Матрица сохранённого опыта относительно дистанций',
      table(
        [
          'Формат',
          'Дисциплина',
          'Минимальная дистанция, м',
          'Сессии ≥ дистанции: история / 365 / 90 дней',
          'Последняя дата',
          'Точный недавний пример',
        ],
        formats.flatMap((format) =>
          DISCIPLINES.map((sport) => {
            const v = p[sport].endurance.find((e) => e.minDistanceM === format[sport]);
            return [
              format.name,
              names[sport],
              format[sport],
              v ? `${v.lifetimeSessions} / ${v.recent365Sessions} / ${v.recent90Sessions}` : 'н/д',
              v?.lastDate ?? 'нет',
              v?.evidence[0] ? `activity:${v.evidence[0].activityId}` : 'нет',
            ];
          }),
        ),
      ),
      'Матрица не складывает лучшие времена разных дней и не предсказывает финиш. Она показывает, какие дистанции реально повторялись в отдельных дисциплинах, насколько недавно, и где запись не даёт опоры для переноса на длинный триатлон. Для сценария IronMan должен отдельно задать подтверждённые условия, питание, переходы и консервативные допущения.',
    );
  }
  if (chapter === 15) {
    for (const sport of DISCIPLINES) {
      const d = p[sport],
        period = d.periods.find((v) => v.key === 'recent_90')!,
        longest = period.longest[0];
      add(
        `### ${names[sport]}: индивидуальные границы доказательств`,
        `За последние 90 дней сохранено ${period.volume.sessions} сессий, на ${period.volume.activeDays} датах. Самая длинная недавняя запись: ${longest ? `${km(longest.distanceM)} км, ${longest.date}, activity:${longest.activityId}` : 'отсутствует'}. Известно движение ${period.volume.movingKnown}/${period.volume.sessions}, дистанция ${period.volume.distanceKnown}/${period.volume.sessions}. Численных ключей метрик в этом периоде: ${period.metrics.length}.`,
        `Неполнота отдельных полей не равнозначна отсутствию тренировок: неизвестная дистанция в ${period.volume.sessions - period.volume.distanceKnown} записях, движение в ${period.volume.sessions - period.volume.movingKnown}. Без записанного сравнимого теста текущая соревновательная способность остаётся неизвестной.`,
        `Явные неизвестные: ${d.unknowns.join('; ')}. Они не обозначают доказанную слабость спортсмена.`,
      );
      const thresholds =
        sport === 'run'
          ? [10000, 21097.5, 42195]
          : sport === 'bike'
            ? [40000, 90000, 180000]
            : [1500, 1900, 3800];
      for (const threshold of thresholds) {
        const evidence = d.endurance.find((v) => v.minDistanceM === threshold)!;
        const basis =
          evidence.evidence.map((v) => `activity:${v.activityId}`).join(', ') ||
          'подходящих записей нет';
        if (evidence.recent90Sessions >= 2 && evidence.recent90DistinctWeeks >= 2)
          add(
            `**Подтверждённая повторяемость:** целые занятия не короче ${km(threshold)} км записаны ${evidence.recent90Sessions} раз в ${evidence.recent90DistinctWeeks} разных неделях последних 90 дней. Основание: ${basis}. **Ограниченная интерпретация:** дистанция встречается повторно в недавней практике; темп после других этапов, восстановление и питание этим не подтверждены.`,
          );
        else if (evidence.lifetimeSessions > 0)
          add(
            `**Исторический опыт и его граница:** не менее ${km(threshold)} км встречается в ${evidence.lifetimeSessions} целых сессиях за историю; за последние 90 дней — ${evidence.recent90Sessions}, в ${evidence.recent90DistinctWeeks} разных неделях. Последняя дата ${evidence.lastDate}. Основание: ${basis}. **Ограниченная интерпретация:** свежая повторяемость именно на этом уровне не установлена; старый результат не заменяет текущий тест.`,
          );
        else
          add(
            `**Неизвестная способность:** в сохранённых измеренных целых сессиях нет дистанции не короче ${km(threshold)} км. Это ограничение доступной опоры для сценария, а не доказательство неспособности спортсмена. Более длинный отрезок, экстраполяция среднего темпа или реконструированная сводка не подставляются вместо такой записи.`,
          );
      }
    }
  }
  if (chapter === 16) {
    add(
      '### Ближайший одинаковый по длине исторический контекст',
      table(
        [
          'Дисциплина',
          '28 дней сейчас, км',
          'Пиковые 28 дней, км',
          'Доля пика, %',
          'Последний 90-дневный объём, км',
          'Предыдущие 90 дней, км',
          'Разница, %',
        ],
        DISCIPLINES.map((sport) => {
          const d = p[sport],
            recent = d.periods.find((v) => v.key === 'recent_28')!,
            a = d.periods.find((v) => v.key === 'recent_90')!,
            b = d.periods.find((v) => v.key === 'previous_90')!;
          return [
            names[sport],
            km(recent.volume.distanceM),
            km(d.rolling28Peaks.distance[0]?.distanceM ?? null),
            n(d.recent28DistanceAsPercentOfPeak),
            km(a.volume.distanceM),
            km(b.volume.distanceM),
            n(d.adjacentComparisons.find((c) => c.days === 90)!.distanceChangePercent),
          ];
        }),
      ),
      'Это сравнение структуры и количества сохранённых занятий. Оно не превращает прежний рекорд или прежнюю пиковую нагрузку в оценку текущего результата. Сезонная специализация, условия и полнота источников могут менять картину.',
    );
  }
  if (chapter === 17)
    add(
      '### Дополнение к методике: глубина профиля',
      'Квантили используют линейную интерполяцию типа 7: индекс (n−1)×p между соседними упорядоченными наблюдениями. Нули известных объёмов остаются известными; отсутствующие значения исключаются с отдельным missing. Квантили сессий не взвешены временем.',
      'Сравнения recent/previous используют соседние неперекрывающиеся периоды 28 и 90 календарных дней. Исторические пики — скользящие 28-дневные окна; выбранные примеры одного критерия не перекрываются. Учёт длинных сессий использует ≥ точной дистанции; рейтинг тестов использует отдельный ±1% диапазон и сохраняет реальную дистанцию.',
      'Метрики группируются по фактической дате канонической сессии, не по дате проекции. Источник и происхождение показывают возможную неоднородность средних. Исторический asOf ограничивает даты сессий в текущем сохранённом состоянии; это не восстановление состояния базы на прошлую дату.',
    );
  if (chapter === 18) {
    const references = new Map<
      string,
      { activityId: string; date: string; distanceM: number | null; source: string }
    >();
    for (const sport of DISCIPLINES) {
      const d = p[sport];
      for (const r of [
        ...d.periods.flatMap((v) => v.longest),
        ...d.seasons.flatMap((v) => v.longest),
        ...d.endurance.flatMap((v) => v.evidence),
        ...d.benchmarks
          .flatMap((v) => [
            v.allTime.best,
            v.recent90.best,
            v.recent365.best,
            ...v.seasons.map((y) => y.best),
          ])
          .filter((v) => v !== null),
      ])
        references.set(r.activityId, r);
    }
    add(
      '### Дополнительные ссылки продольного профиля',
      table(
        ['Стабильная ссылка', 'Дата', 'Источник', 'Реальная дистанция, м'],
        [...references.values()]
          .sort((a, b) => a.date.localeCompare(b.date) || a.activityId.localeCompare(b.activityId))
          .map((r) => [`activity:${r.activityId}`, r.date, r.source, n(r.distanceM, 3)]),
      ),
    );
  }
  if (chapter === 19)
    add(
      '### Дополнительный блок longitudinal',
      '`longitudinal.profiles.<sport>.periods` содержит распределения и метрики девяти периодов; `adjacentComparisons` — неперекрывающиеся сопоставления. `seasons` содержит условно сопоставимые сезонные наблюдения; `benchmarks` сохраняет отдельный подтип, точную дистанцию и полное время. `endurance` считает повторяемость минимальных целых дистанций. `rolling28Peaks` даёт исторический масштаб; `consistency` — регулярность записей полных недель. Все эти поля — факты/детерминированная арифметика, не прогноз.',
      '`longitudinal.multisport` сообщает только совпадения календарных дат. Не интерпретировать его как доказательство последовательности этапов. Сохранить coverage, неизвестные значения, source/origin и ограничения при передаче контекста IronMan.',
    );
  return result;
}
