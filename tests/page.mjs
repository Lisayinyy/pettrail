// Loads the inline <script> of index.html into a bare V8 context so the page's own functions can be
// called from Node. The page is not modified or split for this: the harness supplies a fixed clock,
// an in-memory localStorage and just enough `document` for the top-level `render()` call.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const EXPORTS = ['parse', 'iso', 'addDays', 'diffDays', 'fmtMD', 'ageText', 'reminders', 'healthScore',
  'matchFriends', 'growthSummary', 'load', 'seed', 'render', 'go', 'VIEWS', 'UI', 'KEY'];

export function loadPage({ html = new URL('../index.html', import.meta.url), now, saved } = {}) {
  const source = readFileSync(html, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const store = new Map(saved === undefined ? [] : [['pettrail_v1', typeof saved === 'string' ? saved : JSON.stringify(saved)]]);
  const nodes = new Map();
  const node = () => ({ innerHTML: '', scrollTop: 0, appendChild() {}, remove() {}, addEventListener() {}, querySelectorAll: () => [] });
  const context = vm.createContext({
    NOW: now,
    console,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    document: {
      querySelector: s => nodes.get(s) ?? nodes.set(s, node()).get(s),
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: node,
      addEventListener() {},
    },
    confirm: () => true, prompt: () => null, setTimeout: () => 0,
  });
  context.window = context;
  // `new Date()` and `Date.now()` answer with the test's clock; every other Date call is untouched.
  vm.runInContext(`{
    const Real = Date;
    globalThis.Date = class extends Real {
      constructor(...a) { if (a.length) super(...a); else super(NOW); }
      static now() { return new Real(NOW).getTime(); }
    };
  }`, context);
  // `typeof` keeps the harness usable on older revisions of the page that lack one of the names.
  const exported = EXPORTS.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  vm.runInContext(`${source}\n;globalThis.__page = { ${exported}, state: () => S };`, context, { filename: 'index.html<script>' });
  return { ...context.__page, html: s => nodes.get(s)?.innerHTML ?? '', stored: () => store.get('pettrail_v1') };
}
