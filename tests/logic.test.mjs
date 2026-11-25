// Run with: node --test
// The page stores days as 'YYYY-MM-DD' strings and derives every reminder, age and milestone from them,
// so the same checks are repeated under several time zones (the approach of date-fns' scripts/test/tz.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './page.mjs';

const NOW = '2026-11-20T10:00:00';

// [zone, minutes behind UTC on 2026-01-01]. The offset is asserted so a runtime that ignores TZ cannot pass quietly.
const ZONES = [
  ['Asia/Shanghai', -480],          // where the page was written
  ['America/Los_Angeles', 480],     // west of Greenwich: every derived date used to come out a day early
  ['Pacific/Kiritimati', -840],     // UTC+14
  ['Etc/GMT+12', 720],              // UTC-12
  ['America/Santiago', 180],        // clocks jump at midnight, so one local midnight per year does not exist
  ['Africa/Cairo', -120],           // same, in spring
  ['Australia/Lord_Howe', -660],    // half-hour daylight saving
];

// Values built inside the page's context have that context's Array/Object prototypes; copy before comparing.
const plain = v => JSON.parse(JSON.stringify(v));
// Calendar arithmetic that never touches local time: the reference the page is compared with.
const plus = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

for (const [zone, offset] of ZONES) {
  test(`day arithmetic stays on the calendar in ${zone}`, () => {
    const before = process.env.TZ;
    process.env.TZ = zone;
    try {
      assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), offset, 'time zone was not applied');
      const page = loadPage({ now: NOW });
      for (let day = '2026-01-01'; day < '2028-01-01'; day = plus(day, 1)) {
        const [, m, d] = day.split('-').map(Number);
        assert.equal(page.iso(page.parse(day)), day);
        assert.equal(page.fmtMD(day), `${m}月${d}日`);
        for (const n of [1, 30, 365]) {
          assert.equal(page.addDays(day, n), plus(day, n), `${day} + ${n}`);
          assert.equal(page.diffDays(plus(day, n), day), n, `${day} .. +${n}`);
        }
      }
      assert.equal(page.diffDays('2026-11-27'), 7, 'days from the page clock');
      assert.equal(page.ageText('2025-11-20'), '1岁');
      assert.equal(page.ageText('2026-11-21'), '未出生');
    } finally {
      if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
    }
  });
}

// One cat, born long enough ago to be an adult, with records placed relative to the fixed clock.
const cat = { id: 'c1', name: '奶糖', species: '猫', breed: '英国短毛猫', gender: 'MM', birth: '2024-01-10', home: '2024-03-01', avatar: '🐱' };
const state = extra => ({ me: { name: '我', city: '上海·徐汇区' }, current: 'c1', pets: [cat], ...extra });

test('reminders come from the newest record of each kind, soonest first', () => {
  const page = loadPage({ now: NOW, saved: state({
    weights: [{ id: 'w1', pet: 'c1', date: '2026-10-01', value: 4.4 }, { id: 'w2', pet: 'c1', date: '2026-11-10', value: 4.5 }],
    vaccines: [{ id: 'v1', pet: 'c1', date: '2025-01-05', name: '猫三联 第1针', next: '2025-02-05' }, { id: 'v2', pet: 'c1', date: '2026-01-05', name: '猫三联（加强）', next: '2027-01-05' }],
    deworms: [
      { id: 'd1', pet: 'c1', date: '2026-08-01', kind: '体内', drug: '旧药', next: '2026-11-01' },
      { id: 'd2', pet: 'c1', date: '2026-11-05', kind: '体内', drug: '拜宠清', next: '2027-02-05' },
      { id: 'd3', pet: 'c1', date: '2026-10-25', kind: '体外', drug: '福来恩', next: '2026-11-25' },
      { id: 'd4', pet: 'other', date: '2026-11-19', kind: '体内', drug: '别的宠物', next: '2026-11-21' },
    ],
  }) });
  assert.deepEqual(plain(page.reminders().map(r => [r.type, r.due, r.title])), [
    ['deworm', '2026-11-25', '体外驱虫（福来恩）'],
    ['weight', '2026-12-10', '月度称重'],
    ['vaccine', '2027-01-05', '疫苗：猫三联 加强'],
    ['deworm', '2027-02-05', '体内驱虫（拜宠清）'],
  ]);
  assert.deepEqual(plain(page.healthScore()), { score: 100, tips: [] });
});

test('a pet with no records is asked for a vaccine record and a weigh-in today', () => {
  const page = loadPage({ now: NOW, saved: state({}) });
  assert.deepEqual(plain(page.reminders().map(r => [r.type, r.due]).sort()), [['vaccine', '2026-11-20'], ['weight', '2026-11-20']]);
  assert.equal(page.healthScore().score, 100, 'due today is not overdue');
});

test('health score: overdue items cost 8 plus 3 per full week (capped at 25), weight rules add up, floor is 30', () => {
  const overdue = (dueDaysAgo, weights = [{ id: 'w', pet: 'c1', date: '2026-11-20', value: 4.5 }]) => loadPage({ now: NOW, saved: state({
    weights,
    vaccines: [{ id: 'v', pet: 'c1', date: '2025-01-01', name: '狂犬', next: plus('2026-11-20', -dueDaysAgo) }],
  }) }).healthScore();
  assert.equal(overdue(1).score, 92);
  assert.equal(overdue(6).score, 92);
  assert.equal(overdue(7).score, 89);
  assert.equal(overdue(41).score, 77);
  assert.equal(overdue(42).score, 75, 'cap');
  assert.equal(overdue(400).score, 75, 'cap');
  assert.deepEqual([...overdue(1).tips], ['疫苗：狂犬 加强已逾期']);

  // 英国短毛猫 reference range is 4-8 kg; 8.6 kg is above it and +15% on the previous weigh-in.
  const heavy = overdue(0, [{ id: 'a', pet: 'c1', date: '2026-10-25', value: 7.5 }, { id: 'b', pet: 'c1', date: '2026-11-20', value: 8.6 }]);
  assert.equal(heavy.score, 82);
  assert.deepEqual([...heavy.tips], ['体重高于品种参考范围', '近期体重波动 15%']);

  const everything = loadPage({ now: NOW, saved: state({
    weights: [{ id: 'a', pet: 'c1', date: '2025-01-01', value: 3 }, { id: 'b', pet: 'c1', date: '2025-02-01', value: 2 }],
    vaccines: [{ id: 'v', pet: 'c1', date: '2024-06-01', name: '狂犬', next: '2025-06-01' }],
    deworms: [{ id: 'd', pet: 'c1', date: '2024-06-01', kind: '体内', drug: 'x', next: '2024-09-01' }, { id: 'e', pet: 'c1', date: '2024-06-01', kind: '体外', drug: 'y', next: '2024-07-01' }],
  }) }).healthScore();
  assert.equal(everything.score, 30);
});

test('a kitten under one year is not judged against the adult weight range', () => {
  const kitten = { ...cat, birth: '2026-06-01', home: '2026-08-01' };
  const page = loadPage({ now: NOW, saved: { ...state({ weights: [{ id: 'w', pet: 'c1', date: '2026-11-20', value: 1.8 }], vaccines: [{ id: 'v', pet: 'c1', date: '2026-11-01', name: '猫三联', next: '2026-12-01' }] }), pets: [kitten] } });
  assert.deepEqual(plain(page.healthScore()), { score: 100, tips: [] });
});

// Whatever is in localStorage, the page has to come up and every tab has to draw.
const TABS = ['home', 'health', 'timeline', 'friends', 'community'];
const drawsEverything = page => {
  for (const tab of TABS) {
    page.go(tab);
    assert.ok(page.html('#main').length > 50, `${tab} drew nothing`);
    if (tab === 'health') for (const h of ['weight', 'vaccine', 'deworm', 'visit']) { page.UI.hTab = h; page.render(); }
  }
};
const demo = () => JSON.parse(JSON.stringify(loadPage({ now: NOW }).seed()));
const damaged = {
  'unparseable text': () => '{oops',
  'null': () => 'null',
  'only the pets': () => ({ pets: demo().pets }),
  'a null where a pet should be': () => ({ ...demo(), pets: [null, ...demo().pets] }),
  'a pet without dates': () => { const s = demo(); delete s.pets[0].birth; delete s.pets[0].home; return s; },
  'a null record': () => ({ ...demo(), weights: [null, ...demo().weights] }),
  'records without a date': () => { const s = demo(); for (const k of ['weights', 'vaccines', 'deworms', 'visits', 'diaries']) delete s[k][0].date; return s; },
  'a record with an unreadable date': () => { const s = demo(); s.diaries[0].date = '去年夏天'; return s; },
  'a null post': () => ({ ...demo(), posts: [null, ...demo().posts] }),
  'city is not text': () => ({ ...demo(), me: { name: 'x', city: 5 } }),
  'selected pet no longer exists': () => ({ ...demo(), current: 'gone' }),
};
for (const [name, make] of Object.entries(damaged)) {
  test(`saved state with ${name} still opens on every tab`, () => {
    drawsEverything(loadPage({ now: NOW, saved: make() }));
  });
}

test('recovery keeps the usable part of a damaged save instead of resetting it', () => {
  const s = demo();
  const kept = s.weights.length - 1;
  delete s.weights[0].date;
  s.pets.push(null);
  const page = loadPage({ now: NOW, saved: s });
  assert.equal(page.state().pets.length, 2);
  assert.equal(page.state().weights.length, kept);
  assert.equal(page.state().diaries.length, s.diaries.length);
});
