// menu.js — главное меню (классическое): слева пункты, справа содержимое.
// Продолжить / Новая игра / Сценарии / Загрузить / Достижения / Настройки / Выход.
// Здесь же сериализация мира. Смена размера/загрузка — через перезагрузку страницы
// с конфигом в sessionStorage (все массивы создаются сразу нужного размера).
'use strict';

// {0}/{1} placeholder formatter (the UI is English-only now)
const _fmt = (str, ...a) => String(str).replace(/\{(\d+)\}/g, (m, i) => (a[+i] == null ? m : a[+i]));
const SAVE_PREFIX = 'earthsim.save.';   // ключи сохранений версии 1.x в localStorage (новые лежат в SaveStore)

// ---------- сериализация мира ----------
const _SCAL_KEYS = ['co2', 'solar', 'seaLevel', 'globalForce', 'tiltMul', 'windMul', 'currentMul', 'poleCold',
  'co2ppm', 'globalEmissions', 'ecoGlobal', 'simYear', 'simTick', 'dayOfYear', 'seasonPhase', 'paused',
  'nukeWinter', 'pace', 'dynSea', 'seaBase', 'seaRefT', 'disasterRate', 'aerosol', 'faunaAuto', 'faunaRich'];
// производные/временные поля НЕ сохраняем: они пересчитываются при загрузке (recomputeStatic + первые шаги климата).
const _SKIP_ARRAYS = new Set(['_pIndex', '_scratch', '_scratch2', 'isWater', 'seaDepth', 'isCoast', 'slope',
  'distOcean', 'basinSide', 'upwindWet', 'windU', 'windV', 'currentU', 'currentV', 'npp', 'hab', 'habEff',
  'capacity', 'foodCap', 'capDirty', 'landmass']);

function _ab2b64(view) {
  const u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function _b642ab(b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8.buffer;
}
const _TYPED_CTORS = { Float32Array: Float32Array, Float64Array: Float64Array, Uint8Array: Uint8Array, Uint16Array: Uint16Array, Uint32Array: Uint32Array, Int8Array: Int8Array, Int16Array: Int16Array, Int32Array: Int32Array };
// держава → простой объект. Поля перечисляются не списком, а обходом: новое поле державы попадает
// в сейв само (раньше забытое в списке поле молча терялось при загрузке). Служебные (_имя) пропускаем —
// кроме тех, что держат состояние на годы вперёд: золотой век, «откаты» реформ, восстаний и уний,
// стаж вассала, кто последним отнял землю. Без них каждое автосохранение обрывало золотой век.
const _KEEP_U = new Set(['_golden', '_govY', '_revoltY', '_unionY', '_vasT', '_lostToUid']);
function _packState(st) {
  const o = {};
  for (const k in st) {
    if (k.charCodeAt(0) === 95 && !(_KEEP_U.has(k) && typeof st[k] === 'number' && isFinite(st[k]))) continue;
    const v = st[k];
    o[k] = (v instanceof Set) ? { __s: Array.from(v) } : (v instanceof Map) ? { __m: Array.from(v) } : v;
  }
  return o;
}
// запись хроники из файла: сохранения ходят между игроками (Мастерская, «Загрузить из файла»), поэтому
// всё, что потом попадает в разметку, приводится к числам и «словам»; текст выводится только через UI.esc
function _cleanEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const o = { year: +e.year || 0, type: String(e.type || '').replace(/[^a-z]/g, '').slice(0, 20) || 'dawn', text: String(e.text == null ? '' : e.text).slice(0, 600) };
  const d = e.d;
  if (d && typeof d === 'object') {
    const n = v => (typeof v === 'number' && isFinite(v)) ? v | 0 : -1;
    o.d = { s: Array.isArray(d.s) ? d.s.slice(0, 8).map(n) : [], cell: n(d.cell), p: n(d.p), war: n(d.war), imp: Math.max(0, Math.min(3, n(d.imp))) };
    if (Array.isArray(d.u)) o.d.u = d.u.slice(0, 8).map(n);
    if (typeof d.dis === 'string') o.d.dis = d.dis.replace(/[^a-z]/g, '').slice(0, 20);
    for (const k in d) if (!(k in o.d) && (typeof d[k] === 'number' ? isFinite(d[k]) : typeof d[k] === 'boolean')) o.d[k] = d[k];   // прочие числовые поля модулей
  }
  return o;
}
function _unpackState(ss) {
  const st = (typeof stateBlank === 'function') ? stateBlank(ss.id) : { id: ss.id };
  for (const k in ss) {
    const v = ss[k];
    if (v && typeof v === 'object' && Array.isArray(v.__s)) st[k] = new Set(v.__s);
    else if (v && typeof v === 'object' && Array.isArray(v.__m)) st[k] = new Map(v.__m);
    else st[k] = v;
  }
  // сейвы версии 1.x: cells и relations лежали голыми массивами
  if (Array.isArray(st.cells)) st.cells = new Set(st.cells);
  if (Array.isArray(st.relations)) st.relations = new Map(st.relations);
  if (!(st.cells instanceof Set)) st.cells = new Set();
  if (!(st.relations instanceof Map)) st.relations = new Map();
  if (!(st.truce instanceof Map)) st.truce = new Map();
  if (!Array.isArray(st.history)) st.history = [];
  if (!Array.isArray(st.res) || st.res.length !== RES.length) st.res = new Array(RES.length).fill(0);
  if (!st.rm || typeof st.rm !== 'object') st.rm = { tech: 1, stab: 0, war: 1, dip: 0, growth: 1 };
  return st;
}
function serializeWorld() {
  const save = { v: 3, app: GAME_VERSION, w: GRID.W, h: GRID.H, ts: Date.now(), seed: worldSeed, scal: {}, arrays: {}, states: [],
    stateSeq: (typeof _stateSeq !== 'undefined' ? _stateSeq : 0), events: (typeof worldEvents !== 'undefined' ? worldEvents.slice(0, EVENT_CAP) : []),
    cityNames: Object.assign({}, cityNames), cityMeta: Object.assign({}, cityMeta), wars, warLog, warSeq: _warSeq, ext: {} };
  for (const k of _SCAL_KEYS) save.scal[k] = W[k];
  // открытое меню само ставит мир на паузу — в сейв идёт состояние игры ДО меню, иначе «Продолжить» всегда начинало бы с паузы
  { const mm = document.getElementById('main-menu'); if (mm && mm.classList.contains('show')) save.scal.paused = !!_prevPaused; }
  for (const k in W) { const v = W[k]; if (ArrayBuffer.isView(v) && !_SKIP_ARRAYS.has(k)) save.arrays[k] = { t: v.constructor.name, b: _ab2b64(v) }; }
  if (typeof states !== 'undefined') for (const st of states) save.states.push(_packState(st));
  simEmit('save', save);                                           // подсистемы дописывают своё в save.ext.<имя>
  return save;
}
function applyLoadedSave(save) {
  if (typeof netScrub === 'function') netScrub(save, 0);           // сейвами делятся: разметка из чужого файла в окне игры сработала бы как код
  if (typeof save.seed === 'number') worldSeed = save.seed;        // от зерна зависят имена материков и весь «шум» мира
  const had = {};
  for (const k in save.arrays) {
    const a = save.arrays[k]; if (!W[k] || !ArrayBuffer.isView(W[k])) continue;
    const Ctor = _TYPED_CTORS[a.t]; if (!Ctor) continue;           // только типизированные массивы (защита от подделанного сейва)
    const arr = new Ctor(_b642ab(a.b));
    if (arr.length === W[k].length) { W[k].set(arr); had[k] = true; }
  }
  // поля 2.0, которых нет в старом сейве, обнуляем явно: загрузка идёт поверх мира, сгенерированного при старте
  for (const k of ['res', 'culture', 'religion', 'herb', 'pred', 'fish', 'ruin', 'fire', 'immune']) if (!had[k]) W[k].fill(0);
  if (!had.pAnom) W.pAnom.fill(1);
  W.pace = 1; W.dynSea = 0; W.disasterRate = 1; W.aerosol = 0; W.nukeWinter = 0; W.seaRefT = 1e9;
  W.faunaAuto = 1; W.faunaRich = 1;                                  // сейв до 2.1.3: звери расселяются сами, животный мир обычный — как было
  for (const k of _SCAL_KEYS) if (k in save.scal) W[k] = save.scal[k];
  if (!('seaBase' in save.scal)) W.seaBase = W.seaLevel;
  if (typeof states !== 'undefined') {
    states.length = 0;
    let maxId = -1; for (const ss of save.states) if (ss.id > maxId) maxId = ss.id;
    for (let i = 0; i <= maxId; i++) states[i] = stateBlank(i);
    let seq = save.stateSeq || 0;
    for (const ss of save.states) { const st = _unpackState(ss); states[st.id] = st; }
    for (const st of states) if (!(st.uid >= 0)) st.uid = seq++;   // сейв 1.x: сквозных номеров не было — раздаём
    _stateSeq = Math.max(seq, maxId + 1);                          // цвета и номера новых держав не дублируют загруженные
    if (typeof ships !== 'undefined') ships.length = 0;
    if (typeof battles !== 'undefined') battles.length = 0;
    if (typeof missiles !== 'undefined') { missiles.length = 0; explosions.length = 0; }
    if (typeof selectedState !== 'undefined') selectedState = null;
    if (typeof highlightedState !== 'undefined') highlightedState = null;
  }
  if (typeof worldEvents !== 'undefined' && Array.isArray(save.events)) { worldEvents.length = 0; for (const e of save.events) { const c = _cleanEvent(e); if (c) worldEvents.push(c); } if (typeof _eventsChanged !== 'undefined') _eventsChanged = true; }
  for (const k in cityNames) delete cityNames[k];
  for (const k in cityMeta) delete cityMeta[k];
  if (save.cityNames) Object.assign(cityNames, save.cityNames);    // без этого города после загрузки получали новые случайные имена
  if (save.cityMeta && typeof save.cityMeta === 'object') for (const k in save.cityMeta) { const m = save.cityMeta[k]; if (m && typeof m === 'object') cityMeta[k] = Object.assign({}, m, { founded: +m.founded || 0, peak: +m.peak || 0, by: m.by == null ? '' : String(m.by) }); }
  wars.length = 0; warLog.length = 0;
  if (Array.isArray(save.wars)) for (const w of save.wars) wars.push(w);
  if (Array.isArray(save.warLog)) for (const w of save.warLog) warLog.push(w);
  _warSeq = save.warSeq || (wars.length + warLog.length);
  if (typeof recomputeStatic === 'function') recomputeStatic();      // полный пересчёт производных полей (вода/берег/склон/ветра/течения)
  if (!had.res) genResources();                                      // мир из версии 1.x: месторождений ещё не было — расставляем по его рельефу
  if (typeof rebuildCities === 'function') rebuildCities();
  if (typeof refreshCapacities === 'function') refreshCapacities();
  simEmit('load', save);                                             // подсистемы читают save.ext (или заводят состояние с нуля, если его там нет)
  if (typeof syncPlayGlyph === 'function') syncPlayGlyph();          // кнопка ⏸/▶ соответствует загруженному paused
  if (typeof syncPlanetSliders === 'function') syncPlanetSliders();  // ползунки «Планеты» = состояние загруженного мира
  markDirty('base'); markDirty('borders');
  return true;
}
// name — имя сохранения; для совместимости принимает и старый ключ localStorage ('earthsim.save.<имя>')
function loadWorldFromStorage(name) {
  if (typeof name === 'string' && name.indexOf(SAVE_PREFIX) === 0) name = name.slice(SAVE_PREFIX.length);
  const save = SaveStore.read(name); if (!save || !save.arrays) return false;
  if (save.w !== GRID.W || save.h !== GRID.H) return false;   // размер выставляется через boot до создания массивов
  return applyLoadedSave(save);
}

// ---------- мета сохранений (превью/дата) ----------
let _saveListCache = null;                 // список на время одной отрисовки меню: чтение папки — не на каждую строку
function _saveMeta(name) {
  const l = _saveListCache || SaveStore.list();
  const e = l.find(x => x.name === name); return e ? e.meta : null;
}
function _makeThumb() {
  const tw = 80, th = 60, cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
  const x = cv.getContext('2d'), img = x.createImageData(tw, th);
  for (let py = 0; py < th; py++) for (let px = 0; px < tw; px++) {
    const gx = Math.min(GRID.W - 1, (px / tw * GRID.W) | 0), gy = Math.min(GRID.H - 1, (py / th * GRID.H) | 0);
    const i = idx(gx, gy); let c;
    if (W.isWater[i]) c = W.iceAlbedo[i] ? [200, 220, 235] : [16, 42, 72];
    else { const bd = BIOME_RENDER[W.biome[i]], v = W.veg[i]; c = [lerp(bd.base[0], bd.lush[0], v), lerp(bd.base[1], bd.lush[1], v), lerp(bd.base[2], bd.lush[2], v)]; }
    const o = (py * tw + px) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}
function _buildMeta() {
  let pop = 0, alive = 0, maxEra = 0;
  for (let i = 0; i < GRID.N; i++) pop += W.pop[i];
  if (typeof states !== 'undefined') for (const s of states) if (s.alive && s.cells.size) { alive++; if (s.era > maxEra) maxEra = s.era; }
  let thumb = ''; try { thumb = _makeThumb(); } catch (e) {}
  return { ts: Date.now(), w: GRID.W, h: GRID.H, year: Math.floor(W.simYear), pop: Math.round(pop), states: alive, era: maxEra, thumb,
    scenario: (typeof activeScenario !== 'undefined' && activeScenario) ? activeScenario.def.name : '' };
}

// ---------- сохранение текущего мира ----------
function listSaves() { _saveListCache = SaveStore.list(); return _saveListCache.map(x => x.name); }
// quiet — без окна об ошибке (автосохранение не должно выскакивать диалогом посреди игры)
function saveWorldToStorage(name, quiet) {
  name = (name || '').trim() || _fmt('Map, year {0}', (Math.floor(W.simYear) || 0));
  const r = SaveStore.write(name, serializeWorld(), _buildMeta());
  _saveListCache = null;
  if (r.ok) { try { const b = JSON.parse(localStorage.getItem('earthsim.badsaves') || '[]'), k = b.indexOf(name); if (k >= 0) { b.splice(k, 1); localStorage.setItem('earthsim.badsaves', JSON.stringify(b)); } } catch (e) {} return name; }
  if (!quiet) uiAlert(r.why === 'quota'
    ? 'Save failed: not enough storage space. Delete old saves or save to a file.'
    : 'Save failed: ' + r.why);
  return null;
}
function downloadWorldFile() {
  const save = serializeWorld();
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'earthsim_' + GRID.W + 'x' + GRID.H + '_' + (Math.floor(W.simYear) || 0) + 'y.json';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// перезагрузка с конфигом «новая карта» (+ опционально сценарий)
function bootNewMap(cfg) {
  // новая игра из меню (или сценарий) перезапускает страницу — прожитый мир тихо уходит в автосохранение, как при выходе
  if (typeof worldWorthKeeping === 'function' && worldWorthKeeping() && !(typeof walkActive !== 'undefined' && walkActive)) _saveOnExit();
  try { sessionStorage.setItem('earthsim.boot', JSON.stringify(Object.assign({ mode: 'new' }, cfg))); }
  catch (e) { uiAlert('Could not start a new map (storage unavailable).'); return; }
  const ld = document.getElementById('loader'); if (ld) ld.classList.remove('hide');
  location.reload();
}
// перезагрузка с конфигом «загрузить» (имя сохранения в SaveStore)
function bootLoadMap(name, w, h) {
  if (typeof name === 'string' && name.indexOf(SAVE_PREFIX) === 0) name = name.slice(SAVE_PREFIX.length);
  try { sessionStorage.setItem('earthsim.boot', JSON.stringify({ mode: 'load', key: name, w, h })); }
  catch (e) { uiAlert('Could not load the map (storage unavailable).'); return; }
  const ld = document.getElementById('loader'); if (ld) ld.classList.remove('hide');
  location.reload();
}

// ---------- «Новая игра»: наборы настроек (идея игрока, 2.1) ----------
// Настройки нового мира — один объект в «смысловых» единицах (уровень моря 0.40, темп 1.0…), а не в делениях
// ползунков: так набор переживёт смену шкалы. _ngRead читает его с формы, _ngApply кладёт на форму с проверкой
// (пункт списка должен существовать, числа — в пределах поля, чего нет — значение по умолчанию из разметки),
// _ngToBoot превращает в конфиг загрузки — единственное место, где форма становится earthsim.boot.
// Хранилище: earthsim.ngPresets = [{n: имя, v: настройки}] (до 30 наборов, имя до 40 знаков) и earthsim.ngLast —
// настройки последнего «Создать мир» БЕЗ зерна: зерно — это конкретный мир, повторять его без спроса незачем.
const NG_MAX = 30, NG_NAME_MAX = 40;
const NG_HINT = () => 'A preset keeps all the settings below, including the world seed if one is set. New Game opens with the settings of the last world you created, but without the seed.';
const _NG_SLIDERS = [['mm-sea', 'sea', 100], ['mm-co2', 'co2', 100], ['mm-sun', 'sun', 100], ['mm-pace', 'pace', 10]];
const _NG_BUILTIN = () => [
  { id: 'quick', n: 'Quick game', v: { w: 60, h: 45, pace: 1.6 } },
  { id: 'earth', n: 'Big Earth', v: { w: 120, h: 90, type: 'earth' } },
  { id: 'epic', n: 'Long epic', v: { w: 160, h: 120, pace: 0.6 } },
  { id: 'isles', n: 'Archipelago', v: { w: 120, h: 90, type: 'islands', sea: 0.44 } },
  { id: 'cold', n: 'Cold planet', v: { co2: 0.7, sun: 0.96 } },
  { id: 'hot', n: 'Hot planet', v: { co2: 2, sun: 1.04 } },
  { id: 'blank', n: 'Blank canvas', v: { type: 'flat', settle: 0, dis: 0 } },
];
let _ngBusy = false;   // форму заполняет набор, а не игрок: правкой формы это не считаем
function _ngRead(m) {
  const q = id => m.querySelector('#' + id), sz = q('mm-size').value;
  let w, h;
  if (sz === 'custom') { w = clamp(+q('mm-w').value | 0, 24, 220); h = clamp(+q('mm-h').value | 0, 24, 220); }
  else { const wh = sz.split('x'); w = +wh[0]; h = +wh[1]; }
  const v = { w, h, type: q('mm-type').value, dis: +q('mm-dis').value, settle: q('mm-settle').checked ? 1 : 0, dynSea: q('mm-dynsea').checked ? 1 : 0,
    fauna: +q('mm-fauna').value, fauto: q('mm-fauto').checked ? 1 : 0 };
  for (const [id, k, sc] of _NG_SLIDERS) v[k] = +q(id).value / sc;
  const seed = parseInt(String(q('mm-seed').value).replace(/\D/g, ''), 10);
  if (seed > 0 && seed < 2147483647) v.seed = seed;
  return v;
}
function _ngApply(m, v) {
  v = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  const q = id => m.querySelector('#' + id), fin = x => typeof x === 'number' && isFinite(x);
  const pick = (sel, val) => {
    const o = val != null ? [...sel.options].find(x => x.value === String(val)) : null;
    sel.value = o ? o.value : ([...sel.options].find(x => x.defaultSelected) || sel.options[0]).value;
  };
  _ngBusy = true;
  try {
    // размер: стандартный — пунктом списка, иначе «Своя…» с шириной и высотой
    const sizeSel = q('mm-size'), iw = q('mm-w'), ih = q('mm-h');
    if (fin(v.w) && fin(v.h)) {
      const w = clamp(Math.round(v.w), +iw.min, +iw.max), h = clamp(Math.round(v.h), +ih.min, +ih.max);
      if ([...sizeSel.options].some(o => o.value === w + 'x' + h)) { sizeSel.value = w + 'x' + h; iw.value = iw.defaultValue; ih.value = ih.defaultValue; }
      else { sizeSel.value = 'custom'; iw.value = w; ih.value = h; }
    } else { pick(sizeSel, null); iw.value = iw.defaultValue; ih.value = ih.defaultValue; }
    pick(q('mm-type'), typeof v.type === 'string' ? v.type : null);
    pick(q('mm-dis'), fin(v.dis) ? Math.round(v.dis) : null);
    pick(q('mm-fauna'), fin(v.fauna) ? Math.round(v.fauna) : null);      // набор до 2.1.3 — животный мир обычный
    for (const [id, k, sc] of _NG_SLIDERS) { const el = q(id); el.value = fin(v[k]) ? clamp(Math.round(v[k] * sc), +el.min, +el.max) : el.defaultValue; }
    for (const [id, k] of [['mm-settle', 'settle'], ['mm-dynsea', 'dynSea'], ['mm-fauto', 'fauto']]) { const el = q(id); el.checked = (fin(v[k]) || typeof v[k] === 'boolean') ? !!v[k] : el.defaultChecked; }
    const seed = fin(v.seed) ? Math.floor(v.seed) : 0;
    q('mm-seed').value = seed > 0 && seed < 2147483647 ? String(seed) : '';
    // подписи ползунков, заливка дорожек, подсказка темпа и строка «Своя…» живут на событиях — будим их
    for (const [id] of _NG_SLIDERS) q(id).dispatchEvent(new Event('input', { bubbles: true }));
    sizeSel.dispatchEvent(new Event('change', { bubbles: true }));
    _syncSliders();
  } finally { _ngBusy = false; }
}
function _ngToBoot(v) {
  const cfg = { w: v.w, h: v.h, type: v.type, pace: v.pace, disasters: v.dis, dynSea: v.dynSea ? 1 : 0,
    settle: v.settle && ['empty', 'flat'].indexOf(v.type) < 0 ? 1 : 0,
    fauna: typeof v.fauna === 'number' && v.fauna >= -1 && v.fauna <= 2 ? Math.round(v.fauna) : 1, faunaAuto: v.fauto === 0 ? 0 : 1 };
  // климат старта — только если его трогали: нетронутые ползунки не должны запускать пересчёт мира
  if (Math.abs(v.sea - 0.40) > 1e-6) cfg.seaLevel = v.sea;
  if (Math.abs(v.co2 - 1) > 1e-6) cfg.co2 = v.co2;
  if (Math.abs(v.sun - 1) > 1e-6) cfg.solar = v.sun;
  if (v.seed > 0 && v.seed < 2147483647) cfg.seed = v.seed;
  return cfg;
}
// наборы игрока: всё, что пришло из хранилища, проверяем — битая запись не должна ломать меню
function _ngPresets() {
  let a = null; try { a = JSON.parse(localStorage.getItem('earthsim.ngPresets') || '[]'); } catch (e) { a = null; }
  if (!Array.isArray(a)) return [];
  const out = [], seen = new Set();
  for (const p of a) {
    if (!p || typeof p !== 'object' || typeof p.n !== 'string' || !p.v || typeof p.v !== 'object' || Array.isArray(p.v)) continue;
    const n = p.n.replace(/\s+/g, ' ').trim().slice(0, NG_NAME_MAX); if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase()); out.push({ n, v: p.v });
    if (out.length >= NG_MAX) break;
  }
  return out;
}
function _ngPresetsSave(list) {
  try { localStorage.setItem('earthsim.ngPresets', JSON.stringify(list.slice(0, NG_MAX))); return true; }
  catch (e) { if (typeof flash === 'function') flash('Could not store the presets: storage is unavailable'); return false; }
}
function _ngLast() { try { const v = JSON.parse(localStorage.getItem('earthsim.ngLast') || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return null; } }
function _ngLastSave(v) { const o = Object.assign({}, v); delete o.seed; try { localStorage.setItem('earthsim.ngLast', JSON.stringify(o)); } catch (e) {} }

// ---------- интерфейс главного меню ----------
// Оформление «космос/HUD» по макетам: фото-фон Земли, металлический логотип,
// колонка пунктов слева и одно диалоговое окно справа (шапка + группы + подвал).
let _menuEl = null, _prevPaused = false, _curPane = null;
// MENU_UP читает главный цикл (main.js): пока меню открыто, симуляция не идёт, даже если кто-то снял W.paused (выход из прогулки возвращает прежнее значение)
let _menuHold = false, _menuWk = false, _prevWkPaused = false;
var MENU_UP = false;
function _esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// десктоп-сборка? (NW.js или Electron) — там показываем «Выход»
function _isDesktop() {
  try { return !!(window.nw || window.desktopApp || (window.process && window.process.versions && (window.process.versions.nw || window.process.versions.electron))); } catch (e) { return false; }
}
function _quitApp() {
  _saveOnExit();
  if (typeof demoFlush === 'function') demoFlush();       // демо: потраченное время — на диск до закрытия
  try { if (window.nw && nw.App && nw.App.quit) { nw.App.quit(); return; } } catch (e) {}
  try { window.close(); } catch (e) {}
}

// ---------- иконки ----------
// Инлайновый SVG вместо эмодзи: одинаково выглядит на любой системе, красится
// currentColor (синий → белый на активном пункте) и не мылится на 4K.
function _svg(inner, stroke) {
  const st = stroke ? "fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'" : "fill='currentColor'";
  return `<svg class='mm-ic' viewBox='0 0 24 24' ${st} aria-hidden='true'>${inner}</svg>`;
}
const MM_IC = {
  play: () => _svg(`<path d='M7.5 4.8 19 12 7.5 19.2z'/>`),
  plus: () => _svg(`<circle cx='12' cy='12' r='8.6'/><path d='M12 7.6v8.8M7.6 12h8.8'/>`, 1),
  book: () => _svg(`<path d='M11.2 6.2C9 4.9 6.4 4.6 3.6 5.2v12.4c2.8-.6 5.4-.3 7.6 1zM12.8 6.2c2.2-1.3 4.8-1.6 7.6-1v12.4c-2.8-.6-5.4-.3-7.6 1z'/>`),
  save: () => _svg(`<path d='M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7zm-5 16a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2zm3-10.4H5.6V5.2H15z'/>`),
  folder: () => _svg(`<path d='M10.2 4.4H4.2a2 2 0 0 0-2 2v11.2a2 2 0 0 0 2 2h15.6a2 2 0 0 0 2-2V8.4a2 2 0 0 0-2-2h-7.6zM12 8.9l4.2 4.4h-3v4.3h-2.4v-4.3h-3z'/>`),
  trophy: () => _svg(`<path d='M18.6 4.6h-1.8V3H7.2v1.6H5.4a2 2 0 0 0-2 2v1.2c0 2.5 1.9 4.6 4.3 4.9a5 5 0 0 0 3.1 2.7v2.9H7.4V20h9.2v-1.7h-3.4v-2.9a5 5 0 0 0 3.1-2.7 5 5 0 0 0 4.3-4.9V6.6a2 2 0 0 0-2-2zM5.4 7.8V6.6h1.8v4.1a3.2 3.2 0 0 1-1.8-2.9zm13.2 0a3.2 3.2 0 0 1-1.8 2.9V6.6h1.8z'/>`),
  gear: () => _svg(`<path d='M19.4 12.9c.05-.3.07-.6.07-.9s-.02-.6-.07-.9l1.95-1.5a.47.47 0 0 0 .11-.6l-1.85-3.2a.47.47 0 0 0-.56-.2l-2.3.9a6.8 6.8 0 0 0-1.55-.9l-.35-2.44a.46.46 0 0 0-.46-.4h-3.7a.46.46 0 0 0-.46.4l-.35 2.44c-.56.22-1.08.53-1.55.9l-2.3-.9a.46.46 0 0 0-.56.2L3.57 8.99a.47.47 0 0 0 .11.6l1.95 1.5c-.05.3-.08.6-.08.9s.02.6.07.9l-1.95 1.5a.47.47 0 0 0-.11.6l1.85 3.2c.11.2.35.28.56.2l2.3-.9c.48.36 1 .67 1.55.9l.35 2.44c.04.23.23.4.46.4h3.7c.23 0 .42-.17.46-.4l.35-2.44c.56-.23 1.08-.54 1.55-.9l2.3.9c.21.08.45 0 .56-.2l1.85-3.2a.47.47 0 0 0-.11-.6zM12 15.4A3.4 3.4 0 1 1 12 8.6a3.4 3.4 0 0 1 0 6.8z'/>`),
  power: () => _svg(`<path d='M12 3.2v9M7.1 6.5a7.1 7.1 0 1 0 9.8 0'/>`, 1),
  globe: () => _svg(`<circle cx='12' cy='12' r='8.7'/><path d='M3.5 12h17M12 3.3c2.4 2.4 3.6 5.3 3.6 8.7s-1.2 6.3-3.6 8.7c-2.4-2.4-3.6-5.3-3.6-8.7s1.2-6.3 3.6-8.7z'/>`, 1),
  vol: () => _svg(`<path d='M4 9.2h3.4L12 5.2v13.6l-4.6-4H4z'/><path d='M15.6 9a4.3 4.3 0 0 1 0 6M18.4 6.2a8 8 0 0 1 0 11.6' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/>`),
  music: () => _svg(`<path d='M19.4 3.2 8.6 5.4v9.9a3.15 3.15 0 1 0 1.9 2.9V9.2l7-1.45v5.6a3.15 3.15 0 1 0 1.9 2.9z'/>`),
  screen: () => _svg(`<rect x='2.6' y='4.2' width='18.8' height='12.4' rx='1.8'/><path d='M9 20h6M12 16.6V20'/>`, 1),
  star: () => _svg(`<path d='m12 3.6 2.62 5.32 5.88.86-4.25 4.14 1 5.86L12 17l-5.25 2.78 1-5.86L3.5 9.78l5.88-.86z'/>`, 1),
  quest: () => _svg(`<circle cx='12' cy='12' r='8.7'/><path d='M9.5 9.4a2.55 2.55 0 1 1 3.5 2.55c-.68.3-1 .9-1 1.6v.35'/><circle cx='12' cy='16.9' r='1.05' fill='currentColor' stroke='none'/>`, 1),
  cap: () => _svg(`<path d='M12 4.3 2.7 8.7 12 13.1l9.3-4.4z'/><path d='M6.8 10.6v4.1c0 1.45 2.35 2.6 5.2 2.6s5.2-1.15 5.2-2.6v-4.1'/><path d='M21.3 8.7v4.7'/>`, 1),
  check: () => _svg(`<path d='m4.8 12.6 4.9 4.9L19.4 6.9'/>`, 1),
  close: () => _svg(`<path d='m5.9 5.9 12.2 12.2M18.1 5.9 5.9 18.1'/>`, 1),
  down: () => _svg(`<path d='M12 3.6v12.2M7.2 11.4 12 16.2l4.8-4.8M4.4 20h15.2'/>`, 1),
  up: () => _svg(`<path d='M12 16.4V4.2M7.2 9 12 4.2 16.8 9M4.4 20h15.2'/>`, 1),
  target: () => _svg(`<circle cx='12' cy='12' r='8.6'/><circle cx='12' cy='12' r='4.6'/><circle cx='12' cy='12' r='1' fill='currentColor' stroke='none'/>`, 1),
  puzzle: () => _svg(`<path d='M9.4 3.6h5.2v2.1a1.9 1.9 0 1 0 3.8 0V3.6h1.9v5.2h-2.1a1.9 1.9 0 1 0 0 3.8h2.1v7.8h-5.2v-2.1a1.9 1.9 0 1 0-3.8 0v2.1H3.7v-7.8h2.1a1.9 1.9 0 1 0 0-3.8H3.7V3.6z'/>`, 1),
  image: () => _svg(`<rect x='2.6' y='4.4' width='18.8' height='15.2' rx='2'/><path d='m4.6 17.4 4.5-5.1 3.2 3.4 3-2.6 4.1 4.3'/><circle cx='8.9' cy='9.3' r='1.5'/>`, 1),
  trash: () => _svg(`<path d='M4.6 6.6h14.8M9.6 6.6V4.8h4.8v1.8M6.6 6.6l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l.9-12.1'/>`, 1),
};

// ползунок: ширину «залитой» части задаём переменной --p (CSS сам красит дорожку)
function _sliderFill(el) {
  const mn = +el.min || 0, mx = (el.max === '' || el.max == null) ? 100 : +el.max;
  el.style.setProperty('--p', (mx > mn ? (el.value - mn) / (mx - mn) * 100 : 0).toFixed(2) + '%');
}
function _syncSliders() { if (_menuEl) _menuEl.querySelectorAll('.mm-slider').forEach(_sliderFill); }

const _PANE_TITLE = () => ({
  new: 'New Game', scn: 'Scenarios', save: 'Save Game',
  load: 'Load Game', ach: 'Achievements', set: 'Settings',
  net: 'Multiplayer', wsb: 'Workshop', mods: 'Installed add-ons', modedit: 'Add-on editor', cred: 'Credits',
});

function _buildMenu() {
  if (_menuEl) return _menuEl;
  const css = document.createElement('style'); css.textContent = `
  #main-menu{position:fixed;inset:0;z-index:400;display:none;align-items:center;gap:clamp(16px,3.4vw,64px);
    padding:0 clamp(16px,3.6vw,58px);background:#03070f;overflow:hidden;
    font-family:${UI_FONT};color:#d8e6f8;-webkit-font-smoothing:antialiased}
  #main-menu.show{display:flex;animation:mmFade .3s ease both}
  #main-menu.still .mm-bg{animation:none;will-change:auto}   /* слабая графика: «наезд» фона — это постоянная перекомпоновка экрана на весь кадр */
  @keyframes mmFade{from{opacity:0}to{opacity:1}}
  /* фон: фото Земли + очень медленный «наезд», чтобы кадр не был мёртвым */
  .mm-bg{position:absolute;inset:0;background:#03070f url('tex/menu_bg.jpg') center/cover no-repeat;
    transform-origin:66% 46%;animation:mmDrift 78s ease-in-out infinite alternate;will-change:transform}
  @keyframes mmDrift{from{transform:scale(1.015)}to{transform:scale(1.075)}}
  /* левый градиент: гарантирует контраст текста, куда бы cover ни сдвинул кадр */
  .mm-veil{position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(100deg,rgba(2,6,14,.95) 0%,rgba(2,6,14,.88) 22%,rgba(2,6,14,.55) 42%,rgba(2,6,14,.08) 62%,rgba(2,6,14,0) 78%),
      radial-gradient(120% 90% at 50% 50%,rgba(0,0,0,0) 55%,rgba(0,0,0,.45) 100%)}
  .mm-dim{position:absolute;inset:0;pointer-events:none;background:rgba(2,6,14,.42);opacity:0;transition:opacity .25s}
  #main-menu.pane .mm-dim{opacity:1}
  @media (prefers-reduced-motion:reduce){.mm-bg{animation:none}#main-menu.show{animation:none}}

  /* ---- левая колонка ---- */
  .mm-side{position:relative;z-index:2;flex:none;width:clamp(248px,22vw,352px);max-height:100vh;
    display:flex;flex-direction:column;justify-content:center;padding:clamp(10px,2.4vh,26px) 0}
  .mm-logo{width:100%;display:block;margin:0 0 clamp(14px,3.2vh,34px);
    filter:drop-shadow(0 8px 30px rgba(46,124,214,.35))}
  .mm-nav{display:flex;flex-direction:column;gap:clamp(6px,1.05vh,11px)}
  .mm-item{position:relative;display:flex;align-items:center;gap:0;width:100%;box-sizing:border-box;
    height:clamp(42px,5.4vh,56px);padding:0 16px;border-radius:0;cursor:pointer;text-align:left;
    font:600 clamp(13px,1.62vh,15.5px)/1 ${UI_FONT};letter-spacing:.2px;color:#c8daf0;
    background:linear-gradient(180deg,rgba(17,36,64,.62),rgba(7,16,32,.74));
    border:1px solid rgba(70,130,200,.42);
    box-shadow:inset 0 1px 0 rgba(150,205,255,.10),0 6px 18px rgba(0,0,0,.35);transition:.15s}
  .mm-item:hover{color:#fff;border-color:rgba(120,190,255,.9);
    background:linear-gradient(180deg,rgba(26,58,102,.78),rgba(11,26,50,.84));
    box-shadow:inset 0 1px 0 rgba(170,215,255,.2),0 0 20px rgba(48,128,220,.35)}
  .mm-item.on,.mm-item.primary{color:#fff;border-color:#7cc2ff;
    background:linear-gradient(180deg,#2f88e6,#134f9e);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 0 24px rgba(45,130,225,.5)}
  .mm-item .mi-ic{flex:none;width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:#3f9ae8}
  .mm-item:hover .mi-ic{color:#7ac2ff}
  .mm-item.on .mi-ic,.mm-item.primary .mi-ic{color:#fff}
  .mm-item.quit .mi-ic{color:#e0313c}
  .mm-item.quit:hover{border-color:rgba(230,90,100,.85);box-shadow:inset 0 1px 0 rgba(255,190,195,.16),0 0 20px rgba(190,45,55,.35)}
  .mm-ic{width:22px;height:22px;display:block}
  .mm-ver{font-size:10.5px;letter-spacing:.6px;color:#5a6d8c;margin-top:clamp(10px,2vh,20px);text-align:center}

  /* ---- диалог ---- */
  .mm-dialog{position:relative;z-index:2;flex:1;min-width:0;max-width:1010px;max-height:90vh;
    display:none;flex-direction:column;box-sizing:border-box;padding:clamp(12px,2vh,20px) clamp(14px,1.6vw,24px) clamp(12px,1.8vh,18px);
    border-radius:0;border:1px solid rgba(78,140,212,.45);
    background:linear-gradient(180deg,rgba(11,26,48,.92),rgba(4,11,23,.95));
    box-shadow:0 34px 100px rgba(0,0,0,.65),inset 0 1px 0 rgba(140,198,255,.14)}
  .mm-dialog.show{display:flex;animation:mmPop .26s cubic-bezier(.2,.9,.3,1) both}
  @keyframes mmPop{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
  /* блик по верхней кромке — фирменная деталь макета */
  .mm-dialog::before{content:'';position:absolute;left:14%;right:14%;top:-1px;height:2px;border-radius:0;
    background:linear-gradient(90deg,transparent,rgba(150,210,255,.95),transparent)}
  .mmd-head{position:relative;flex:none;display:flex;align-items:center;justify-content:center;
    padding:6px 52px clamp(10px,1.6vh,16px)}
  .mmd-title{font:600 clamp(17px,2.5vh,25px)/1.1 ${UI_FONT};letter-spacing:2.4px;
    text-transform:uppercase;color:#eaf3ff;text-shadow:0 2px 20px rgba(60,145,235,.5)}
  .mmd-x{position:absolute;right:0;top:-2px;width:42px;height:42px;display:flex;align-items:center;justify-content:center;
    border-radius:0;cursor:pointer;color:#cfe2f7;border:1px solid rgba(78,140,212,.5);
    background:linear-gradient(180deg,rgba(18,38,66,.8),rgba(8,18,36,.86));transition:.14s}
  .mmd-x:hover{color:#fff;border-color:#7cc2ff;box-shadow:0 0 16px rgba(50,130,220,.4)}
  .mmd-body{flex:1;min-height:0;overflow:auto;padding:2px 6px 2px 2px}
  .mmd-foot{flex:none;display:none;justify-content:center;gap:12px;flex-wrap:wrap;
    padding-top:clamp(10px,1.8vh,16px);margin-top:clamp(8px,1.4vh,14px);border-top:1px solid rgba(78,140,212,.25)}
  .mmd-foot.show{display:flex}
  .fpane{display:none;gap:12px;flex-wrap:wrap;justify-content:center}
  .fpane.on{display:flex}
  .mm-pane{display:none}.mm-pane.on{display:block}

  /* ---- группы-панели ---- */
  .mm-group{position:relative;border-radius:0;border:1px solid rgba(70,130,200,.36);
    background:linear-gradient(180deg,rgba(13,30,54,.55),rgba(5,13,26,.62))}
  .mm-group::before{content:'';position:absolute;left:22%;right:22%;top:-1px;height:1.5px;border-radius:0;
    background:linear-gradient(90deg,transparent,rgba(130,195,255,.6),transparent)}
  .mm-group>h4{display:flex;align-items:center;gap:11px;margin:0;padding:12px 15px;
    font:600 14.5px/1.2 ${UI_FONT};color:#e7f1ff;border-bottom:1px solid rgba(70,130,200,.26)}
  .mm-group>h4 .mm-ic{color:#3f9ae8}
  .mm-group>.gb{padding:13px 15px 15px}
  .set-grid{display:grid;grid-template-columns:1fr 1.32fr;gap:13px;margin-bottom:13px}
  .set-grid.eq{grid-template-columns:1fr 1fr;margin-bottom:0}

  /* ---- контролы ---- */
  .mm-chk,.mm-rad{display:flex;align-items:center;gap:12px;margin:11px 0;font-size:14px;color:#d5e4f7;cursor:pointer;user-select:none}
  .mm-chk:first-child,.mm-rad:first-child{margin-top:2px}
  /* языки: родные названия в две колонки (17 пунктов в один столбец не влезли бы); название обрезается многоточием, полное — в подсказке */
  .lang-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 8px}
  .lang-grid .mm-rad{margin:6px 0;gap:9px;min-width:0;font-size:13px}.lang-grid .mm-rad:first-child{margin-top:6px}
  .lang-grid .ln{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mm-chk input,.mm-rad input{position:absolute;opacity:0;width:0;height:0}
  .mm-chk .bx{flex:none;width:21px;height:21px;border-radius:0;position:relative;transition:.14s;
    border:1.6px solid rgba(88,152,222,.75);background:rgba(6,16,32,.6)}
  .mm-chk input:checked+.bx{border-color:#7cc2ff;background:linear-gradient(180deg,#2f8ae6,#1861bb);box-shadow:0 0 12px rgba(48,138,230,.5)}
  .mm-chk input:checked+.bx::after{content:'';position:absolute;left:6.5px;top:2.6px;width:5px;height:10px;
    border:solid #fff;border-width:0 2.4px 2.4px 0;transform:rotate(43deg)}
  .mm-rad .dot{flex:none;width:21px;height:21px;border-radius:50%;position:relative;transition:.14s;
    border:1.6px solid rgba(88,152,222,.75);background:rgba(6,16,32,.6)}
  .mm-rad input:checked+.dot{border-color:#7cc2ff;box-shadow:0 0 12px rgba(48,138,230,.45)}
  .mm-rad input:checked+.dot::after{content:'';position:absolute;inset:3.6px;border-radius:50%;
    background:radial-gradient(circle at 34% 30%,#bfe2ff,#2f8ae6)}
  .mm-chk:hover .bx,.mm-rad:hover .dot{border-color:#8fcbff}
  .mm-chk input:focus-visible+.bx,.mm-rad input:focus-visible+.dot{outline:2px solid #7cc2ff;outline-offset:2px}

  .mm-rad.has-note{align-items:flex-start}
  .mm-rad.has-note .dot{margin-top:1px}
  .rad-txt{display:flex;flex-direction:column;gap:3px;line-height:1.25}
  .gfx-note{font-size:11px;color:#7b90ad}
  .me-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:13px;border-bottom:1px solid rgba(70,130,200,.28);padding-bottom:10px}
  .me-tab{padding:8px 15px;cursor:pointer;font:600 13px/1 ${UI_FONT};color:#a8bcd6;
    border:1px solid rgba(70,130,200,.4);background:linear-gradient(180deg,rgba(17,36,64,.6),rgba(7,16,32,.72));transition:.13s}
  .me-tab:hover{color:#fff;border-color:#7cc2ff}
  .me-tab.on{color:#fff;border-color:#7cc2ff;background:linear-gradient(180deg,#2f88e6,#134f9e)}
  .me-def{font-size:11.5px;color:#7b90ad;white-space:nowrap}
  .me-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:#9fb6d2}
  .me-era{display:grid;grid-template-columns:28px 1.25fr 1.25fr repeat(5,minmax(54px,.66fr)) 46px;gap:6px;align-items:center;margin:5px 0}
  .me-emove{display:flex;gap:2px}
  .me-emove button{width:21px;height:26px;cursor:pointer;font-size:12px;color:#bcd4ee;
    border:1px solid rgba(70,130,200,.45);background:linear-gradient(180deg,rgba(17,36,64,.7),rgba(7,16,32,.8))}
  .me-emove button:hover{color:#fff;border-color:#7cc2ff}
  .me-era .mm-inp{width:100%;min-width:0;padding:7px 8px}
  .me-erahead{font-size:11px;color:#7b90ad;text-transform:uppercase;letter-spacing:.4px}
  .me-erahead span{overflow:hidden;text-overflow:ellipsis}
  .me-eno{color:#6fb4f0;font-weight:700;text-align:center}
  .me-cols{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
  .me-col{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#c2d3e8;cursor:pointer;padding:4px 6px;border:1px solid transparent}
  .me-col.set{border-color:rgba(124,194,255,.6)}
  .me-col input[type=color]{width:34px;height:24px;padding:0;border:1px solid rgba(70,130,200,.5);background:none;cursor:pointer}
  .mm-row input[type=color]{width:44px;height:30px;padding:0;border:1px solid rgba(70,130,200,.5);background:none;cursor:pointer}
  .me-goal{display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap}
  .me-goal .mm-inp{flex:1;min-width:120px}
  .me-goal .mm-inp.num{flex:none;width:110px}
  .me-goal .mm-sel{flex:none;width:210px}
  .me-goal .mm-chk{margin:0;font-size:12.5px;white-space:nowrap}
  .me-goal .me-del{flex:none;width:32px;height:32px;border-radius:0;cursor:pointer;color:#f0a8ae;
    border:1px solid rgba(190,70,80,.5);background:linear-gradient(180deg,rgba(70,18,24,.6),rgba(40,10,14,.7))}
  .me-goal .me-del:hover{color:#fff;border-color:#e46873}
  .mm-group>h4 .mm-sel{min-height:34px;padding:6px 30px 6px 10px;font-size:13px}
  .sl-lab{font-size:13px;color:#a8bcd6;margin:14px 0 6px}
  .np-row{display:flex;align-items:center;gap:10px}
  .np-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 13.5px/1.3 ${UI_FONT};color:#e8f2ff}
  .np-name small{font-weight:400;color:#8aa0bf;margin-left:6px}
  .mm-btn.np-next{min-height:34px;padding:0 14px;font-size:13px}
  .np-sel{width:100%;margin-top:8px}
  /* наборы настроек «Новой игры»: заголовок, список и компактные кнопки одной строкой — раздел не должен
     уехать под прокрутку из-за новой группы (на широком окне строка одна, на узком переносится) */
  .ng-head{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;padding:10px 15px}
  .ng-head .ng-t{display:flex;align-items:center;gap:11px;flex:none;font:600 14.5px/1.2 ${UI_FONT};color:#e7f1ff;white-space:nowrap;cursor:help}
  .ng-head .ng-t .mm-ic{color:#3f9ae8}
  .ng-head .ng-row{flex:1 1 440px;min-width:0}
  .ng-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .ng-row .mm-sel,.ng-row .mm-inp{flex:1 1 220px;min-width:0;min-height:36px;padding-top:7px;padding-bottom:7px}
  .ng-row .mm-btn{min-height:36px;padding:0 13px;font-size:13px}
  .ng-row .mm-btn:disabled,.ng-row .mm-btn:disabled:hover{opacity:.42;cursor:default;box-shadow:none;color:#8aa0bf;border-color:rgba(70,130,200,.35)}
  .ng-row .mm-btn.del{width:38px;padding:0;color:#f0a8ae;border-color:rgba(190,70,80,.5)}
  .ng-row .mm-btn.del .mm-ic{width:18px;height:18px;color:#f0a8ae}
  .ng-row .mm-btn.del:hover:not(:disabled){color:#fff;border-color:#e46873;box-shadow:0 0 14px rgba(200,50,60,.35)}
  .ng-row .mm-btn.del:hover:not(:disabled) .mm-ic{color:#fff}
  .sl-row{display:flex;align-items:center;gap:11px}
  .sl-row .mm-ic{flex:none;color:#8fb6dd;width:20px;height:20px}
  .sl-row .val{flex:none;width:48px;text-align:right;font:600 13px/1 ${UI_FONT};color:#cfe4fb}
  .mm-slider{-webkit-appearance:none;appearance:none;flex:1;min-width:60px;height:20px;background:transparent;cursor:pointer}
  .mm-slider::-webkit-slider-runnable-track{height:6px;border-radius:0;
    background:linear-gradient(90deg,#3f9ce9 0 var(--p,50%),rgba(140,175,215,.22) var(--p,50%) 100%)}
  .mm-slider::-webkit-slider-thumb{-webkit-appearance:none;width:17px;height:17px;margin-top:-5.5px;border-radius:50%;border:none;
    background:radial-gradient(circle at 35% 32%,#fff,#c6d9ee);box-shadow:0 0 10px rgba(90,170,255,.75),0 2px 5px rgba(0,0,0,.5)}
  .mm-slider::-moz-range-track{height:6px;border-radius:0;background:rgba(140,175,215,.22)}
  .mm-slider::-moz-range-progress{height:6px;border-radius:0;background:#3f9ce9}
  .mm-slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;border:none;background:#e8f1fb;box-shadow:0 0 10px rgba(90,170,255,.7)}
  .mm-slider:focus-visible{outline:2px solid #7cc2ff;outline-offset:3px;border-radius:0}

  .mm-row{display:flex;align-items:center;gap:10px;margin:11px 0}
  .mm-row>label{flex:none;width:132px;font-size:13px;color:#a8bcd6}
  .mm-row .val{flex:none;width:52px;text-align:right;font:600 13px/1 ${UI_FONT};color:#cfe4fb}
  .mm-inp,.mm-sel{box-sizing:border-box;color:#dbe9fb;border-radius:0;padding:9px 12px;font:400 13.5px/1.2 ${UI_FONT};
    border:1px solid rgba(70,130,200,.45);background:linear-gradient(180deg,rgba(16,34,60,.8),rgba(7,17,34,.86));transition:.14s}
  .mm-inp:hover,.mm-sel:hover{border-color:rgba(120,190,255,.75)}
  .mm-inp:focus,.mm-sel:focus{outline:none;border-color:#7cc2ff;box-shadow:0 0 0 3px rgba(48,138,230,.2)}
  .mm-inp.num{width:78px;text-align:center}
  .mm-sel{appearance:none;-webkit-appearance:none;padding-right:32px;cursor:pointer;
    background-image:url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234f9ce8' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"),linear-gradient(180deg,rgba(16,34,60,.8),rgba(7,17,34,.86));
    background-repeat:no-repeat,repeat;background-position:right 9px center,0 0;background-size:15px,auto}
  .mm-sel option{background:#0b1c33;color:#dbe9fb}

  .mm-btn{display:inline-flex;align-items:center;justify-content:center;gap:0;box-sizing:border-box;
    min-height:42px;padding:0 20px;border-radius:0;cursor:pointer;text-align:center;
    font:600 14px/1.2 ${UI_FONT};color:#cfe2f7;
    border:1px solid rgba(70,130,200,.5);background:linear-gradient(180deg,rgba(18,38,66,.8),rgba(8,18,36,.86));transition:.14s}
  .mm-btn:hover{color:#fff;border-color:#7cc2ff;box-shadow:0 0 18px rgba(50,130,220,.35)}
  .mm-btn .mm-ic{width:20px;height:20px;color:#4f9ce8}
  .mm-btn:hover .mm-ic{color:#8ecbff}
  .mm-btn.go{color:#fff;border-color:#7cc2ff;background:linear-gradient(180deg,#2f88e6,#134f9e);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.32),0 0 22px rgba(45,130,225,.42)}
  .mm-btn.go .mm-ic,.mm-btn.go:hover .mm-ic{color:#fff}
  .mm-btn.go:hover{filter:brightness(1.12)}
  .mm-btn.alt{color:#e8f2ff;border-color:rgba(124,194,255,.85);background:linear-gradient(180deg,rgba(30,70,120,.7),rgba(12,30,58,.8))}
  .mm-btn.wide{width:100%}
  .mm-cred{text-align:center;padding:6px 10px 2px}
  .mm-cred-game{font-size:22px;font-weight:700;color:#e8f2ff;letter-spacing:.5px;margin-bottom:14px}
  .mm-cred-sec{margin:0 auto 16px;max-width:520px}
  .mm-cred-h{font-size:11px;text-transform:uppercase;letter-spacing:1.4px;color:#8aa0bf;margin-bottom:4px}
  .mm-cred-n{font-size:18px;font-weight:600;color:#dbe7f7;margin-bottom:6px}
  .mm-cred-t{font-size:13px;line-height:1.55;color:#c4d4ea;margin-bottom:6px}
  .mm-cred .mm-btn{min-height:32px;padding:0 14px;font-size:12.5px}
  .mm-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
  .mm-hint{font-size:11.5px;line-height:1.5;color:#7b90ad;margin-top:10px}

  /* ---- сохранения ---- */
  /* прокрутка в диалоге одна — у .mmd-body; списки внутри не заводят второй скролл */
  .mm-saves{border:1px solid rgba(70,130,200,.28);border-radius:0;margin:10px 0;background:rgba(3,10,22,.42);overflow:hidden}
  .mm-save{display:flex;align-items:center;gap:12px;padding:9px 11px;font-size:13.5px;
    border-bottom:1px solid rgba(70,130,200,.16);transition:.13s}
  .mm-save:last-child{border-bottom:none}
  .mm-save:hover{background:rgba(45,120,210,.12)}
  .mm-save img{flex:none;width:66px;height:50px;border-radius:0;object-fit:cover;image-rendering:pixelated;
    border:1px solid rgba(70,130,200,.45);background:#07223f}
  .mm-save .nm{flex:1;min-width:0}
  .mm-save .nm b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e4eefc;font-weight:600}
  .mm-save .nm span{font-size:11.5px;color:#87a0c0}
  .mm-save button{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:0;cursor:pointer;
    font:600 12.5px/1 ${UI_FONT};color:#cfe2f7;border:1px solid rgba(70,130,200,.45);
    background:linear-gradient(180deg,rgba(18,38,66,.8),rgba(8,18,36,.86));transition:.13s}
  .mm-save button:hover{color:#fff;border-color:#7cc2ff;box-shadow:0 0 14px rgba(50,130,220,.3)}
  .mm-save button.del{color:#f0a8ae;border-color:rgba(190,70,80,.5)}
  .mm-save button.del:hover{color:#fff;border-color:#e46873;box-shadow:0 0 14px rgba(200,50,60,.35)}
  .mm-save button.del .mm-ic{width:17px;height:17px}
  .mm-empty{padding:16px;text-align:center;font-size:13px;color:#7b90ad}

  /* ---- сценарии ---- */
  .scn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(238px,1fr));gap:11px}
  .scn-card{position:relative;padding:14px 15px;border-radius:0;cursor:pointer;transition:.15s;
    border:1px solid rgba(70,130,200,.32);background:linear-gradient(180deg,rgba(13,30,54,.55),rgba(5,13,26,.62))}
  .scn-card:hover{border-color:#7cc2ff;transform:translateY(-2px);
    background:linear-gradient(180deg,rgba(26,58,102,.6),rgba(9,22,42,.7));box-shadow:0 0 22px rgba(48,128,220,.28)}
  .scn-card .sc-done{position:absolute;top:10px;right:11px;font:600 10.5px/1 ${UI_FONT};letter-spacing:.6px;text-transform:uppercase;color:#6fb4f0;border:1px solid rgba(90,170,255,.5);padding:3px 6px}
  .scn-card .sc-nm{font:600 14.5px/1.25 ${UI_FONT};color:#e7f1ff;margin:7px 0 4px}
  .scn-card .sc-d{font-size:11.8px;line-height:1.45;color:#93a9c6}

  /* ---- достижения ---- */
  .ach-sum{font:600 13px/1 ${UI_FONT};color:#6fb4f0;margin:2px 0 11px}
  .ach-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:9px}
  .ach-item{display:grid;grid-template-columns:34px 1fr;grid-template-rows:auto auto;gap:0 9px;padding:9px 11px;border-radius:0;
    border:1px solid rgba(70,130,200,.2);background:rgba(5,13,26,.5);opacity:.5}
  .ach-item.on{opacity:1;border-color:rgba(90,170,255,.5);box-shadow:0 0 14px rgba(48,128,220,.16)}
  .ach-item .ai-ic{grid-row:1/3;font-size:21px;align-self:center;text-align:center}
  .ach-item .ai-nm{font:600 12.5px/1.25 ${UI_FONT};color:#d5e4f7}
  .ach-item.on .ai-nm{color:#6fb4f0}
  .ach-item .ai-d{font-size:10.5px;line-height:1.35;color:#8399b5}

  /* ---- скроллбары внутри меню ---- */
  #main-menu ::-webkit-scrollbar{width:10px;height:10px}
  #main-menu ::-webkit-scrollbar-track{background:rgba(4,11,22,.5);border-radius:0}
  #main-menu ::-webkit-scrollbar-thumb{border-radius:0;border:2px solid transparent;background-clip:padding-box;
    background-color:rgba(58,130,210,.7)}
  #main-menu ::-webkit-scrollbar-thumb:hover{background-color:rgba(96,175,255,.85)}

  /* =====================  UI polish layer  ===================== */
  #main-menu{--r-sm:8px;--r-md:11px;--r-lg:18px;--acc:#5db0ff;--line:rgba(96,160,230,.30)}
  .mm-veil{background:linear-gradient(100deg,rgba(2,6,14,.96) 0%,rgba(2,6,14,.90) 24%,rgba(2,6,14,.60) 44%,rgba(2,6,14,.10) 64%,rgba(2,6,14,0) 80%),
      radial-gradient(120% 90% at 50% 50%,rgba(0,0,0,0) 55%,rgba(0,0,0,.5) 100%)}
  .mm-dim{backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}

  /* side menu: rounded glass buttons with an accent bar and a soft slide-in */
  .mm-logo{filter:drop-shadow(0 10px 34px rgba(46,124,214,.45))}
  .mm-item{border-radius:var(--r-md);overflow:hidden;padding-left:20px;
    backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    transition:transform .18s cubic-bezier(.2,.8,.2,1),background .18s,border-color .18s,box-shadow .18s,color .18s}
  .mm-item::before{content:'';position:absolute;left:0;top:24%;bottom:24%;width:3px;border-radius:0 3px 3px 0;
    background:var(--acc);opacity:0;transform:scaleY(.3);transition:.2s}
  .mm-item:hover::before,.mm-item.on::before{opacity:1;transform:none}
  .mm-item.on::before,.mm-item.primary::before{background:#fff}
  .mm-item:hover{transform:translateX(5px)}
  .mm-item:active{transform:translateX(2px) scale(.99)}
  .mm-item.on,.mm-item.primary{background:linear-gradient(135deg,#3d97f2 0%,#1a63c4 60%,#134f9e 100%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 8px 26px rgba(40,125,230,.45)}
  .mm-item.quit::before{background:#ff6b78}
  #main-menu.show .mm-item{animation:mmSlide .5s cubic-bezier(.2,.8,.2,1) backwards}
  #main-menu.show .mm-item:nth-child(1){animation-delay:.02s}#main-menu.show .mm-item:nth-child(2){animation-delay:.06s}
  #main-menu.show .mm-item:nth-child(3){animation-delay:.10s}#main-menu.show .mm-item:nth-child(4){animation-delay:.14s}
  #main-menu.show .mm-item:nth-child(5){animation-delay:.18s}#main-menu.show .mm-item:nth-child(6){animation-delay:.22s}
  #main-menu.show .mm-item:nth-child(7){animation-delay:.26s}#main-menu.show .mm-item:nth-child(8){animation-delay:.30s}
  #main-menu.show .mm-item:nth-child(9){animation-delay:.34s}#main-menu.show .mm-item:nth-child(10){animation-delay:.38s}
  #main-menu.show .mm-item:nth-child(11){animation-delay:.42s}
  @keyframes mmSlide{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){#main-menu.show .mm-item{animation:none}.mm-item:hover{transform:none}}
  .mm-ver{display:table;margin:clamp(10px,2vh,18px) auto 0;padding:5px 12px;border-radius:99px;
    border:1px solid var(--line);background:rgba(8,20,40,.55);color:#7f95b6}
  .mm-patch{margin:9px auto 0;max-width:290px;font-size:10.5px;line-height:1.5;text-align:center;color:#86a6cf;opacity:.9}

  /* dialog: frosted glass panel */
  .mm-dialog{border-radius:var(--r-lg);border-color:rgba(96,160,230,.42);
    background:linear-gradient(180deg,rgba(13,30,54,.80),rgba(4,11,23,.90));
    backdrop-filter:blur(22px) saturate(1.25);-webkit-backdrop-filter:blur(22px) saturate(1.25);
    box-shadow:0 40px 110px rgba(0,0,0,.65),0 0 0 1px rgba(150,205,255,.05),inset 0 1px 0 rgba(160,210,255,.16)}
  .mm-dialog::before{left:18%;right:18%;border-radius:2px}
  .mmd-title{letter-spacing:3px;background:linear-gradient(180deg,#ffffff,#b6d6f7);-webkit-background-clip:text;background-clip:text;
    -webkit-text-fill-color:transparent;text-shadow:none;filter:drop-shadow(0 2px 14px rgba(60,145,235,.55))}
  .mmd-head::after{content:'';position:absolute;left:50%;bottom:0;width:64px;height:2px;margin-left:-32px;border-radius:2px;
    background:linear-gradient(90deg,transparent,var(--acc),transparent);opacity:.8}
  .mmd-x{border-radius:50%;width:38px;height:38px;top:0}
  .mmd-x:hover{transform:rotate(90deg);background:linear-gradient(180deg,rgba(60,30,40,.85),rgba(30,12,18,.9));border-color:#ff8a96}
  .mmd-x{transition:transform .22s,color .14s,border-color .14s,box-shadow .14s,background .14s}
  .mmd-foot{border-top-color:var(--line)}

  /* groups, inputs, buttons */
  .mm-group{border-radius:14px;border-color:var(--line);
    background:linear-gradient(180deg,rgba(14,32,58,.50),rgba(5,13,26,.58));box-shadow:0 8px 24px rgba(0,0,0,.22)}
  .mm-group::before{border-radius:2px}
  .mm-group>h4{border-radius:14px 14px 0 0;border-bottom-color:var(--line);
    background:linear-gradient(180deg,rgba(70,130,210,.16),rgba(70,130,210,.03))}
  .set-grid.one{grid-template-columns:1fr}
  .mm-btn,.mm-inp,.mm-sel{border-radius:var(--r-md)}
  .mm-btn{transition:transform .15s,background .15s,border-color .15s,box-shadow .15s,filter .15s,color .15s}
  .mm-btn:hover{transform:translateY(-1px)}
  .mm-btn:active{transform:translateY(0) scale(.98)}
  .mm-btn:disabled{transform:none}
  .mm-btn.go{background:linear-gradient(135deg,#3d97f2,#1a63c4 65%,#134f9e);box-shadow:inset 0 1px 0 rgba(255,255,255,.38),0 8px 24px rgba(40,125,230,.42)}
  .mm-btn.go:hover{box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 10px 30px rgba(50,140,240,.58)}
  .mm-chk .bx{border-radius:6px}
  .mm-slider::-webkit-slider-runnable-track{border-radius:4px}
  .mm-slider::-moz-range-track,.mm-slider::-moz-range-progress{border-radius:4px}
  .mm-slider::-webkit-slider-thumb{transition:transform .12s}
  .mm-slider:hover::-webkit-slider-thumb{transform:scale(1.15)}
  .me-tab,.kb-tab{border-radius:9px}
  .me-emove button{border-radius:7px}
  .me-goal .me-del{border-radius:9px}
  .me-col,.me-col input[type=color],.mm-row input[type=color]{border-radius:8px}
  .ng-row .mm-btn.del{border-radius:var(--r-md)}

  /* lists, cards */
  .mm-saves{border-radius:14px;border-color:var(--line);background:rgba(3,10,22,.5)}
  .mm-save{padding:10px 13px}
  .mm-save img{border-radius:8px}
  .mm-save button{border-radius:9px}
  .scn-card{border-radius:14px;border-color:var(--line);box-shadow:0 6px 18px rgba(0,0,0,.25)}
  .scn-card:hover{box-shadow:0 12px 30px rgba(48,128,220,.32)}
  .scn-card .sc-done{border-radius:6px}
  .ach-item{border-radius:12px}
  .ach-item.on{background:linear-gradient(180deg,rgba(30,80,140,.28),rgba(8,20,40,.5))}

  /* credits */
  .mm-cred-game{font-size:26px;letter-spacing:1.5px;background:linear-gradient(180deg,#fff,#a9cff6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .mm-cred-sec{padding-bottom:16px;border-bottom:1px solid rgba(96,160,230,.14)}
  .mm-cred-note{margin:6px auto 4px;max-width:520px;padding:11px 16px;font-size:12.5px;line-height:1.5;color:#a9ccf3;
    border:1px dashed rgba(124,194,255,.45);border-radius:12px;background:rgba(40,100,180,.12)}

  /* scrollbars */
  #main-menu ::-webkit-scrollbar-track{border-radius:8px}
  #main-menu ::-webkit-scrollbar-thumb{border-radius:8px}

  /* =====================  ANIMATION LAYER  ===================== */
  /* --- living background: slow zoom + mouse parallax, drifting aurora glow, starfield canvas --- */
  @keyframes mmDrift{from{transform:scale(1.045)}to{transform:scale(1.11)}}
  .mm-bg{translate:calc(var(--px,0) * -10px) calc(var(--py,0) * -7px);transition:translate .6s cubic-bezier(.2,.7,.2,1)}
  #main-menu.still .mm-bg{translate:none}
  .mm-aurora{position:absolute;inset:-12%;pointer-events:none;
    background:radial-gradient(38% 34% at 72% 44%,rgba(60,140,255,.24),transparent 70%),
      radial-gradient(30% 30% at 88% 72%,rgba(130,90,255,.16),transparent 70%),
      radial-gradient(34% 28% at 58% 22%,rgba(40,210,255,.13),transparent 70%);
    animation:mmAurora 18s ease-in-out infinite alternate;will-change:transform,opacity}
  @keyframes mmAurora{0%{transform:translate3d(-2%,1%,0) scale(1);opacity:.75}
    50%{transform:translate3d(2.5%,-2%,0) scale(1.08);opacity:1}100%{transform:translate3d(-1%,2.5%,0) scale(1.03);opacity:.8}}
  .mm-fx{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;
    translate:calc(var(--px,0) * 8px) calc(var(--py,0) * 5px);transition:translate .8s cubic-bezier(.2,.7,.2,1)}
  #main-menu.still .mm-aurora{animation:none}
  #main-menu.still .mm-fx{display:none}

  /* --- logo: blur-in, then a gentle float with a breathing glow --- */
  @keyframes mmLogoIn{from{opacity:0;transform:translateY(-18px) scale(.93);filter:blur(10px) drop-shadow(0 0 0 rgba(46,124,214,0))}
    to{opacity:1;transform:none;filter:blur(0) drop-shadow(0 10px 34px rgba(46,124,214,.45))}}
  @keyframes mmLogoFloat{0%,100%{transform:translateY(0);filter:drop-shadow(0 10px 30px rgba(46,124,214,.38))}
    50%{transform:translateY(-5px);filter:drop-shadow(0 18px 48px rgba(80,160,250,.7))}}
  #main-menu.show .mm-logo{animation:mmLogoIn .9s cubic-bezier(.2,.8,.2,1) backwards,mmLogoFloat 7s ease-in-out .9s infinite}
  #main-menu.still .mm-logo{animation:mmLogoIn .6s ease backwards}

  /* --- side buttons: cursor spotlight + light sweep, icon wiggle, ripple --- */
  .mm-item,.mm-btn{position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent}
  .mm-item::after,.mm-btn::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .2s;
    background:radial-gradient(130px circle at var(--mx,50%) var(--my,50%),rgba(170,215,255,.30),transparent 62%),
      linear-gradient(105deg,transparent 38%,rgba(255,255,255,.26) 50%,transparent 62%);
    background-size:auto,260% 100%;background-position:0 0,160% 0;background-repeat:no-repeat}
  .mm-item:hover::after,.mm-btn:hover::after{opacity:1;animation:mmShine .85s ease-out}
  @keyframes mmShine{from{background-position:0 0,160% 0}to{background-position:0 0,-60% 0}}
  .mm-item:hover .mi-ic,.mm-btn:hover .mm-ic{animation:mmIc .5s cubic-bezier(.3,1.4,.5,1)}
  @keyframes mmIc{0%{transform:none}35%{transform:scale(1.28) rotate(-9deg)}70%{transform:scale(1.1) rotate(5deg)}100%{transform:none}}
  .mm-rip{position:absolute;border-radius:50%;pointer-events:none;opacity:.9;z-index:3;
    background:radial-gradient(circle,rgba(255,255,255,.6),rgba(120,190,255,.28) 45%,transparent 70%);
    transform:translate(-50%,-50%) scale(0);animation:mmRip .7s cubic-bezier(.2,.7,.3,1) forwards}
  @keyframes mmRip{to{transform:translate(-50%,-50%) scale(1);opacity:0}}

  /* --- the highlighted (Continue) button breathes --- */
  @keyframes mmGrad{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
  @keyframes mmPulse{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 8px 26px rgba(40,125,230,.45)}
    50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 10px 44px rgba(80,165,255,.85)}}
  #main-menu.show .mm-item.primary{background-size:230% 230%;
    animation:mmSlide .5s cubic-bezier(.2,.8,.2,1) backwards,mmGrad 7s ease-in-out .8s infinite,mmPulse 3s ease-in-out .8s infinite}
  #main-menu.still .mm-item.primary{animation:mmSlide .5s cubic-bezier(.2,.8,.2,1) backwards}

  /* --- dialog: rises with a slight 3D tilt, its top edge lights up, the title tracks in --- */
  .mm-dialog{transform-origin:50% 100%}
  @keyframes mmPop{from{opacity:0;transform:perspective(1000px) translateY(28px) rotateX(7deg) scale(.955)}
    to{opacity:1;transform:none}}
  .mm-dialog.show{animation:mmPop .5s cubic-bezier(.2,.9,.25,1) both}
  @keyframes mmEdge{from{left:50%;right:50%;opacity:0}to{left:18%;right:18%;opacity:1}}
  .mm-dialog.show::before{animation:mmEdge 1s .1s cubic-bezier(.2,.8,.2,1) both}
  @keyframes mmTitle{from{opacity:0;letter-spacing:13px}to{opacity:1;letter-spacing:3px}}
  .mm-dialog.show .mmd-title{animation:mmTitle .75s cubic-bezier(.2,.8,.2,1) .06s backwards}
  @keyframes mmEdgeGlow{0%,100%{opacity:.5}50%{opacity:1}}
  .mmd-head::after{animation:mmEdgeGlow 3.6s ease-in-out infinite}

  /* --- content inside a section cascades in --- */
  @keyframes mmRise{from{opacity:0;transform:translateY(18px) scale(.985)}to{opacity:1;transform:none}}
  .mm-pane.on:not([data-pane='net']):not([data-pane='modedit']):not([data-pane='wsb'])>*,
  .mm-pane.on:not([data-pane='net']):not([data-pane='modedit']):not([data-pane='wsb']) .set-grid>*,
  .mm-pane.on .scn-card,.mm-pane.on .ach-item,.mm-pane.on .mm-save,.mm-pane.on .mm-cred-sec,.mm-pane.on .mm-cred-note,.mm-pane.on .mm-cred-game{
    animation:mmRise .55s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(.10s + var(--d,0) * .055s)}
  .mm-pane.on>*:nth-child(1),.set-grid>*:nth-child(1),.mm-cred>*:nth-child(1){--d:0}
  .mm-pane.on>*:nth-child(2),.set-grid>*:nth-child(2),.mm-cred>*:nth-child(2){--d:1}
  .mm-pane.on>*:nth-child(3),.set-grid>*:nth-child(3),.mm-cred>*:nth-child(3){--d:2}
  .mm-pane.on>*:nth-child(4),.mm-cred>*:nth-child(4){--d:3}
  .mm-pane.on>*:nth-child(5),.mm-cred>*:nth-child(5){--d:4}
  .mm-pane.on>*:nth-child(6),.mm-cred>*:nth-child(6){--d:5}
  .mm-pane.on>*:nth-child(n+7),.mm-cred>*:nth-child(n+7){--d:6}
  .scn-card:nth-child(1),.ach-item:nth-child(1),.mm-save:nth-child(1){--d:1}
  .scn-card:nth-child(2),.ach-item:nth-child(2),.mm-save:nth-child(2){--d:2}
  .scn-card:nth-child(3),.ach-item:nth-child(3),.mm-save:nth-child(3){--d:3}
  .scn-card:nth-child(4),.ach-item:nth-child(4),.mm-save:nth-child(4){--d:4}
  .scn-card:nth-child(5),.ach-item:nth-child(5),.mm-save:nth-child(5){--d:5}
  .scn-card:nth-child(6),.ach-item:nth-child(6),.mm-save:nth-child(6){--d:6}
  .scn-card:nth-child(7),.ach-item:nth-child(7),.mm-save:nth-child(7){--d:7}
  .scn-card:nth-child(8),.ach-item:nth-child(8),.mm-save:nth-child(8){--d:8}
  .scn-card:nth-child(n+9),.ach-item:nth-child(n+9),.mm-save:nth-child(n+9){--d:9}

  /* --- 3D tilt on scenario cards (driven by the mouse) --- */
  .scn-card{transform:perspective(700px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform .18s ease-out,border-color .15s,background .15s,box-shadow .15s}
  .scn-card:hover{transform:perspective(700px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) translateY(-4px) scale(1.015)}

  /* --- little control animations --- */
  @keyframes mmBx{0%{transform:scale(.78)}55%{transform:scale(1.2)}100%{transform:scale(1)}}
  @keyframes mmTick{from{transform:rotate(43deg) scale(0)}to{transform:rotate(43deg) scale(1)}}
  .mm-chk input:checked+.bx{animation:mmBx .3s cubic-bezier(.3,1.5,.5,1)}
  .mm-chk input:checked+.bx::after{animation:mmTick .25s .05s ease-out backwards}
  .mm-rad input:checked+.dot{animation:mmBx .3s cubic-bezier(.3,1.5,.5,1)}
  .mm-slider:active::-webkit-slider-thumb{transform:scale(1.35);box-shadow:0 0 20px rgba(130,205,255,.95),0 2px 5px rgba(0,0,0,.5)}
  .mm-inp:focus,.mm-sel:focus{box-shadow:0 0 0 4px rgba(48,138,230,.22),0 0 22px rgba(60,150,240,.25)}
  .mm-save:hover img{transform:scale(1.06);transition:transform .2s}
  .mm-save img{transition:transform .2s}
  .ach-item.on .ai-ic{animation:mmBob 3.2s ease-in-out infinite}
  @keyframes mmBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px) scale(1.08)}}
  .mmd-x:active{transform:rotate(90deg) scale(.9)}

  /* --- respect "reduce motion" --- */
  @media (prefers-reduced-motion:reduce){
    #main-menu *,#main-menu *::before,#main-menu *::after{animation:none !important;transition-duration:.01ms !important}
    .mm-aurora,.mm-fx{display:none}}

  /* --- Workshop browser pane --- */
  .wsb-bar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
  .wsb-bar .mm-btn{min-height:36px;padding:0 13px;font-size:13px}
  .wsb-bar .mm-btn.sq{width:38px;padding:0;font-size:17px}
  .wsb-url{flex:1 1 180px;min-width:0;min-height:36px;color:#9fb6d2;font-size:12.5px;text-overflow:ellipsis}
  .wsb-view{position:relative;height:clamp(260px,48vh,580px);border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#0a1220;box-shadow:0 10px 30px rgba(0,0,0,.35)}
  .wsb-view webview{display:block;width:100%;height:100%}
  .wsb-load{position:absolute;left:0;top:0;right:0;height:3px;z-index:2;opacity:0;transition:opacity .2s;pointer-events:none;
    background:linear-gradient(90deg,transparent,#7cc2ff,transparent) no-repeat;background-size:40% 100%;animation:wsbLoad 1.1s linear infinite}
  .wsb-view.loading .wsb-load{opacity:1}
  @keyframes wsbLoad{from{background-position:-40% 0}to{background-position:140% 0}}
  .wsb-fb{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;text-align:center;color:#c4d4ea;font-size:13px;line-height:1.5}
  .wsb-dl{margin-top:12px}
  .wsb-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .wsb-row .mm-inp{flex:1 1 260px;min-width:0;min-height:38px}
  .wsb-row .mm-btn{min-height:38px;padding:0 14px;font-size:13px}
  .wsb-row .mm-btn:disabled{opacity:.42;cursor:default;transform:none}
  .wsb-opts{margin-top:9px}.wsb-opts .mm-chk{margin:0;font-size:12.5px;color:#a8bcd6}
  .wsb-item{padding:10px 13px;margin-top:9px;border:1px solid var(--line);border-radius:12px;background:rgba(3,10,22,.5);animation:mmRise .4s cubic-bezier(.2,.8,.2,1) backwards}
  .wsb-item.ok{border-color:rgba(100,220,150,.45)}.wsb-item.bad{border-color:rgba(230,100,115,.5)}.wsb-item.skip{opacity:.6}
  .wsb-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
  .wsb-top b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e4eefc;font-size:13.5px}
  .wsb-top .s{flex:none;max-width:60%;text-align:right;font-size:12px;color:#9fb6d2}
  .wsb-top .s.ok{color:#7be0a0}.wsb-top .s.bad{color:#ff9aa4}
  .wsb-prog{height:5px;border-radius:3px;background:rgba(140,175,215,.2);overflow:hidden;margin-top:8px}
  .wsb-prog i{display:block;height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,#3f9ce9,#8ecbff);transition:width .15s}
  .wsb-prog.ind i{width:35%;animation:wsbInd 1.2s ease-in-out infinite}
  @keyframes wsbInd{0%{margin-left:-35%}100%{margin-left:100%}}
  .wsb-ln{margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11.5px/1.4 Consolas,monospace;color:#7b90ad}.wsb-ln:empty{display:none}
  .wsb-msg{margin-top:8px;font-size:12.5px;line-height:1.5;color:#c4d4ea}
  .wsb-acts{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}.wsb-acts:empty{display:none}
  .wsb-acts .mm-btn{min-height:34px;padding:0 14px;font-size:13px}

  @media (max-width:1080px){.set-grid,.set-grid.eq{grid-template-columns:1fr}}
  @media (max-width:820px){#main-menu{flex-direction:column;justify-content:center;gap:14px;padding:14px}
    .mm-side{width:min(360px,92vw);max-height:none}.mm-dialog{width:100%;max-height:56vh}}`;
  document.head.appendChild(css);

  const quitBtn = _isDesktop() ? `<button class='mm-item quit' data-pane='quit'>Quit</button>` : '';
  const m = document.createElement('div'); m.id = 'main-menu';
  m.innerHTML = `<div class='mm-bg'></div><div class='mm-aurora'></div><canvas class='mm-fx'></canvas><div class='mm-veil'></div><div class='mm-dim'></div>
  <div class='mm-side'>
    <img class='mm-logo' src='tex/menu_logo.png' alt='Earth Simulator'>
    <div class='mm-nav'>
      <button class='mm-item' data-pane='continue'>Continue</button>
      <button class='mm-item' data-pane='new'>New Game</button>
      <button class='mm-item' data-pane='scn'>Scenarios</button>
      ${(typeof demoOn === 'function' && demoOn()) ? '' : `<button class='mm-item' data-pane='net'>Multiplayer</button>`}
      <button class='mm-item' data-pane='save'>Save</button>
      <button class='mm-item' data-pane='load'>Load</button>
      <button class='mm-item' data-pane='ach'>Achievements</button>
      <button class='mm-item' data-pane='mods'>Workshop</button>
      <button class='mm-item' data-pane='set'>Settings</button>
      <button class='mm-item' data-pane='cred'>Credits</button>
      ${quitBtn}
    </div>
    <div class='mm-ver'>Earth Simulator · Steam Edition · v${typeof GAME_VERSION !== 'undefined' ? GAME_VERSION : '2.0'}</div>
    <div class='mm-patch'>(Demomode patch by @Swedishush on TikTok, UI patch by me too.)</div>
  </div>
  <div class='mm-dialog' id='mm-dialog'>
    <div class='mmd-head'>
      <div class='mmd-title' id='mmd-title'></div>
      <button class='mmd-x' id='mmd-x' title='Close'>${MM_IC.close()}</button>
    </div>
    <div class='mmd-body'>

      <div class='mm-pane' data-pane='new'>
        <div class='mm-group' id='mm-preset-box' style='margin-bottom:13px'><div class='ng-head'>
          <span class='ng-t' title='${NG_HINT()}'>${MM_IC.save()}Setting presets</span>
          <div class='ng-row' id='mm-preset-row'>
            <select id='mm-preset' class='mm-sel' title='The chosen preset fills in the settings below at once. ${NG_HINT()}'></select>
            <button class='mm-btn' id='mm-preset-save' title='Keep the settings below under a name of your own'>Save…</button>
            <button class='mm-btn' id='mm-preset-ren'>Rename</button>
            <button class='mm-btn del' id='mm-preset-del'>${MM_IC.trash()}</button>
            <button class='mm-btn' id='mm-preset-def' title='Reset all the settings below to their defaults'>Defaults</button>
          </div>
          <div class='ng-row' id='mm-preset-edit' style='display:none'>
            <input id='mm-preset-name' class='mm-inp' type='text' maxlength='${NG_NAME_MAX}' placeholder='Preset name'>
            <button class='mm-btn go' id='mm-preset-ok'>Save</button>
            <button class='mm-btn' id='mm-preset-cancel'>Cancel</button>
          </div>
        </div></div>
        <div class='set-grid eq'>
          <div class='mm-group'><h4>${MM_IC.globe()}World</h4><div class='gb'>
            <div class='mm-row'><label>Map size</label><select id='mm-size' class='mm-sel' style='flex:1'>
              <option value='60x45'>Small — 60×45</option><option value='80x60' selected>Normal — 80×60</option>
              <option value='120x90'>Large — 120×90</option><option value='160x120'>Huge — 160×120</option>
              <option value='200x150'>Gigantic — 200×150</option><option value='custom'>Custom…</option></select></div>
            <div class='mm-row' id='mm-size-custom' style='display:none'><label>Width × height</label>
              <input id='mm-w' class='mm-inp num' type='number' min='24' max='220' value='80'><span style='color:#7b90ad'>×</span><input id='mm-h' class='mm-inp num' type='number' min='24' max='220' value='60'></div>
            <div class='mm-row'><label>Terrain</label><select id='mm-type' class='mm-sel' style='flex:1'>
              <option value='earth'>Real Earth</option><option value='continents' selected>Continents</option>
              <option value='pangea'>Pangaea</option><option value='islands'>Islands</option>
              <option value='empty'>Empty (ocean)</option><option value='flat'>Empty (flat land)</option></select></div>
            <div class='mm-row' title='${_esc('How many animals, birds and fish the new world has and how many species live on each land. On the 3D map and on foot you see as many herds as there really are. "No animals" means a world without animals, birds and fish: you can add them with the Animals brush, and if you turn on "Life appears on its own", animals will arrive over time.')}'>
              <label>Wildlife</label><select id='mm-fauna' class='mm-sel' style='flex:1'>
              <option value='-1'>no animals</option><option value='0'>scarce</option><option value='1' selected>normal</option><option value='2'>abundant</option></select></div>
            <div class='mm-row'><label>World seed</label><input id='mm-seed' class='mm-inp' style='flex:1;min-width:0' type='text' inputmode='numeric' maxlength='10' placeholder='random'></div>
            <div class='mm-hint'>The same seed on a map of the same size gives the same terrain, so a good world can be shared. Its history is different every time. Larger maps simulate more slowly.<br><span id='mm-cur-seed'></span></div>
          </div></div>
          <div class='mm-group'><h4>${MM_IC.target()}Starting climate</h4><div class='gb'>
            <div class='sl-lab'>Sea level</div>
            <div class='sl-row'><input id='mm-sea' class='mm-slider' type='range' min='25' max='60' value='40'><span class='val' id='mm-sea-v' style='width:64px'>0</span></div>
            <div class='sl-lab'>CO₂ (greenhouse)</div>
            <div class='sl-row'><input id='mm-co2' class='mm-slider' type='range' min='40' max='320' value='100'><span class='val' id='mm-co2-v' style='width:64px'>280</span></div>
            <div class='sl-lab'>Solar output</div>
            <div class='sl-row'><input id='mm-sun' class='mm-slider' type='range' min='88' max='112' value='100'><span class='val' id='mm-sun-v' style='width:64px'>1.00×</span></div>
          </div></div>
        </div>
        <div class='mm-group' style='margin-top:13px'><h4>${MM_IC.book()}History</h4><div class='gb'>
          <div class='set-grid eq'>
            <div>
              <div class='sl-lab' style='margin-top:2px'>Pace of history</div>
              <div class='sl-row'><input id='mm-pace' class='mm-slider' type='range' min='4' max='26' value='10'><span class='val' id='mm-pace-v' style='width:56px'>1.0×</span></div>
              <div class='mm-hint' id='mm-pace-h'></div>
              <label class='mm-chk' style='margin-top:10px' title='${typeof faunaAutoHint === 'function' ? _esc(faunaAutoHint()) : ''}'><input type='checkbox' id='mm-fauto' checked><span class='bx'></span>Life appears on its own</label>
            </div>
            <div>
              <div class='mm-row' style='margin-top:2px'><label>Natural disasters</label><select id='mm-dis' class='mm-sel' style='flex:1'>
                <option value='0'>off</option><option value='1' selected>as in nature</option><option value='2'>frequent</option></select></div>
              <label class='mm-chk'><input type='checkbox' id='mm-settle' checked><span class='bx'></span>Settle the first tribes right away</label>
              <label class='mm-chk'><input type='checkbox' id='mm-dynsea' checked><span class='bx'></span>Living sea level</label>
              <div class='mm-hint'>Warming melts the ice and the sea floods the lowlands; cooling exposes the shelf. All of this can be changed in-game too, in the "Planet" window.</div>
            </div>
          </div>
        </div></div>
      </div>

      <div class='mm-pane' data-pane='net'><div id='net-pane'></div></div>
      <div class='mm-pane' data-pane='scn'>
        <div class='scn-grid' id='mm-scn-grid'></div>
        <div class='mm-hint'>A scenario is a starting world plus goals. Winning unlocks an achievement. The sandbox ("New Game") is always available.</div>
      </div>

      <div class='mm-pane' data-pane='save'>
        <div class='mm-group'><h4>New save</h4><div class='gb'>
          <div class='mm-row'><input id='mm-savename' class='mm-inp' style='flex:1' type='text' placeholder='map name (empty — by year)'><button class='mm-btn' id='mm-export'>To file</button></div>
          <div class='mm-hint'>Click an existing save to overwrite it with the current game.</div>
        </div></div>
        <div class='mm-saves' id='mm-overwritelist'></div>
      </div>

      <div class='mm-pane' data-pane='load'>
        <div class='mm-saves' id='mm-savelist'></div>
      </div>

      <div class='mm-pane' data-pane='ach'>
        <div id='mm-ach-box'></div>
      </div>

      <div class='mm-pane' data-pane='cred'>
        <div class='mm-cred'>
          <div class='mm-cred-game'>Earth Simulator</div>
          <div class='mm-cred-sec'><div class='mm-cred-h'>Developed by</div><div class='mm-cred-n'>Ilya873</div></div>
          <div class='mm-cred-sec'><div class='mm-cred-h'>Publisher</div><div class='mm-cred-n'>Gamesforfarm</div>
            <button class='mm-btn' id='mm-cred-tg'>Publisher news on Telegram</button></div>
          <div class='mm-cred-sec'><div class='mm-cred-h'>Music and sound</div><div class='mm-cred-t'>The twelve soundtrack pieces are written as notes right in the game code and played by its own synthesizer: there are no audio files or third-party samples, so each performance differs a little — key, tempo, ornaments. All sound effects are synthesized on the fly as well.</div></div>
          <div class='mm-cred-sec'><div class='mm-cred-h'>Thanks</div><div class='mm-cred-t'>To the players — for reviews, bug reports and ideas, many of which made it into the updates. To the Workshop add-on authors.</div></div>
          <div class='mm-cred-sec'><div class='mm-cred-h'>Real Earth</div><div class='mm-cred-t'>
            Elevation: NOAA ETOPO1; climate: NOAA NCEP/NCAR Reanalysis, GPCP<br>
            Coastlines and lakes: NASA JPL MUR SST</div></div>
          <div class='mm-cred-sec'><div class='mm-cred-h'>Third-party components</div><div class='mm-cred-t'>
            three.js — © 2010–2021 Three.js Authors, MIT license<br>
            NW.js — © Intel Corporation, Roger Wang and contributors, MIT license; Chromium — © The Chromium Authors<br>
            Steamworks — © Valve Corporation</div>
            <button class='mm-btn' id='mm-cred-lic'>Component licenses</button></div>
          <div class='mm-cred-note'>(Demomode patch by @Swedishush on TikTok, UI patch by me too.)</div>
        </div>
      </div>

      <div class='mm-pane' data-pane='mods'>
        <div class='mm-group'><h4>Installed add-ons</h4><div class='gb'>
          <div id='mm-mod-list'></div>
          <div class='mm-hint' id='mm-mod-restart' style='display:none;color:#7cc2ff'>The add-on list has changed. Add-ons are loaded when the game starts — restart it for the changes to take effect.</div>
        </div></div>
        <div class='mm-actions'>
          <button class='mm-btn go' id='mm-me-new'>Create an add-on</button>
          <button class='mm-btn alt' id='mm-mod-reload'>Restart the game</button>
        </div>
        <div class='mm-hint'>Your own add-on is removed with the Delete button — together with its folder on disk. Workshop subscriptions cannot be removed this way: unsubscribe on the item page, otherwise Steam downloads them again. The checkbox on the left turns an add-on on and off — this way you can separate conflicting packs without unsubscribing. A mod is a folder with a mod.json file: custom scenarios with goals and nation names. Workshop subscriptions are picked up automatically; put your own mods in the mods folder next to the game. An add-on that changes the code of the game is off after subscribing: its code runs only once you tick it yourself.</div>
      </div>

      <div class='mm-pane' data-pane='wsb'>
        <div class='wsb-bar'>
          <button class='mm-btn sq' id='wsb-back' title='Back'>\u2039</button><button class='mm-btn sq' id='wsb-fwd' title='Forward'>\u203a</button>
          <button class='mm-btn sq' id='wsb-reload' title='Reload'>\u21bb</button>
          <input class='mm-inp wsb-url' id='wsb-url' readonly value='https://steamcommunity.com/app/4932460/'>
          <button class='mm-btn' id='wsb-home'>Game page</button><button class='mm-btn' id='wsb-mods'>Browse mods</button>
          <button class='mm-btn' id='wsb-ext' title='Open the current page in your normal browser'>Open externally</button>
        </div>
        <div class='wsb-view' id='wsb-view'>
          <div class='wsb-load'></div>
          <div class='wsb-fb' id='wsb-fb'>The built-in browser is not available in this build of the game.<button class='mm-btn go' id='wsb-fb-ext'>Open the Workshop in your normal browser</button>You can still paste links below to install add-ons.</div>
        </div>
        <div class='mm-group wsb-dl'><h4>Install add-ons from the Workshop</h4><div class='gb'>
          <div class='wsb-row'>
            <input class='mm-inp' id='wsb-in' placeholder='Paste a Workshop link or item number\u2026' spellcheck='false'>
            <button class='mm-btn' id='wsb-paste'>Paste</button>
            <button class='mm-btn go' id='wsb-go'>Download</button>
            <button class='mm-btn alt' id='wsb-cur' disabled>Download this item</button>
          </div>
          <div class='wsb-opts'><label class='mm-chk'><input type='checkbox' id='wsb-ask' checked><span class='bx'></span>Show the item and ask before installing</label></div>
          <div id='wsb-log'></div>
          <div class='mm-hint'>No Steam account needed. Add-ons go straight into the mods folder; restart the game afterwards to activate them.
            <button class='mm-btn' id='wsb-installed' style='min-height:28px;padding:0 11px;font-size:12px;margin-left:6px'>Installed add-ons</button></div>
        </div></div>
      </div>

      <div class='mm-pane' data-pane='modedit'>
        <div id='mm-me-box'></div>
      </div>

      <div class='mm-pane' data-pane='set'>
        <div class='kb-tabs'><button class='kb-tab on' data-kb='main'>General</button><button class='kb-tab' data-kb='keys'>Controls</button></div>
        <div class='kb-page' id='kb-main'>
        <div class='set-grid one'>
          <div class='mm-group'><h4>${MM_IC.vol()}Sound</h4><div class='gb'>
            <label class='mm-chk'><input type='checkbox' id='set-snd'><span class='bx'></span>Sound on</label>
            <div class='sl-lab'>Master volume</div>
            <div class='sl-row'>${MM_IC.vol()}<input id='set-vol' class='mm-slider' type='range' min='0' max='100' value='80'><span class='val' id='set-vol-v'>80%</span></div>
            <label class='mm-chk'><input type='checkbox' id='set-mus'><span class='bx'></span>Background music</label>
            <div class='sl-lab'>Music volume</div>
            <div class='sl-row'>${MM_IC.music()}<input id='set-mvol' class='mm-slider' type='range' min='0' max='100' value='60'><span class='val' id='set-mvol-v'>60%</span></div>
            <div class='sl-lab'>Now playing</div>
            <div class='np-row'><span class='np-name' id='set-np'>—</span><button class='mm-btn np-next' id='set-next' title='Switch the track — afterwards music follows the era on its own again'>Next</button></div>
            <select id='set-track' class='mm-sel np-sel'></select>
          </div></div>
        </div>
        <div class='set-grid eq'>
          <div class='mm-group'><h4>${MM_IC.screen()}Display and gameplay</h4><div class='gb'>
            <div class='mm-row'><label>Temperature</label><select id='set-utemp' class='mm-sel' style='flex:1'><option value='c'>Celsius, °C</option><option value='f'>Fahrenheit, °F</option></select></div>
            <div class='mm-row'><label>Measures</label><select id='set-ulen' class='mm-sel' style='flex:1'><option value='metric'>Metric: km, m, km/h</option><option value='us'>US: miles, feet, mph</option></select></div>
            <label class='mm-chk'><input type='checkbox' id='set-fs'><span class='bx'></span>Fullscreen (F11)</label>
            <label class='mm-chk'><input type='checkbox' id='set-hints'><span class='bx'></span>In-game hints</label>
            <label class='mm-chk'><input type='checkbox' id='set-coach'><span class='bx'></span>Show help on startup</label>
            <label class='mm-chk'><input type='checkbox' id='set-notify'><span class='bx'></span>Notifications about major world events</label>
            <div class='mm-row'><label style='width:auto'>Autosave</label><select id='set-autosave' class='mm-sel' style='flex:1'>
              <option value='0'>off</option><option value='5'>every 5 minutes</option><option value='10'>every 10 minutes</option><option value='20'>every 20 minutes</option></select></div>
            <div class='mm-row' title='How many drops and flakes to draw in the walk and on the 3D map: dense rain flickers too much for some players'><label style='width:auto'>Rain and snow density</label><select id='set-rain' class='mm-sel' style='flex:1'><option value='1'>as in nature</option><option value='0.6'>lighter</option><option value='0.3'>sparse drops</option><option value='0'>no drops or flakes</option></select></div>
          </div></div>
          <div class='mm-group'><h4>${MM_IC.star()}Extras</h4><div class='gb'>
            <button class='mm-btn wide' id='set-show-coach' style='margin-bottom:10px'>${MM_IC.quest()}Open help</button>
            <button class='mm-btn wide' id='set-show-tut'>${MM_IC.cap()}Take tutorial</button>
          </div></div>
        </div>
        <div class='mm-group' style='margin-top:13px'><h4>${MM_IC.image()}Graphics</h4><div class='gb'>
          <div class='set-grid eq'>
            <div>
              <label class='mm-rad has-note'><input type='radio' name='mm-gfx' value='fast'><span class='dot'></span><span class='rad-txt'>Fast<span class='gfx-note'>for weak computers and integrated graphics</span></span></label>
              <label class='mm-rad has-note'><input type='radio' name='mm-gfx' value='medium'><span class='dot'></span><span class='rad-txt'>Normal<span class='gfx-note'>recommended: good looks with a steady frame rate</span></span></label>
              <label class='mm-rad has-note'><input type='radio' name='mm-gfx' value='high'><span class='dot'></span><span class='rad-txt'>High<span class='gfx-note'>building shadows, full water, sharper map — needs a gaming graphics card</span></span></label>
              <label class='mm-rad has-note'><input type='radio' name='mm-gfx' value='ultra'><span class='dot'></span><span class='rad-txt'>Ultra<span class='gfx-note'>everything maxed out — for powerful graphics cards</span></span></label>
              <label class='mm-rad' id='gfx-custom-row' style='display:none'><input type='radio' name='mm-gfx' value='custom'><span class='dot'></span>Custom</label>
              <div class='mm-hint'>Applied immediately, the world is kept.</div>
            </div>
            <div>
              <div class='ui-h' style='margin-top:2px'>2D map</div>
              <label class='mm-chk'><input type='checkbox' id='gfx-base'><span class='bx'></span>Terrain at full screen resolution</label>
              <label class='mm-chk'><input type='checkbox' id='gfx-water'><span class='bx'></span>Detailed water</label>
              <div class='ui-h' style='margin-top:14px'>3D world and walking</div>
              <label class='mm-chk'><input type='checkbox' id='gfx-tex'><span class='bx'></span>Photo terrain textures</label>
              <label class='mm-chk'><input type='checkbox' id='gfx-post'><span class='bx'></span>Post-processing (bloom, colour grading)</label>
              <label class='mm-chk'><input type='checkbox' id='gfx-clouds'><span class='bx'></span>Clouds and their shadows</label>
              <label class='mm-chk'><input type='checkbox' id='gfx-night'><span class='bx'></span>Day and night cycle</label>
              <div class='mm-row'><label>Shadows</label><select id='gfx-shadows' class='mm-sel' style='flex:1'><option value='0'>off</option><option value='1'>from mountains</option><option value='2'>mountains, buildings and trees</option></select></div>
              <div class='mm-row'><label>Water</label><select id='gfx-water3d' class='mm-sel' style='flex:1'><option value='0'>simple</option><option value='1'>with sky reflection</option><option value='2'>full</option></select></div>
              <div class='mm-row'><label>Detail</label><select id='gfx-detail' class='mm-sel' style='flex:1'><option value='0'>low</option><option value='1'>normal</option><option value='2'>high</option><option value='3'>ultra</option></select></div>
              <div class='mm-row'><label>Anti-aliasing</label><select id='gfx-aa' class='mm-sel' style='flex:1'><option value='0'>basic</option><option value='1'>FXAA</option><option value='2'>MSAA ×4</option></select></div>
              <div class='sl-lab'>3D render resolution</div>
              <div class='sl-row'><input id='gfx-scale' class='mm-slider' type='range' min='50' max='100' step='5' value='100'><span class='val' id='gfx-scale-v'>100%</span></div>
            </div>
          </div>
        </div></div>
        </div>
        <div class='kb-page' id='kb-keys' style='display:none'></div>
      </div>

    </div>
    <div class='mmd-foot' id='mmd-foot'>
      <div class='fpane' data-pane='new'><button class='mm-btn go' id='mm-create'>Create World</button><button class='mm-btn mm-cancel'>Cancel</button></div>
      <div class='fpane' data-pane='scn'><button class='mm-btn mm-cancel'>Close</button></div>
      <div class='fpane' data-pane='net' id='net-foot'></div>
      <div class='fpane' data-pane='save'><button class='mm-btn go' id='mm-save'>Save</button><button class='mm-btn mm-cancel'>Cancel</button></div>
      <div class='fpane' data-pane='load'><label class='mm-btn alt' style='cursor:pointer'>From file…<input id='mm-file' type='file' accept='.json,application/json' style='display:none'></label><button class='mm-btn mm-cancel'>Close</button></div>
      <div class='fpane' data-pane='ach'><button class='mm-btn mm-cancel'>Close</button></div>
      <div class='fpane' data-pane='cred'><button class='mm-btn mm-cancel'>Close</button></div>
      <div class='fpane' data-pane='mods'>
        <button class='mm-btn alt' id='mm-ws-open'>Open Workshop</button>
        <button class='mm-btn' id='mm-ws-folder'>Mods folder</button>
        <button class='mm-btn' id='mm-ws-refresh'>Refresh</button>
        <button class='mm-btn mm-cancel'>Close</button>
      </div>
      <div class='fpane' data-pane='wsb'><button class='mm-btn mm-cancel'>Close</button></div>
      <div class='fpane' data-pane='modedit'>
        <button class='mm-btn go' id='mm-me-save'>Save</button>
        <button class='mm-btn alt' id='mm-me-test'>Test in game</button>
        <button class='mm-btn' id='mm-me-pub'>Publish</button>
        <button class='mm-btn' id='mm-me-back'>Back</button>
      </div>
      <div class='fpane' data-pane='set'><button class='mm-btn go' id='set-apply'>Apply</button><button class='mm-btn' id='set-cancel'>Cancel</button></div>
    </div>
  </div>`;
  document.body.appendChild(m); _menuEl = m;
  if (typeof mmNewsAttach === 'function') mmNewsAttach(m);    // справа — «Что нового» и ссылки на каналы игры (menunews.js)

  // пункты меню
  const dlg = m.querySelector('#mm-dialog'), foot = m.querySelector('#mmd-foot');
  function openPane(name, list) {
    if (netLive() && (name === 'new' || name === 'scn' || name === 'load' || name === 'mods')) { netLoadDeny(); return; }   // свой мир в комнату не загрузишь: сперва выйти из неё
    if (name === 'mods' && !list) name = 'wsb';                       // the Workshop button opens the built-in browser; the installed list is one click away
    if (name === 'continue') {
      // меню при запуске игры: «Продолжить» возвращает в последний сохранённый мир (обычно это автосохранение)
      if (_menuStartup) { const last = _lastSave(); if (last) { bootLoadMap(last.name, last.meta.w, last.meta.h); return; } }
      hideMainMenu(); return;
    }
    if (name === 'quit') { uiAsk('Quit the game?', 'Quit', _quitApp, { title: 'Quit' }); return; }
    _curPane = name;
    m.classList.add('pane');
    m.querySelectorAll('.mm-item').forEach(x => { x.classList.toggle('on', x.dataset.pane === (name === 'wsb' ? 'mods' : name)); x.classList.remove('primary'); });
    dlg.classList.remove('show'); void dlg.offsetWidth; dlg.classList.add('show');   // перезапуск анимации при переходе между разделами
    m.querySelector('#mmd-title').textContent = _PANE_TITLE()[name] || '';
    m.querySelectorAll('.mm-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
    let hasFoot = false;
    m.querySelectorAll('.fpane').forEach(p => { const on = p.dataset.pane === name; p.classList.toggle('on', on); if (on) hasFoot = true; });
    foot.classList.toggle('show', hasFoot);
    m.querySelector('.mmd-body').scrollTop = 0;
    if (name === 'new') { const cs = m.querySelector('#mm-cur-seed'); if (cs) cs.textContent = _fmt('Seed of the current world: {0}', worldSeed); if (m._ngOpen) m._ngOpen(); }
    if (name === 'wsb' && m._wsbShow) m._wsbShow(); else if (m._wsbHide) m._wsbHide();
    if (name === 'load') _refreshSaveList();
    if (name === 'save') _refreshOverwriteList();
    if (name === 'scn') _refreshScenarios();
    if (name === 'net' && typeof netUiPane === 'function') netUiPane();
    if (name === 'ach') { const b = m.querySelector('#mm-ach-box'); if (b && typeof achGalleryHTML === 'function') { b.innerHTML = achGalleryHTML(); if (typeof achSteamLoad === 'function') achSteamLoad(); } }
    if (name === 'modedit' && typeof modEditRender === 'function') modEditRender();
    if (name === 'mods') { _refreshModList(); try { if (window.steamAPI && window.steamAPI.workshopRefresh) window.steamAPI.workshopRefresh(); } catch (e) {} }
    if (name === 'set') { _snapSettings(); _syncSettingsPane(); _kbShow('main'); }
    _syncSliders();
  }
  m.querySelectorAll('.mm-item').forEach(b => b.addEventListener('click', () => openPane(b.dataset.pane)));
  m.querySelector('#mmd-x').addEventListener('click', () => closeMenuPane());
  m.querySelectorAll('.mm-cancel').forEach(b => b.addEventListener('click', () => closeMenuPane()));

  // ползунки: заливка дорожки — одним делегатом на всё меню
  m.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('mm-slider')) _sliderFill(e.target); });

  // ползунки «Новой игры» → подписи
  const bind = (id, vid, fmt) => { const el = m.querySelector('#' + id), v = m.querySelector('#' + vid); const upd = () => v.textContent = fmt(+el.value); el.addEventListener('input', upd); upd(); };
  bind('mm-sea', 'mm-sea-v', x => { const mt = (x / 100 - 0.40) * 5000 / 0.6; return (Math.abs(mt) < 5 ? '' : mt > 0 ? '+' : '−') + uM(Math.abs(mt), 10); });
  bind('mm-co2', 'mm-co2-v', x => Math.round(280 * x / 100) + ' ppm'); bind('mm-sun', 'mm-sun-v', x => (x / 100).toFixed(2) + '×');
  bind('mm-pace', 'mm-pace-v', x => (x / 10).toFixed(1) + '×');
  const paceHint = () => { const v = +m.querySelector('#mm-pace').value / 10, y = Math.round(850 / v / 50) * 50;
    m.querySelector('#mm-pace-h').textContent = _fmt('From tribes to the space age in about {0} years. ', y)
      + (v < 0.75 ? 'An unhurried epic: dynasties change dozens of times and every era has time to live its life.'
        : v > 1.6 ? 'Fast history — almost like version 1.0.' : 'The normal pace: a whole world history in one evening.'); };
  m.querySelector('#mm-pace').addEventListener('input', paceHint); paceHint();
  const sizeSel = m.querySelector('#mm-size');
  sizeSel.addEventListener('change', () => { m.querySelector('#mm-size-custom').style.display = sizeSel.value === 'custom' ? '' : 'none'; });
  // «Нет животных»: при «Самозарождение жизни» звери пришли бы через несколько лет — снимаем галочку за игрока
  // (поставить обратно можно: тогда пустой мир заселится сам). Набор, который заполняет форму, не трогаем
  const faunaSel = m.querySelector('#mm-fauna');
  faunaSel.addEventListener('change', () => { if (_ngBusy || faunaSel.value !== '-1') return; const fa = m.querySelector('#mm-fauto'); if (fa) fa.checked = false; });
  m.querySelector('#mm-create').addEventListener('click', () => {
    const v = _ngRead(m);
    _ngLastSave(v);                 // в следующий раз «Новая игра» откроется с этими настройками (без зерна)
    bootNewMap(_ngToBoot(v));
  });

  // наборы настроек: выбор из списка сразу кладёт набор на форму; имена вводятся прямо в строке (не prompt —
  // в NW.js это отдельное окно ОС), перезапись и удаление — через uiAsk; готовые наборы не трогаются
  const psel = m.querySelector('#mm-preset'), prow = m.querySelector('#mm-preset-row'), pedit = m.querySelector('#mm-preset-edit'), pname = m.querySelector('#mm-preset-name');
  let pSnap = '', pMode = null, pOwn = '';   // pSnap — форма сразу после выбора набора; pMode — ввод имени: 'save' | 'ren'; pOwn — последний свой набор
  const pCur = () => {
    const val = psel.value;
    if (val.indexOf('b:') === 0) { const b = _NG_BUILTIN().find(x => 'b:' + x.id === val); return b ? { kind: 'b', n: b.n, v: b.v } : null; }
    if (val.indexOf('u:') === 0) { const list = _ngPresets(), k = +val.slice(2); return list[k] ? { kind: 'u', k, n: list[k].n, v: list[k].v } : null; }
    return null;
  };
  const pBtns = () => {
    const c = pCur(), own = !!c && c.kind === 'u';
    const why = c ? 'Built-in presets cannot be renamed or deleted' : 'First pick one of your presets in the list';
    const ren = m.querySelector('#mm-preset-ren'), del = m.querySelector('#mm-preset-del');
    ren.disabled = !own; del.disabled = !own;
    ren.title = own ? 'Rename the selected preset' : why;
    del.title = own ? 'Delete the selected preset' : why;
  };
  const pFill = keep => {
    psel.innerHTML = '';
    const opt = (parent, value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; parent.appendChild(o); };   // имена игрока — только textContent
    opt(psel, '', 'Current settings');
    const g1 = document.createElement('optgroup'); g1.label = 'Built-in presets';
    for (const b of _NG_BUILTIN()) opt(g1, 'b:' + b.id, b.n);
    psel.appendChild(g1);
    const list = _ngPresets();
    if (list.length) { const g2 = document.createElement('optgroup'); g2.label = 'Your presets'; list.forEach((p, k) => opt(g2, 'u:' + k, p.n)); psel.appendChild(g2); }
    psel.value = keep && [...psel.options].some(o => o.value === keep) ? keep : '';
    pBtns();
  };
  psel.addEventListener('change', () => { const c = pCur(); if (c) { _ngApply(m, c.v); pSnap = JSON.stringify(_ngRead(m)); pOwn = c.kind === 'u' ? c.n : ''; } pBtns(); });
  // игрок правит форму после выбора набора — на форме уже не он, и список честно показывает «Текущие настройки»
  const paneNew = m.querySelector(".mm-pane[data-pane='new']");
  const onEdit = e => {
    if (_ngBusy || !psel.value || (e.target && e.target.closest && e.target.closest('#mm-preset-box'))) return;
    if (JSON.stringify(_ngRead(m)) !== pSnap) { psel.value = ''; pBtns(); }
  };
  paneNew.addEventListener('input', onEdit); paneNew.addEventListener('change', onEdit);
  const pEditEnd = () => { pMode = null; pedit.style.display = 'none'; prow.style.display = ''; };
  const pEditStart = mode => {
    const c = pCur();
    pMode = mode;
    // свой набор подправили и сохраняют снова — подставляем его имя (перезапись всё равно спросит);
    // после готового набора или «По умолчанию» поле пустое
    pname.value = c && c.kind === 'u' ? c.n : mode === 'save' ? pOwn : '';
    m.querySelector('#mm-preset-ok').textContent = mode === 'ren' ? 'Rename' : 'Save';
    prow.style.display = 'none'; pedit.style.display = '';
    setTimeout(() => { try { pname.focus(); pname.select(); } catch (e) {} }, 0);
  };
  const pEditOk = () => {
    const name = pname.value.replace(/\s+/g, ' ').trim().slice(0, NG_NAME_MAX);
    if (!name) { flash('Enter a preset name'); try { pname.focus(); } catch (e) {} return; }
    const list = _ngPresets(), hit = list.findIndex(p => p.n.toLowerCase() === name.toLowerCase());
    const done = (msg) => { pFill('u:' + list.findIndex(p => p.n === name)); pSnap = JSON.stringify(_ngRead(m)); pOwn = name; pEditEnd(); flash(msg); };
    if (pMode === 'ren') {
      const c = pCur(); if (!c || c.kind !== 'u') { pEditEnd(); return; }
      const k = list.findIndex(p => p.n === c.n); if (k < 0) { pEditEnd(); pFill(''); return; }
      const go = () => { list[k] = { n: name, v: list[k].v }; if (hit >= 0 && hit !== k) list.splice(hit, 1); if (_ngPresetsSave(list)) done('Preset renamed'); };
      if (hit >= 0 && hit !== k) uiAsk(_fmt('A preset named "{0}" already exists. Replace it with the renamed one?', list[hit].n), 'Replace', go, { danger: true });
      else go();
      return;
    }
    const v = _ngRead(m);
    if (hit >= 0) { uiAsk(_fmt('A preset named "{0}" already exists. Overwrite it with the current settings?', list[hit].n), 'Overwrite', () => { list[hit] = { n: name, v }; if (_ngPresetsSave(list)) done(_fmt('Preset "{0}" overwritten', name)); }, { danger: true }); return; }
    if (list.length >= NG_MAX) { flash(_fmt('There are already {0} presets — delete one you do not need', NG_MAX)); return; }
    list.push({ n: name, v });
    if (_ngPresetsSave(list)) done(_fmt('Preset "{0}" saved', name));
  };
  m.querySelector('#mm-preset-save').addEventListener('click', () => pEditStart('save'));
  m.querySelector('#mm-preset-ren').addEventListener('click', () => { const c = pCur(); if (c && c.kind === 'u') pEditStart('ren'); });
  m.querySelector('#mm-preset-ok').addEventListener('click', pEditOk);
  m.querySelector('#mm-preset-cancel').addEventListener('click', pEditEnd);
  // Enter — готово, Esc — отмена ввода (общий обработчик клавиш поля ввода не трогает, Esc не закроет раздел)
  pname.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); pEditOk(); } else if (e.key === 'Escape') { e.preventDefault(); pEditEnd(); } });
  m.querySelector('#mm-preset-del').addEventListener('click', () => {
    const c = pCur(); if (!c || c.kind !== 'u') return;
    uiAsk(_fmt('Delete the preset "{0}"?', c.n), 'Delete', () => {
      const list = _ngPresets(), k = list.findIndex(p => p.n === c.n); if (k >= 0) list.splice(k, 1);
      if (pOwn === c.n) pOwn = '';
      if (_ngPresetsSave(list)) { pFill(''); flash('Preset deleted'); }
    }, { danger: true, icon: 'trash' });
  });
  m.querySelector('#mm-preset-def').addEventListener('click', () => { _ngApply(m, {}); psel.value = ''; pOwn = ''; pBtns(); flash('Settings reset to defaults'); });
  m._ngOpen = () => { pEditEnd(); pFill(psel.value); };     // раздел открыли заново: ввод имени сброшен, список свежий
  { const last = _ngLast(); if (last) _ngApply(m, last); }   // последние настройки «Создать мир» (без зерна)
  pFill('');

  // сохранения
  m.querySelector('#mm-save').addEventListener('click', () => {
    const typed = m.querySelector('#mm-savename').value.trim();
    // набранное имя уже занято — это перезапись чужого мира, спрашиваем (как у кнопки «Перезаписать» в списке)
    const go = () => { const n = saveWorldToStorage(typed); if (n) { m.querySelector('#mm-savename').value = ''; _refreshOverwriteList(); flash('Saved: ' + n); } };
    if (typed && SaveStore.exists(typed)) { uiAsk(_fmt('A save named "{0}" already exists. Overwrite it with the current game?', typed), 'Overwrite', go, { danger: true }); return; }
    go();
  });
  m.querySelector('#mm-savename').addEventListener('keydown', e => { if (e.key === 'Enter') m.querySelector('#mm-save').click(); });
  m.querySelector('#mm-export').addEventListener('click', downloadWorldFile);
  m.querySelector('#mm-file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const save = JSON.parse(r.result);
        if (!save || !save.arrays || !save.w || !save.h) { uiAlert('This is not an Earth Simulator map file.'); return; }
        if (!(save.w >= 24 && save.w <= 220 && save.h >= 24 && save.h <= 220)) { uiAlert(_fmt('Map file is corrupted: invalid size {0}×{1}.', save.w, save.h)); return; }
        const importName = 'import';
        const base = (f.name || importName).replace(/\.json$/i, '').slice(0, 40) || importName;
        let name = base, n = 2; while (SaveStore.exists(name)) name = base + ' (' + (n++) + ')';
        const wr = SaveStore.write(name, save, { ts: save.ts || Date.now(), w: save.w, h: save.h, year: Math.floor((save.scal && save.scal.simYear) || 0), pop: 0, states: (save.states || []).filter(x => x.alive).length, thumb: '' });
        if (!wr.ok) { uiAlert(wr.why === 'quota' ? 'Not enough storage space to import.' : 'Could not store the imported map: ' + wr.why); return; }
        bootLoadMap(name, save.w, save.h);
      } catch (err) {
        uiAlert('Could not read the map file.');
      }
    };
    r.readAsText(f);
  });

  // настройки: звук/музыка/полный экран/обучение — применяются сразу (слышно/видно),
  // «Отмена» возвращает снимок, сделанный при открытии раздела.
  const chkSnd = m.querySelector('#set-snd'), chkMus = m.querySelector('#set-mus');
  const vol = m.querySelector('#set-vol'), mvol = m.querySelector('#set-mvol');
  chkSnd.addEventListener('change', () => { if (typeof SFX !== 'undefined') SFX.setOn(chkSnd.checked); });
  chkMus.addEventListener('change', () => { if (typeof SFX !== 'undefined') SFX.setMusic(chkMus.checked); });
  vol.addEventListener('input', () => { m.querySelector('#set-vol-v').textContent = vol.value + '%'; if (typeof SFX !== 'undefined') SFX.setVol(vol.value / 100); });
  mvol.addEventListener('input', () => { m.querySelector('#set-mvol-v').textContent = mvol.value + '%'; if (typeof SFX !== 'undefined') SFX.setMusicVol(mvol.value / 100); });
  // проигрыватель: следующий трек / включить любой — после него режиссёр снова сам подбирает музыку под мир
  m.querySelector('#set-next').addEventListener('click', () => { if (typeof SFX !== 'undefined' && SFX.nextTrack) { if (!SFX.settings().music) { SFX.setMusic(true); chkMus.checked = true; } SFX.nextTrack(); setTimeout(_syncNowPlaying, 1600); } });
  const trSel = m.querySelector('#set-track');
  trSel.addEventListener('change', () => {
    const id = trSel.value; trSel.value = '';
    if (!id || typeof SFX === 'undefined' || !SFX.playTrack) return;
    if (!SFX.settings().music) { SFX.setMusic(true); chkMus.checked = true; }
    SFX.playTrack(id); setTimeout(_syncNowPlaying, 1500);
  });
  m.querySelector('#set-fs').addEventListener('change', e => setFullscreen(e.target.checked));
  const hintsChk = m.querySelector('#set-hints');
  hintsChk.addEventListener('change', () => { if (typeof TUT !== 'undefined') TUT.setHints(hintsChk.checked); });
  const coachChk = m.querySelector('#set-coach');
  coachChk.addEventListener('change', () => { try { localStorage.setItem('earthsim.hideHelp', coachChk.checked ? '0' : '1'); } catch (e) {} });
  // графика: применяем сразу — игрок видит разницу, не выходя из настроек
  const gfxSync = () => _syncGfxPane();
  m.querySelectorAll('input[name=mm-gfx]').forEach(r => r.addEventListener('change', () => {
    if (r.checked && typeof gfxSetPreset === 'function' && gfxSetPreset(r.value)) { gfxApply(); gfxSync(); }
  }));
  const gfxChk = (id, key, on, off) => {
    const el = m.querySelector('#' + id);
    el.addEventListener('change', () => { if (typeof gfxSet === 'function') { gfxSet(key, el.checked ? on : off); gfxApply(); gfxSync(); } });
  };
  gfxChk('gfx-tex', 'tex3d', true, false);
  gfxChk('gfx-base', 'base', 2, 1);
  gfxChk('gfx-water', 'water', 1, 0.5);
  gfxChk('gfx-post', 'post', true, false);
  gfxChk('gfx-clouds', 'clouds', true, false);
  gfxChk('gfx-night', 'night', true, false);
  for (const [id, key] of [['gfx-shadows', 'shadows'], ['gfx-water3d', 'water3d'], ['gfx-detail', 'detail'], ['gfx-aa', 'aa']]) {
    const el = m.querySelector('#' + id);
    el.addEventListener('change', () => { if (typeof gfxSet === 'function') { gfxSet(key, +el.value); gfxApply(); gfxSync(); } });
  }
  const gsc = m.querySelector('#gfx-scale');
  gsc.addEventListener('input', () => { m.querySelector('#gfx-scale-v').textContent = gsc.value + '%'; });
  gsc.addEventListener('change', () => { if (typeof gfxSet === 'function') { gfxSet('scale', +gsc.value / 100); gfxApply(); gfxSync(); } });
  // уведомления и автосохранение
  m.querySelector('#set-notify').addEventListener('change', e => { if (typeof setNotify === 'function') setNotify(e.target.checked); });
  m.querySelector('#set-autosave').addEventListener('change', e => { try { localStorage.setItem('earthsim.autosave', String(+e.target.value || 0)); } catch (err) {} });
  m.querySelector('#set-rain').addEventListener('change', e => { if (typeof rainKSet === 'function') rainKSet(+e.target.value); });   // плотность дождя и снега (2.1.4): сразу

  // Мастерская
  m.querySelector('#mm-ws-open').addEventListener('click', () => {
    openPane('wsb');                                              // built-in browser instead of the Steam overlay / system browser
  });
  m.querySelector('#mm-cred-tg').addEventListener('click', () => {
    const url = 'https://t.me/gamesforfarmnews';
    try { if (window.nw && nw.Shell) { nw.Shell.openExternal(url); return; } } catch (e) {}
    window.open(url, '_blank');
  });
  m.querySelector('#mm-cred-lic').addEventListener('click', () => {
    // credits.html — лицензии Chromium и NW.js, едет в папке игры рядом с EarthSimulator.exe (так требуют их лицензии)
    try { if (window.nw && nw.Shell && typeof require === 'function') { const path = require('path'); nw.Shell.openItem(path.join(path.dirname(process.execPath), 'credits.html')); return; } } catch (e) {}
    flash('The license file credits.html is in the game folder.');
  });
  m.querySelector('#mm-ws-folder').addEventListener('click', () => {
    const dir = (typeof modsDir === 'function') ? modsDir() : null;
    if (!dir) { flash('The mods folder is only available in the Steam build.'); return; }
    try { if (window.nw && nw.Shell) { nw.Shell.openItem(dir); return; } } catch (e) {}
    flash(dir);
  });
  m.querySelector('#mm-ws-refresh').addEventListener('click', () => {
    try { if (window.steamAPI && window.steamAPI.workshopRefresh) window.steamAPI.workshopRefresh(); } catch (e) {}
    if (typeof modsLoadLocal === 'function') modsLoadLocal();
    _refreshModList(); flash('List refreshed');
  });

  // редактор дополнений
  const openEditor = modId => { if (typeof modEditOpen !== 'function') return; modEditOpen(modId); openPane('modedit'); };
  m.querySelector('#mm-me-new').addEventListener('click', () => openEditor(null));
  // перезапуск: включение/отключение мода меняет глобальные таблицы, которые правятся
  // один раз при загрузке, и код дополнений встаёт только при запуске — на лету не перечитать, только начать заново
  m.querySelector('#mm-mod-reload').addEventListener('click', _modRelaunch);
  m.querySelector('#mm-me-back').addEventListener('click', () => openPane('mods', true));
  m.querySelector('#mm-me-save').addEventListener('click', () => {
    const bad = modEditProblems();
    if (bad.length) { flash('Check: ' + bad[0]); return; }
    const dir = modEditSave(); if (dir) flash(_fmt('Saved to {0}', dir));
  });
  m.querySelector('#mm-me-test').addEventListener('click', () => {
    const bad = modEditProblems();
    if (bad.length) { flash('Check: ' + bad[0]); return; }
    modEditTest();                                  // сохраняет и перезапускает игру в этот сценарий
  });
  m.querySelector('#mm-me-pub').addEventListener('click', () => {
    const bad = modEditProblems();
    if (bad.length) { flash('Check: ' + bad[0]); return; }
    const dir = modEditSave(); if (!dir) return;
    if (typeof modsLoadLocal === 'function') modsLoadLocal();
    const mod = (typeof MODS !== 'undefined') ? MODS.find(x => x.dir === dir) : null;
    _publishMod(mod || { name: _me.name, desc: _me.description, dir }, m.querySelector('#mm-me-pub'));
  });
  window._meOpenEditor = openEditor;

  // справка из настроек открывается поверх меню и закрывается обратно в настройки: раньше она выкидывала в игру,
  // а в окне была одна кнопка «Начать игру» — вернуться было нельзя (отзыв тестера)
  m.querySelector('#set-show-coach').addEventListener('click', () => {
    const c = document.getElementById('coach'); if (!c) return;
    const b = c.querySelector('.coach-close'); if (b) { if (b.dataset.lbl == null) b.dataset.lbl = b.textContent; b.textContent = 'Back to settings'; }
    c.classList.add('show', 'from-menu');
  });
  m.querySelector('#set-show-tut').addEventListener('click', () => { hideMainMenu(); if (typeof TUT !== 'undefined') TUT.start(); });
  // «Применить»: язык — единственная настройка с отложенным эффектом (перезагружает страницу)
  m.querySelector('#set-apply').addEventListener('click', () => {
    const sel = m.querySelector('input[name=mm-lang]:checked');
    const l = sel ? sel.value : (typeof curLang === 'function' ? curLang() : 'ru');
    // единицы — только показ: подписи и окна перестроятся сами, легенду слоя обновляем сразу
    const ut = m.querySelector('#set-utemp'), ul = m.querySelector('#set-ulen');
    if (typeof unitsSet === 'function' && ut && ul) { unitsSet('temp', ut.value); unitsSet('len', ul.value); if (typeof setLayer === 'function' && typeof uiState !== 'undefined' && uiState.layer) setLayer(uiState.layer); }
    if (typeof setLang === 'function' && typeof curLang === 'function' && l !== curLang()) { setLang(l); return; }
    _setSnap = null; closeMenuPane(); flash('Settings applied');
  });
  m.querySelector('#set-cancel').addEventListener('click', () => { _restoreSettings(); closeMenuPane(); });
  m.querySelectorAll('.kb-tab').forEach(b => b.addEventListener('click', () => _kbShow(b.dataset.kb)));

  m._openPane = openPane; _wsbWire(m, openPane);

  // демо: кнопка «Купить», остаток времени, без Мастерской. ПОСЛЕ всей проводки: пункты меню навешивают openPane(data-pane) скопом,
  // а у кнопки «Купить» своё действие
  if (typeof demoMenuPatch === 'function') demoMenuPatch(m);
  try { _menuFx(m); } catch (e) {}                              // cosmetic effects: a failure here must never break the menu
  return m;
}
// ---------- menu effects: starfield canvas, mouse parallax, cursor spotlight, click ripples, card tilt ----------
// everything here is cosmetic: the canvas loop runs only while the menu is on screen and is skipped on
// the low-graphics preset (.still) and with "reduce motion"; a failure anywhere is swallowed by the caller
function _menuFx(m) {
  const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const cv = m.querySelector('.mm-fx'), ctx = cv && cv.getContext ? cv.getContext('2d') : null;
  let cw = 0, ch = 0, raf = 0, last = 0, stars = [], streak = null, nextStreak = 2500;
  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cw = m.clientWidth; ch = m.clientHeight; if (!cw || !ch) return;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.max(40, Math.min(120, cw * ch / 15000)));
    stars = [];
    for (let i = 0; i < n; i++) stars.push({ x: Math.random() * cw, y: Math.random() * ch, r: 0.4 + Math.random() * 1.5,
      vy: 3 + Math.random() * 9, vx: -1 + Math.random() * 2, ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.8, hue: Math.random() < 0.22 ? 205 : 215 });
  }
  function frame(ts) {
    if (!m.classList.contains('show') || document.hidden || m.classList.contains('still')) { raf = 0; return; }
    const dt = Math.min(0.05, (ts - (last || ts)) / 1000); last = ts;
    ctx.clearRect(0, 0, cw, ch);
    const t = ts / 1000;
    for (const s of stars) {
      s.y -= s.vy * dt; s.x += s.vx * dt;
      if (s.y < -4) { s.y = ch + 4; s.x = Math.random() * cw; } if (s.x < -4) s.x = cw + 4; else if (s.x > cw + 4) s.x = -4;
      const a = 0.18 + 0.82 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
      ctx.fillStyle = 'hsla(' + s.hue + ',90%,85%,' + (a * 0.16).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3.2, 0, 6.2832); ctx.fill();   // halo
      ctx.fillStyle = 'hsla(' + s.hue + ',100%,92%,' + a.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
    }
    nextStreak -= dt * 1000;
    if (!streak && nextStreak <= 0) { streak = { x: cw * (0.35 + Math.random() * 0.6), y: ch * Math.random() * 0.4, a: 2.45 + Math.random() * 0.35, v: 700 + Math.random() * 400, life: 0 }; nextStreak = 5000 + Math.random() * 7000; }
    if (streak) {
      streak.life += dt; const k = streak.life / 0.9;
      if (k >= 1) streak = null; else {
        streak.x += Math.cos(streak.a) * streak.v * dt; streak.y += Math.sin(streak.a) * streak.v * dt;
        const tx = streak.x - Math.cos(streak.a) * 150, ty = streak.y - Math.sin(streak.a) * 150, al = Math.sin(k * Math.PI);
        const g = ctx.createLinearGradient(streak.x, streak.y, tx, ty);
        g.addColorStop(0, 'rgba(235,245,255,' + (al * 0.95).toFixed(3) + ')'); g.addColorStop(1, 'rgba(120,180,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(streak.x, streak.y); ctx.lineTo(tx, ty); ctx.stroke();
      }
    }
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    const run = !RM && ctx && m.classList.contains('show') && !m.classList.contains('still') && !document.hidden;
    if (run && !raf) { size(); last = 0; raf = requestAnimationFrame(frame); }
    else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; if (ctx) ctx.clearRect(0, 0, cw, ch); }
  }
  if (ctx) {
    new MutationObserver(sync).observe(m, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', () => { if (raf) size(); });
    sync();
  }
  if (RM) return;

  // mouse: parallax, spotlight on buttons, tilt on scenario cards (one update per frame)
  let ev = null, tick = 0, tilted = null;
  function pointer() {
    tick = 0; if (!ev) return;
    const e = ev; ev = null;
    m.style.setProperty('--px', ((e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2).toFixed(3));
    m.style.setProperty('--py', ((e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2).toFixed(3));
    const el = e.target && e.target.closest ? e.target.closest('.mm-item,.mm-btn') : null;
    if (el) { const r = el.getBoundingClientRect(); el.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px'); el.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px'); }
    const card = e.target && e.target.closest ? e.target.closest('.scn-card') : null;
    if (tilted && tilted !== card) { tilted.style.setProperty('--rx', '0deg'); tilted.style.setProperty('--ry', '0deg'); tilted = null; }
    if (card) {
      const r = card.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--rx', (-py * 9).toFixed(2) + 'deg'); card.style.setProperty('--ry', (px * 11).toFixed(2) + 'deg'); tilted = card;
    }
  }
  m.addEventListener('pointermove', e => { ev = e; if (!tick) tick = requestAnimationFrame(pointer); });
  m.addEventListener('pointerleave', () => { m.style.setProperty('--px', '0'); m.style.setProperty('--py', '0'); if (tilted) { tilted.style.setProperty('--rx', '0deg'); tilted.style.setProperty('--ry', '0deg'); tilted = null; } });

  // click ripple on any button
  m.addEventListener('pointerdown', e => {
    const el = e.target && e.target.closest ? e.target.closest('.mm-item,.mm-btn') : null;
    if (!el || el.disabled) return;
    const r = el.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.6;
    const s = document.createElement('span'); s.className = 'mm-rip';
    s.style.cssText = 'left:' + (e.clientX - r.left) + 'px;top:' + (e.clientY - r.top) + 'px;width:' + d + 'px;height:' + d + 'px';
    el.appendChild(s); setTimeout(() => { if (s.parentNode) s.parentNode.removeChild(s); }, 720);
  });
}

// ---------- Workshop: built-in browser + built-in downloader (no Steam account needed) ----------
// The browser is an NW.js <webview> (its own sandboxed "partition": no Node access, separate cookies from the game).
// The downloader takes a Workshop link or item id and installs the add-on into the mods folder:
//   1) public Steam Web API (no key, no login) -> if the item has a direct file link, download + unzip it;
//   2) otherwise the item lives in Steam's depot system -> fetch it with Valve's own SteamCMD, anonymous login.
const WSB_HOME = 'https://steamcommunity.com/app/4932460/';
const WSB_LIST = 'https://steamcommunity.com/app/4932460/workshop/';
function _wsbApp() { return String((typeof window !== 'undefined' && typeof window.STEAM_APP_ID !== 'undefined') ? window.STEAM_APP_ID : '4932460'); }
function _wsbMB(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
function _wsbSlug(t) { return String(t || 'addon').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'addon'; }
function _wsbParseIds(text) {
  const out = [];
  for (const tok of String(text || '').split(/[\s,;]+/)) {
    if (!tok) continue;
    const m = /(?:[?&]id=|CommunityFilePage\/|filedetails\/)(\d{5,20})/i.exec(tok) || /^(\d{5,20})$/.exec(tok);
    if (m && out.indexOf(m[1]) < 0) out.push(m[1]);
  }
  return out;
}
function _wsbPageId(url) { const m = /\/(?:sharedfiles|workshop)\/filedetails\/?\?(?:[^#]*&)?id=(\d{5,20})/i.exec(String(url || '')); return m ? m[1] : null; }

function _wsbHttp(url, opt, onProg, depth) {
  opt = opt || {}; depth = depth || 0;
  return new Promise((res, rej) => {
    let u; try { u = new URL(url); } catch (e) { return rej(new Error('Bad address')); }
    if (u.protocol !== 'https:') return rej(new Error('Only https downloads are allowed'));
    const req = require('https').request({ method: opt.body ? 'POST' : 'GET', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      headers: Object.assign({ 'User-Agent': 'EarthSimulator-Workshop/1.0' }, opt.headers || {}), timeout: 30000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume(); if (depth >= 5) return rej(new Error('Too many redirects'));
        return _wsbHttp(new URL(r.headers.location, url).href, { max: opt.max }, onProg, depth + 1).then(res, rej);
      }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('Server answered HTTP ' + r.statusCode)); }
      const total = +r.headers['content-length'] || 0, cap = opt.max || 300 * 1048576, parts = []; let got = 0;
      r.on('data', c => { got += c.length; if (got > cap) { req.destroy(new Error('The file is too large')); return; } parts.push(c); if (onProg) onProg(got, total); });
      r.on('end', () => res(Buffer.concat(parts))); r.on('error', rej);
    });
    req.on('timeout', () => req.destroy(new Error('The connection timed out')));
    req.on('error', rej);
    if (opt.body) req.write(opt.body);
    req.end();
  });
}
async function _wsbDetails(id) {
  const body = 'itemcount=1&publishedfileids%5B0%5D=' + id;
  const buf = await _wsbHttp('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
    { body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, max: 1048576 });
  let j; try { j = JSON.parse(buf.toString('utf8')); } catch (e) { throw new Error('Steam sent an unreadable answer'); }
  const d = j && j.response && j.response.publishedfiledetails && j.response.publishedfiledetails[0];
  if (!d || d.result !== 1) throw new Error('Item not found — it may be private, hidden or deleted');
  return d;
}

// minimal zip reader (zlib is built into Node). Guards: zip-slip paths, encrypted/zip64, entry count, unpacked size
function _wsbUnzip(buf, dest) {
  const fs = require('fs'), path = require('path'), zlib = require('zlib');
  let e = buf.length - 22; const lim = Math.max(0, buf.length - 65557);
  while (e >= lim && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < lim) throw new Error('The file is not a valid zip archive');
  const cnt = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  if (cnt === 0xFFFF || p === 0xFFFFFFFF) throw new Error('Zip64 archives are not supported');
  if (cnt > 5000) throw new Error('The archive has too many files');
  const ents = []; let total = 0;
  for (let i = 0; i < cnt; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The zip archive is damaged');
    const flag = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), cs = buf.readUInt32LE(p + 20), us = buf.readUInt32LE(p + 24),
      nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl).replace(/\\/g, '/');
    p += 46 + nl + el + cl;
    if (name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(name)) continue;
    if (flag & 1) throw new Error('Encrypted archives are not supported');
    if (/^([a-zA-Z]:|\/)/.test(name) || name.split('/').some(s => s === '..')) throw new Error('The archive contains an unsafe path');
    total += us; if (total > 400 * 1048576) throw new Error('The archive is too large once unpacked');
    ents.push({ name, method, cs, us, off });
  }
  if (!ents.length) throw new Error('The archive is empty');
  // everything inside one top-level folder (and no mod.json at the root)? lift it out
  let strip = '';
  if (!ents.some(x => x.name === 'mod.json')) {
    const top = ents[0].name.split('/')[0];
    if (ents.every(x => x.name.indexOf('/') > 0 && x.name.split('/')[0] === top)) strip = top + '/';
  }
  const root = path.resolve(dest) + path.sep;
  for (const x of ents) {
    if (buf.readUInt32LE(x.off) !== 0x04034b50) throw new Error('The zip archive is damaged');
    const ds = x.off + 30 + buf.readUInt16LE(x.off + 26) + buf.readUInt16LE(x.off + 28);
    const raw = buf.subarray(ds, ds + x.cs);
    let data;
    if (x.method === 0) data = raw;
    else if (x.method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: x.us + 1024 });
    else throw new Error('Unsupported zip compression');
    if (data.length !== x.us) throw new Error('The zip archive is damaged');
    const out = path.resolve(dest, ...(strip ? x.name.slice(strip.length) : x.name).split('/'));
    if (out.indexOf(root) !== 0) throw new Error('The archive contains an unsafe path');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
  }
  return ents.length;
}
function _wsbModsDir() {
  const fs = require('fs'), path = require('path');
  let d = null; try { d = (typeof modsDir === 'function') ? modsDir() : null; } catch (e) {}
  if (!d) d = path.join(path.dirname(process.execPath), 'mods');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function _wsbRm(p) { try { require('fs').rmSync(p, { recursive: true, force: true }); } catch (e) {} }
function _wsbCopy(src, dst) {
  const fs = require('fs'), path = require('path');
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const a = path.join(src, n), b = path.join(dst, n);
    if (fs.statSync(a).isDirectory()) _wsbCopy(a, b); else fs.copyFileSync(a, b);
  }
}
// move a finished folder into place: it must hold a mod.json (lifted out of a lone sub-folder if needed)
function _wsbPlace(tmp, fin) {
  const fs = require('fs'), path = require('path');
  let src = tmp;
  if (!fs.existsSync(path.join(src, 'mod.json'))) {
    const subs = fs.readdirSync(tmp).filter(n => fs.statSync(path.join(tmp, n)).isDirectory());
    if (subs.length === 1 && fs.existsSync(path.join(tmp, subs[0], 'mod.json'))) src = path.join(tmp, subs[0]);
    else throw new Error('This item does not contain a mod.json, so it is not an add-on this game can load');
  }
  _wsbRm(fin); fs.renameSync(src, fin);
  if (src !== tmp) _wsbRm(tmp);
}
async function _wsbInstallDirect(d, row) {
  const path = require('path'), root = _wsbModsDir(), name = _wsbSlug(d.title) + '-' + d.publishedfileid;
  const tmp = path.join(root, '.ws_tmp_' + d.publishedfileid);
  const buf = await _wsbHttp(d.file_url, { max: 300 * 1048576 }, (g, t) => row.prog(t ? g / t : -1, g));
  row.prog(1); row.status('Unpacking…');
  _wsbRm(tmp);
  try {
    if (!(buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50)) throw new Error('The download is not a zip archive, so it is not an add-on this game can load');
    _wsbUnzip(buf, tmp);
    _wsbPlace(tmp, path.join(root, name));
  } catch (e) { _wsbRm(tmp); throw e; }
  return name;
}
// ---- SteamCMD (Valve's official tool) for items without a direct link ----
function _wsbCmdDir() { const path = require('path'); return path.join(path.dirname(process.execPath), 'steamcmd'); }
function _wsbCmdExe() {
  const fs = require('fs'), path = require('path'), win = process.platform === 'win32';
  let saved = null; try { saved = localStorage.getItem('earthsim.steamcmd'); } catch (e) {}
  for (const x of [saved, path.join(_wsbCmdDir(), win ? 'steamcmd.exe' : 'steamcmd.sh')]) { try { if (x && fs.existsSync(x)) return x; } catch (e) {} }
  return null;
}
function _wsbRunCmd(exe, args, onLine) {
  return new Promise((res, rej) => {
    const path = require('path');
    const cp = require('child_process').spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
    let out = ''; const t = setTimeout(() => { try { cp.kill(); } catch (e) {} rej(new Error('SteamCMD took too long and was stopped')); }, 15 * 60000);
    const feed = c => { const s = c.toString('utf8'); out += s; if (out.length > 100000) out = out.slice(-50000); if (onLine) s.split(/\r?\n|\r/).forEach(l => { l = l.trim(); if (l) onLine(l); }); };
    cp.stdout.on('data', feed); cp.stderr.on('data', feed);
    cp.on('error', e => { clearTimeout(t); rej(e); });
    cp.on('close', code => { clearTimeout(t); res({ code, out }); });
  });
}
async function _wsbGetSteamcmd(row) {
  const fs = require('fs'), path = require('path'), win = process.platform === 'win32', dir = _wsbCmdDir();
  fs.mkdirSync(dir, { recursive: true });
  row.status('Downloading SteamCMD…');
  const buf = await _wsbHttp(win ? 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' : 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz',
    { max: 60 * 1048576 }, (g, t) => row.prog(t ? g / t : -1, g));
  if (win) _wsbUnzip(buf, dir);
  else {
    const tgz = path.join(dir, 'steamcmd.tgz'); fs.writeFileSync(tgz, buf);
    await new Promise((res, rej) => require('child_process').execFile('tar', ['-xzf', tgz, '-C', dir], e => e ? rej(new Error('Could not unpack SteamCMD (is "tar" installed?)')) : res()));
    _wsbRm(tgz);
  }
  const exe = path.join(dir, win ? 'steamcmd.exe' : 'steamcmd.sh');
  if (!fs.existsSync(exe)) throw new Error('SteamCMD did not unpack correctly');
  try { fs.chmodSync(exe, 0o755); } catch (e) {}
  row.prog(-1); row.status('Letting SteamCMD update itself (first run only, can take a minute)…');
  await _wsbRunCmd(exe, ['+quit'], l => row.line(l));
  return exe;
}
async function _wsbInstallCmd(d, row) {
  const fs = require('fs'), path = require('path');
  let exe = _wsbCmdExe();
  if (!exe) {
    const a = await row.ask('This item is stored in Steam\u2019s depot system, so it has no direct download link. SteamCMD (Valve\u2019s official command-line tool, anonymous login, a few MB) can fetch it. Download SteamCMD into the game\u2019s \u201csteamcmd\u201d folder?', ['Download SteamCMD', 'Cancel']);
    if (a !== 0) throw new Error('Cancelled');
    exe = await _wsbGetSteamcmd(row);
  }
  const app = String(d.consumer_app_id || _wsbApp()), id = String(d.publishedfileid), work = path.join(path.dirname(exe), 'ws_tmp');
  row.prog(-1); row.status('Downloading through SteamCMD…');
  const r = await _wsbRunCmd(exe, ['+force_install_dir', work, '+login', 'anonymous', '+workshop_download_item', app, id, '+quit'], l => row.line(l));
  const src = path.join(work, 'steamapps', 'workshop', 'content', app, id);
  if (!fs.existsSync(src)) {
    _wsbRm(work);
    if (/access denied|no subscription|not logged|failure/i.test(r.out)) throw new Error('Steam refused the anonymous download: this item can only be fetched by an account that owns the game');
    throw new Error('SteamCMD did not download the item. Last message: ' + ((r.out.trim().split(/\r?\n/).pop() || 'none').slice(0, 160)));
  }
  const root = _wsbModsDir(), name = _wsbSlug(d.title) + '-' + id, tmp = path.join(root, '.ws_tmp_' + id);
  _wsbRm(tmp);
  try { _wsbCopy(src, tmp); _wsbPlace(tmp, path.join(root, name)); } catch (e) { _wsbRm(tmp); _wsbRm(work); throw e; }
  _wsbRm(work);
  return name;
}

// ---- UI: progress rows ----
function _wsbRow(m, id) {
  const log = m.querySelector('#wsb-log');
  const el = document.createElement('div'); el.className = 'wsb-item';
  el.innerHTML = "<div class='wsb-top'><b></b><span class='s'></span></div><div class='wsb-prog'><i></i></div><div class='wsb-ln'></div><div class='wsb-msg' style='display:none'></div><div class='wsb-acts'></div>";
  log.insertBefore(el, log.firstChild);
  while (log.children.length > 12) log.removeChild(log.lastChild);
  const q = s => el.querySelector(s);
  q('b').textContent = 'Item ' + id;
  const row = {
    title(t) { q('b').textContent = t; q('b').title = t; },
    status(t, cls) { const s = q('.s'); s.textContent = t; s.className = 's' + (cls ? ' ' + cls : ''); },
    prog(f, bytes) {
      const p = q('.wsb-prog');
      if (f < 0) p.classList.add('ind'); else { p.classList.remove('ind'); q('.wsb-prog i').style.width = Math.round(Math.min(1, f) * 100) + '%'; }
      if (bytes != null) row.status('Downloading… ' + _wsbMB(bytes));
    },
    line(t) { q('.wsb-ln').textContent = String(t).slice(0, 200); },
    ask(msg, labels) {
      return new Promise(res => {
        const mm = q('.wsb-msg'); mm.textContent = msg; mm.style.display = '';
        const acts = q('.wsb-acts'); acts.innerHTML = '';
        labels.forEach((l, i) => { const b = document.createElement('button'); b.className = 'mm-btn' + (i === 0 ? ' go' : ''); b.textContent = l;
          b.addEventListener('click', () => { acts.innerHTML = ''; mm.style.display = 'none'; res(i); }); acts.appendChild(b); });
      });
    },
    done(ok) { q('.wsb-prog').classList.remove('ind'); if (ok !== null) q('.wsb-prog i').style.width = ok ? '100%' : '0%'; q('.wsb-ln').textContent = ''; el.classList.add(ok === true ? 'ok' : ok === false ? 'bad' : 'skip'); },
  };
  return row;
}
function _wsbAskOn(m) { const c = m.querySelector('#wsb-ask'); return !c || c.checked; }
async function _wsbProcess(m, id) {
  const row = _wsbRow(m, id);
  try {
    if (typeof require !== 'function') throw new Error('The downloader only works in the desktop version of the game');
    row.prog(-1); row.status('Looking the item up on Steam…');
    const d = await _wsbDetails(id);
    const title = String(d.title || ('Item ' + id)); row.title(title);
    const app = String(d.consumer_app_id || ''), size = +d.file_size || 0, direct = !!d.file_url;
    const note = [direct ? 'direct download' : 'Steam depot (SteamCMD)', size ? _wsbMB(size) : '', (app && app !== _wsbApp()) ? 'made for another game (app ' + app + ')' : ''].filter(Boolean).join(' · ');
    if (_wsbAskOn(m)) {
      row.prog(0); row.status('Ready — ' + note);
      const a = await row.ask('Add-ons can contain scripts that run inside the game. Install only add-ons you trust.', ['Install', 'Skip']);
      if (a !== 0) { row.status('Skipped'); row.done(null); return; }
    }
    const name = direct ? await _wsbInstallDirect(d, row) : await _wsbInstallCmd(d, row);
    row.status('Installed in mods/' + name + ' — restart the game to activate it', 'ok'); row.done(true);
    try { if (typeof modsLoadLocal === 'function') modsLoadLocal(); } catch (e) {}
    try { _refreshModList(); _modShowRestart(); } catch (e) {}
    flash('Installed: ' + title);
  } catch (e) { row.status(String((e && e.message) || e), 'bad'); row.done(false); }
}
function _wsbQueue(m, ids) { for (const id of ids) m._wsbQ = (m._wsbQ || Promise.resolve()).then(() => _wsbProcess(m, id)); }

// ---- UI: the browser pane ----
function _wsbWire(m, openPane) {
  const view = m.querySelector('#wsb-view'), url = m.querySelector('#wsb-url'), inp = m.querySelector('#wsb-in'), cur = m.querySelector('#wsb-cur');
  const ext = u => { try { if (window.nw && nw.Shell) { nw.Shell.openExternal(u); return; } } catch (e) {} window.open(u, '_blank'); };
  try { const a = localStorage.getItem('earthsim.wsask'); if (a === '0') m.querySelector('#wsb-ask').checked = false; } catch (e) {}
  m.querySelector('#wsb-ask').addEventListener('change', e => { try { localStorage.setItem('earthsim.wsask', e.target.checked ? '1' : '0'); } catch (err) {} });
  function ensure() {
    if (m._wv) return m._wv;
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:earthsim-workshop');
    wv.setAttribute('src', WSB_HOME);
    view.insertBefore(wv, view.firstChild); m._wv = wv;
    wv.addEventListener('loadstart', e => { if (e.isTopLevel !== false) view.classList.add('loading'); });
    wv.addEventListener('loadstop', () => view.classList.remove('loading'));
    wv.addEventListener('loadabort', () => view.classList.remove('loading'));
    wv.addEventListener('loadcommit', e => {
      if (e.isTopLevel === false) return;
      url.value = e.url || ''; const id = _wsbPageId(e.url); m._wsbCur = id;
      cur.disabled = !id; cur.textContent = id ? 'Download this item (#' + id + ')' : 'Download this item';
    });
    wv.addEventListener('newwindow', e => { try { e.preventDefault(); } catch (err) {} if (e.targetUrl) wv.src = e.targetUrl; });   // pop-ups stay inside the same browser
    setTimeout(() => { if (typeof wv.reload !== 'function') m.querySelector('#wsb-fb').style.display = 'flex'; }, 800);   // no <webview> in this runtime
    return wv;
  }
  m._wsbShow = () => { const wv = ensure(); try { if (wv.setAudioMuted) wv.setAudioMuted(false); } catch (e) {} };
  m._wsbHide = () => { try { if (m._wv && m._wv.setAudioMuted) m._wv.setAudioMuted(true); } catch (e) {} };
  const nav = (id, fn) => m.querySelector(id).addEventListener('click', () => { const wv = m._wv; if (wv) try { fn(wv); } catch (e) {} });
  nav('#wsb-back', wv => { if (wv.canGoBack && wv.canGoBack()) wv.back(); });
  nav('#wsb-fwd', wv => { if (wv.canGoForward && wv.canGoForward()) wv.forward(); });
  nav('#wsb-reload', wv => wv.reload());
  nav('#wsb-home', wv => { wv.src = WSB_HOME; });
  nav('#wsb-mods', wv => { wv.src = WSB_LIST; });
  m.querySelector('#wsb-ext').addEventListener('click', () => ext((m._wv && url.value) || WSB_HOME));
  m.querySelector('#wsb-fb-ext').addEventListener('click', () => ext(WSB_LIST));
  m.querySelector('#wsb-installed').addEventListener('click', () => openPane('mods', true));
  function go() { const ids = _wsbParseIds(inp.value); if (!ids.length) { flash('Paste a Workshop link or an item number first'); return; } inp.value = ''; _wsbQueue(m, ids); }
  m.querySelector('#wsb-go').addEventListener('click', go);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  cur.addEventListener('click', () => { if (m._wsbCur) _wsbQueue(m, [m._wsbCur]); });
  m.querySelector('#wsb-paste').addEventListener('click', () => {
    try { const t = nw.Clipboard.get().get('text'); if (t) { inp.value = t; inp.focus(); return; } } catch (e) {}
    inp.focus(); flash('Press Ctrl+V to paste');
  });
}

// закрыть открытый раздел (X / «Отмена» / Esc), оставив меню на экране
function closeMenuPane() {
  if (typeof netUiPendingDrop === 'function') netUiPendingDrop();
  const m = _menuEl; if (!m || !_curPane) return false;
  if (_curPane === 'set') { if (_kbPane) _kbPane.stop(); _restoreSettings(); }        // выход из настроек без «Применить» = отмена
  _curPane = null;
  if (m._wsbHide) m._wsbHide();
  m.classList.remove('pane');
  m.querySelector('#mm-dialog').classList.remove('show');
  m.querySelector('#mmd-foot').classList.remove('show');
  m.querySelectorAll('.mm-item').forEach(x => x.classList.remove('on'));
  m.querySelectorAll('.mm-pane').forEach(p => p.classList.remove('on'));
  const cont = m.querySelector(".mm-item[data-pane='continue']"); if (cont) cont.classList.add('primary');
  return true;
}

// ---- снимок настроек: «Отмена» возвращает всё как было до открытия раздела ----
let _setSnap = null;
function _snapSettings() {
  const s = (typeof SFX !== 'undefined') ? SFX.settings() : null;
  let hide = false; try { hide = localStorage.getItem('earthsim.hideHelp') === '1'; } catch (e) {}
  _setSnap = {
    on: s ? s.on : true, music: s ? s.music : true, vol: s ? s.vol : 0.8, mvol: s ? s.mvol : 0.6,
    fs: isFullscreen(), hints: (typeof TUT !== 'undefined') ? TUT.hintsEnabled() : true, coach: !hide,
    notify: (typeof notifyOn === 'function') ? notifyOn() : true, autosave: autosaveMinutes(),
    gfx: (typeof GFX !== 'undefined') ? Object.assign({}, GFX) : null,
    keys: (typeof KEYS !== 'undefined') ? KEYS.snapshot() : null,
    gp: (typeof gpSnapshot === 'function') ? gpSnapshot() : null,
  };
}
function _restoreSettings() {
  const s = _setSnap; if (!s) return;
  if (typeof SFX !== 'undefined') { SFX.setOn(s.on); SFX.setMusic(s.music); SFX.setVol(s.vol); SFX.setMusicVol(s.mvol); }
  if (isFullscreen() !== s.fs) setFullscreen(s.fs);
  if (typeof TUT !== 'undefined') TUT.setHints(s.hints);
  try { localStorage.setItem('earthsim.hideHelp', s.coach ? '0' : '1'); } catch (e) {}
  if (typeof setNotify === 'function') setNotify(s.notify);
  try { localStorage.setItem('earthsim.autosave', String(s.autosave)); } catch (e) {}
  if (s.gfx && typeof GFX !== 'undefined') {
    const changed = Object.keys(s.gfx).some(k => GFX[k] !== s.gfx[k]);
    if (changed) { Object.assign(GFX, s.gfx); gfxSave(); gfxApply(); }   // пересобираем буферы только если игрок реально что-то менял
  }
  if (s.keys != null && typeof KEYS !== 'undefined') KEYS.restore(s.keys);         // клавиши, переназначенные в этом разделе, — тоже под «Отмену»
  if (s.gp != null && typeof gpRestore === 'function') gpRestore(s.gp);             // и кнопки контроллера
  _setSnap = null;
  _syncSettingsPane();
}
// «Сейчас играет»: имя трека обновляется раз в секунду, пока раздел настроек открыт (таймер сам гаснет)
let _npTimer = 0;
function _syncNowPlaying() {
  const m = _menuEl; if (!m) return;
  const el = m.querySelector('#set-np'); if (!el) return;
  let np = null; try { np = (typeof SFX !== 'undefined' && SFX.nowPlaying) ? SFX.nowPlaying() : null; } catch (e) {}
  const mus = typeof SFX !== 'undefined' && SFX.settings().music;
  const txt = !mus ? 'music is off' : np && np.name ? np.name : 'a pause between tracks';
  const tm = np && np.dur > 0 && mus ? `<small>${Math.floor(np.t / 60)}:${String(Math.floor(np.t % 60)).padStart(2, '0')} / ${Math.floor(np.dur / 60)}:${String(Math.floor(np.dur % 60)).padStart(2, '0')}</small>` : '';
  el.innerHTML = _esc(txt) + tm;
  const nx = m.querySelector('#set-next'); if (nx) nx.disabled = !!(np && np.mod);
  const sel = m.querySelector('#set-track'); if (sel) sel.disabled = !!(np && np.mod);
}
function _npTick() {
  const m = _menuEl, pane = m && m.querySelector(".mm-pane[data-pane='set']");
  if (!m || !m.classList.contains('show') || !pane || !pane.classList.contains('on')) { clearInterval(_npTimer); _npTimer = 0; return; }
  _syncNowPlaying();
}
// вкладки раздела «Настройки»: общие и «Управление» (назначение клавиш строит keys.js); уход со вкладки отменяет ожидание новой клавиши
let _kbPane = null;
function _kbShow(which) {
  const m = _menuEl; if (!m) return;
  if (typeof keysStyle === 'function') keysStyle();
  if (_kbPane) _kbPane.stop();
  m.querySelectorAll('.kb-tab').forEach(b => b.classList.toggle('on', b.dataset.kb === which));
  const main = m.querySelector('#kb-main'), keys = m.querySelector('#kb-keys'); if (!main || !keys) return;
  main.style.display = which === 'main' ? '' : 'none'; keys.style.display = which === 'keys' ? '' : 'none';
  if (which === 'keys' && typeof keysBuildPane === 'function') _kbPane = keysBuildPane(keys);
  m.querySelector('.mmd-body').scrollTop = 0;
}
function _syncSettingsPane() {
  const m = _menuEl; if (!m) return;
  const trSel = m.querySelector('#set-track');
  if (trSel && typeof SFX !== 'undefined' && SFX.tracks) {
    const list = SFX.tracks() || [];
    trSel.innerHTML = `<option value=''>Play a track…</option>` + list.map(t => `<option value='${_esc(t.id)}'>${_esc(t.name)}</option>`).join('');
    trSel.style.display = list.length ? '' : 'none';
  }
  _syncNowPlaying();
  if (!_npTimer) _npTimer = setInterval(_npTick, 1000);
  if (typeof curLang === 'function') {
    const cur = curLang();
    m.querySelectorAll('input[name=mm-lang]').forEach(r => r.checked = (r.value === cur));
  }
  if (typeof unitsGet === 'function') { const u = unitsGet(); m.querySelector('#set-utemp').value = u.temp; m.querySelector('#set-ulen').value = u.len; }
  if (typeof SFX !== 'undefined') {
    const s = SFX.settings();
    m.querySelector('#set-snd').checked = s.on;
    m.querySelector('#set-mus').checked = s.music;
    m.querySelector('#set-vol').value = Math.round(s.vol * 100); m.querySelector('#set-vol-v').textContent = Math.round(s.vol * 100) + '%';
    m.querySelector('#set-mvol').value = Math.round(s.mvol * 100); m.querySelector('#set-mvol-v').textContent = Math.round(s.mvol * 100) + '%';
  }
  m.querySelector('#set-fs').checked = isFullscreen();
  m.querySelector('#set-hints').checked = (typeof TUT !== 'undefined') ? TUT.hintsEnabled() : true;
  m.querySelector('#set-show-tut').style.display = (typeof TUT !== 'undefined') ? '' : 'none';
  let hide = false; try { hide = localStorage.getItem('earthsim.hideHelp') === '1'; } catch (e) {}
  m.querySelector('#set-coach').checked = !hide;
  m.querySelector('#set-notify').checked = (typeof notifyOn === 'function') ? notifyOn() : true;
  m.querySelector('#set-autosave').value = String(autosaveMinutes());
  if (typeof rainK === 'function' && typeof RAIN_LEVELS !== 'undefined') { const k = rainK(); m.querySelector('#set-rain').value = String(RAIN_LEVELS.reduce((a, b) => Math.abs(b - k) < Math.abs(a - k) ? b : a, 1)); }
  _syncGfxPane();
  _syncSliders();
}
function _syncGfxPane() {
  const m = _menuEl; if (!m || typeof GFX === 'undefined') return;
  const custom = !GFX_PRESETS[GFX.preset];
  const row = m.querySelector('#gfx-custom-row'); if (row) row.style.display = custom ? '' : 'none';   // «Своё» показываем, только когда галочки не совпали с пресетом
  m.querySelectorAll('input[name=mm-gfx]').forEach(r => r.checked = custom ? (r.value === 'custom') : (r.value === GFX.preset));
  m.querySelector('#gfx-tex').checked = !!GFX.tex3d;
  m.querySelector('#gfx-base').checked = GFX.base >= 2;
  m.querySelector('#gfx-water').checked = GFX.water >= 1;
  m.querySelector('#gfx-post').checked = !!GFX.post;
  m.querySelector('#gfx-clouds').checked = !!GFX.clouds;
  m.querySelector('#gfx-night').checked = GFX.night !== false;
  for (const [id, key] of [['gfx-shadows', 'shadows'], ['gfx-water3d', 'water3d'], ['gfx-detail', 'detail'], ['gfx-aa', 'aa']]) m.querySelector('#' + id).value = String(GFX[key] | 0);
  const sc = Math.round((GFX.scale || 1) * 100); m.querySelector('#gfx-scale').value = sc; m.querySelector('#gfx-scale-v').textContent = sc + '%';
}

// ---- полный экран: в NW.js используем НАТИВНОЕ окно (переживает перезагрузку страницы
// при создании мира/загрузке — Fullscreen API браузера при reload слетает) ----
function setFullscreen(v) {
  try { localStorage.setItem('earthsim.fs', v ? '1' : '0'); } catch (e) {}
  try { if (window.nw && nw.Window) { const win = nw.Window.get(); if (v) win.enterFullscreen(); else win.leaveFullscreen(); return; } } catch (e) {}
  try { if (v) document.documentElement.requestFullscreen(); else if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
}
function isFullscreen() {
  try { if (window.nw && nw.Window) return !!nw.Window.get().isFullscreen; } catch (e) {}
  return !!document.fullscreenElement;
}
// восстановление полного экрана после reload (зовётся из main.js при старте)
function restoreFullscreen() {
  try { if (localStorage.getItem('earthsim.fs') === '1' && window.nw) setFullscreen(true); } catch (e) {}
}
// «Мастерская» главного меню — из уведомлений о дополнениях (кнопка «Открыть»)
// окно сетевой игры (2.1.4: вход по приглашению друга Steam — пароль и «Подключение…» показываются там)
function menuOpenNet() {
  showMainMenu();
  const it = _menuEl && _menuEl.querySelector(".mm-item[data-pane='net']"); if (it) it.click();
}
// окно достижений на нужной вкладке (2.1.4: «Таблицы лидеров» прямо из окна сетевой игры)
function menuOpenAch(tab) {
  if (tab && typeof achTab === 'function') achTab(tab);
  showMainMenu();
  const it = _menuEl && _menuEl.querySelector(".mm-item[data-pane='ach']"); if (it) it.click();
}
function menuOpenMods() {
  showMainMenu();
  if (_menuEl && _menuEl._openPane) { _menuEl._openPane('mods', true); return; }
  const it = _menuEl && _menuEl.querySelector(".mm-item[data-pane='mods']"); if (it) it.click();
}
// «Перезапустить игру» в «Мастерской». Прожитый мир уходит в автосохранение, как при выходе из игры; если оно выключено,
// а мир есть что терять, — спрашиваем (так было у этой кнопки всегда). После перезапуска — главное меню («Продолжить»)
function _modRelaunch() {
  const go = () => {
    try { sessionStorage.removeItem('earthsim.boot'); } catch (e) {}
    const ld = document.getElementById('loader'); if (ld) ld.classList.remove('hide');
    setTimeout(() => { try { location.reload(); } catch (e) {} }, 60);
  };
  if (_saveOnExit()) { go(); return; }
  let keep = false; try { keep = typeof worldWorthKeeping === 'function' && worldWorthKeeping(); } catch (e) {}
  if (!keep) { go(); return; }
  uiAsk('Restart the game? An unsaved world will be lost.', 'Restart', go);
}
// список изменён: заметка «перезапустите» и подсвеченная кнопка «Перезапустить игру»
function _modShowRestart() {
  if (!_menuEl) return;
  const note = _menuEl.querySelector('#mm-mod-restart'); if (note) note.style.display = '';
  const rb = _menuEl.querySelector('#mm-mod-reload'); if (rb) { rb.classList.remove('alt'); rb.classList.add('go'); }
}
// список установленных дополнений + кнопка публикации для локальных папок
function _refreshModList() {
  const box = _menuEl && _menuEl.querySelector('#mm-mod-list'); if (!box) return;
  box.innerHTML = '';
  const mods = (typeof MODS !== 'undefined') ? MODS : [];
  if (!mods.length) {
    const d = document.createElement('div'); d.className = 'mm-empty';
    d.textContent = (typeof modsDir === 'function' && modsDir())
      ? 'No add-ons yet. Subscribe to them in the Workshop or drop a folder with mod.json into the mods folder.'
      : 'Add-ons work in the Steam build.';
    box.appendChild(d); return;
  }
  let dirty = false;                                   // менялись ли галочки с момента входа в раздел
  for (const mod of mods) {
    const row = document.createElement('div'); row.className = 'mm-save';
    // включение/отключение: применяется при перезапуске, потому что баланс, эпохи и
    // текстуры мод правит один раз при загрузке игры
    const on = document.createElement('label'); on.className = 'mm-chk'; on.style.margin = '0';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !mod.off;
    const bx = document.createElement('span'); bx.className = 'bx';
    cb.addEventListener('change', () => {
      if (typeof modSetOn === 'function') modSetOn(mod, cb.checked);    // у дополнения с кодом она включает и код
      dirty = true;
      _modShowRestart();
      _refreshModList();                                                 // яркость строки, «отключён», «заработает после перезапуска»
    });
    on.appendChild(cb); on.appendChild(bx); row.appendChild(on);
    const nm = document.createElement('div'); nm.className = 'nm';
    const b = document.createElement('b'); b.textContent = mod.name;                       // textContent — имя из чужого мода не может «взломать» разметку
    const sp = document.createElement('span');
    sp.textContent = [
      mod.author ? _fmt('by {0}', mod.author) : '',
      mod.source === 'workshop' ? 'Workshop' : 'local',
      mod.off ? 'disabled' : _fmt('scenarios: {0}', mod.scenarios.length),
    ].filter(Boolean).join(' · ');
    if (mod.off) row.style.opacity = '0.55';
    nm.appendChild(b); nm.appendChild(sp);
    // Дополнение с кодом для игрока — такое же, как любое: одна галочка. Строка под названием появляется, только
    // когда есть что сказать: «заработает после перезапуска», «несовместимо…». Подробная причина — в подсказке (для автора)
    const cs = (typeof modCodeState === 'function') ? modCodeState(mod) : null;
    if (cs) {
      const cl = document.createElement('span'); cl.className = 'mm-code';
      cl.textContent = cs.st === 'pending' ? 'Will work after a restart'
        : cs.st === 'stopping' ? 'Will turn off after a restart'
        : (typeof modCodeShort === 'function' ? modCodeShort(cs.why) : '');
      const why = cs.st === 'bad' && typeof modCodeWhy === 'function' ? modCodeWhy(cs.why) : '';
      if (why) cl.title = why;
      cl.style.cssText = 'display:block;margin-top:2px;color:' + (cs.st === 'bad' ? '#ffb27a' : '#7cc2ff');
      nm.appendChild(cl);
    }
    row.appendChild(nm);
    if (mod.source === 'local') {
      const ed = document.createElement('button'); ed.textContent = 'Edit';
      ed.addEventListener('click', () => { if (window._meOpenEditor) window._meOpenEditor(mod.id); });
      row.appendChild(ed);
      const pub = document.createElement('button'); pub.textContent = 'Publish';
      pub.addEventListener('click', () => _publishMod(mod, pub));
      row.appendChild(pub);
      const del = document.createElement('button'); del.className = 'del'; del.textContent = 'Delete';
      del.title = 'Delete the add-on folder from disk';
      del.addEventListener('click', () => uiAsk(_fmt('Delete the add-on "{0}" from disk?\n\nThe folder {1} will be removed permanently. If the add-on is already published, the Workshop item stays — delete it on its item page.', mod.name, mod.dir), 'Delete', () => {
        const r = (typeof modDeleteLocal === 'function') ? modDeleteLocal(mod) : { ok: false, why: 'no_fn' };
        if (!r.ok) { flash('Could not delete: ' + r.why); return; }
        flash('Add-on deleted');
        _modShowRestart();
        _refreshModList();
      }, { danger: true, icon: 'trash', width: 560 }));
      row.appendChild(del);
    } else if (mod.source === 'workshop' && mod.wsId) {
      // подписку удаляет Steam — из игры только ведём на страницу предмета
      const op = document.createElement('button'); op.textContent = 'Workshop page';
      op.title = 'Unsubscribe there';
      op.addEventListener('click', () => {
        const url = 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + mod.wsId;
        if (!(window.steamAPI && window.steamAPI.openOverlay && window.steamAPI.openOverlay(url))) flash(url);
      });
      row.appendChild(op);
    }
    box.appendChild(row);
  }
}
// Числовые коды Steam (EResult) игроку ничего не говорят: «create result 21» выглядит как
// поломка игры, хотя это всего лишь оборвавшаяся связь клиента Steam с сервером.
const WS_ERESULT = {
  2:  'Steam refused the request',
  3:  'no connection to Steam',
  8:  'Steam rejected the item data',
  9:  'Steam could not find the item files',
  10: 'Steam is busy, try again',
  15: 'access denied: the game Workshop is not configured in Steamworks yet',
  16: 'Steam did not answer in time',
  17: 'the account is banned from publishing',
  20: 'the Steam service is temporarily unavailable',
  21: 'the Steam client lost its server connection — wait a minute and retry',
  24: 'the account is not allowed to upload content',
  25: 'Steam limit exceeded — try later',
  29: 'Steam is rate-limiting publications — try later',
};
function _wsFailText(res) {
  const s = res.replace('WSPUB_FAIL ', '').trim();
  const m = /^(create_result|submit_result)\s+(\d+)/.exec(s);
  if (m) {
    const e = WS_ERESULT[+m[2]];
    const why = e ? e : _fmt('Steam code {0}', m[2]);
    // причина сорвавшейся ЗАЛИВКИ (в отличие от создания) словами пишется только в лог
    // самого Steam — там, например, «no workshop depot found», чего API не сообщает
    return m[1] === 'submit_result'
      ? why + '. Details are in the Steam log: logs\\workshop_log.txt'
      : why;
  }
  if (s.indexOf('no_bridge') === 0) return 'the game was not launched from Steam';
  if (s.indexOf('create_timeout') === 0 || s.indexOf('submit_timeout') === 0) return 'Steam did not answer in time';
  if (s.indexOf('no_mod_json') === 0) return 'the add-on folder has no mod.json';
  if (s.indexOf('no_folder') === 0) return 'the add-on folder was not found';
  if (s.indexOf('no_ugc') === 0) return 'Steam did not grant Workshop access';
  return s;
}
// публикация — действие «наружу»: создаёт предмет в аккаунте игрока, поэтому спрашиваем явно
function _publishMod(mod, btn) {
  if (!(window.steamAPI && window.steamAPI.workshopPublish)) { flash('Publishing requires launching from Steam.'); return; }
  const known = (typeof modPublishedId === 'function') ? modPublishedId(mod) : '';
  const ask = known
    ? _fmt('Update Workshop item {1} with the contents of "{0}"? The item visibility stays as it is.', mod.name, known)
    : _fmt('Publish "{0}" to the Steam Workshop? The item is created HIDDEN in your account — you can make it public on its item page after accepting the Workshop agreement.', mod.name);
  uiAsk(ask, known ? 'Update' : 'Publish', () => _publishModGo(mod, btn, known), { title: 'Steam Workshop', icon: 'info', width: 560 });
}
function _publishModGo(mod, btn, known) {
  btn.disabled = true; btn.textContent = 'Uploading…';
  window.steamAPI.workshopPublish(mod.dir, mod.name, mod.desc, res => {
    if (res.indexOf('WSPUB_OK') === 0) {
      const id = res.split(' ')[1];
      btn.textContent = 'Published';
      flash(_fmt('Published. Open item {0} in the Workshop and make it visible.', id));
    } else if (res.indexOf('WSPUB_ID') === 0) {
      // предмет уже существует в аккаунте: запоминаем сразу, ДО заливки, — иначе
      // сорвавшаяся заливка оставила бы его сиротой, а следующая попытка создала бы новый
      const id = res.split(' ')[1];
      if (typeof modSetPublishedId === 'function') modSetPublishedId(mod, id);
      btn.textContent = 'Uploading…';
    } else {
      btn.disabled = false; btn.textContent = 'Publish';
      flash('Publishing failed: ' + _wsFailText(res));
    }
  }, known);
}
function _refreshScenarios() {
  const box = _menuEl && _menuEl.querySelector('#mm-scn-grid'); if (!box || typeof SCENARIOS === 'undefined') return;
  box.innerHTML = '';
  for (const sc of SCENARIOS) {
    const done = typeof scenarioCompleted === 'function' && scenarioCompleted(sc.id);
    const card = document.createElement('div'); card.className = 'scn-card';
    card.innerHTML = `${done ? `<span class='sc-done' title='Completed'>done</span>` : ''}<div class='sc-nm'>${_esc(sc.name)}</div><div class='sc-d'>${_esc(sc.desc)}</div>`;
    card.addEventListener('click', () => {
      const cfg = Object.assign({ w: 80, h: 60 }, sc.boot || {}, { scenario: sc.id });
      bootNewMap(cfg);
    });
    box.appendChild(card);
  }
}
// список сохранений в разделе «Сохранить»: клик — перезаписать текущей игрой
function _refreshOverwriteList() {
  const box = _menuEl && _menuEl.querySelector('#mm-overwritelist'); if (!box) return;
  const saves = listSaves();
  box.innerHTML = '';
  if (!saves.length) { const d = document.createElement('div'); d.className = 'mm-empty'; d.textContent = 'no saves yet'; box.appendChild(d); return; }
  const loc = curLocale();
  const fmtDate = ts => { if (!ts) return ''; const d = new Date(ts); return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }); };
  for (const name of saves) {
    const meta = _saveMeta(name) || {};
    const row = document.createElement('div'); row.className = 'mm-save'; row.style.cursor = 'pointer';
    const img = document.createElement('img'); if (meta.thumb) img.src = meta.thumb; row.appendChild(img);
    const nm = document.createElement('div'); nm.className = 'nm';
    const b = document.createElement('b'); b.textContent = name;
    const sp = document.createElement('span'); sp.textContent = [_fmt('year {0}', meta.year != null ? meta.year : '?'), fmtDate(meta.ts)].filter(Boolean).join(' · ');
    nm.appendChild(b); nm.appendChild(sp); row.appendChild(nm);
    const ow = document.createElement('button'); ow.textContent = 'Overwrite';
    const doOverwrite = () => uiAsk(_fmt('Overwrite "{0}" with the current game?', name), 'Overwrite', () => { const n = saveWorldToStorage(name); if (n) { _refreshOverwriteList(); flash('Overwritten: ' + n); } }, { danger: true });
    ow.addEventListener('click', e => { e.stopPropagation(); doOverwrite(); });
    row.addEventListener('click', doOverwrite);
    row.appendChild(ow);
    box.appendChild(row);
  }
}
function _refreshSaveList() {
  const box = _menuEl && _menuEl.querySelector('#mm-savelist'); if (!box) return;
  const saves = listSaves();
  box.innerHTML = '';
  if (!saves.length) { const d = document.createElement('div'); d.className = 'mm-empty'; d.textContent = 'no saves'; box.appendChild(d); }
  const loc = curLocale();
  const fmtDate = ts => { if (!ts) return ''; const d = new Date(ts); return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }); };
  const fmtN = n => n >= 1e6 ? _fmt('{0}M', (n / 1e6).toFixed(1)) : n >= 1e3 ? _fmt('{0}K', (n / 1e3).toFixed(0)) : '' + n;
  for (const name of saves) {
    const meta = _saveMeta(name) || {};
    const row = document.createElement('div'); row.className = 'mm-save';
    const img = document.createElement('img'); if (meta.thumb) img.src = meta.thumb; row.appendChild(img);
    const nm = document.createElement('div'); nm.className = 'nm';
    const b = document.createElement('b'); b.textContent = name;                            // textContent — имя не может «взломать» разметку
    const sp = document.createElement('span');
    sp.textContent = [meta.w && (meta.w + '×' + meta.h), meta.year != null && _fmt('year {0}', meta.year), meta.pop ? _fmt('{0} people', fmtN(meta.pop)) : '', meta.states ? _fmt('nations: {0}', meta.states) : '', fmtDate(meta.ts)].filter(Boolean).join(' · ');
    nm.appendChild(b); nm.appendChild(sp); row.appendChild(nm);
    const ld = document.createElement('button'); ld.textContent = 'Load';
    ld.addEventListener('click', () => {
      let wh = meta.w ? { w: meta.w, h: meta.h } : null;
      if (!wh) { const s = SaveStore.read(name); if (!s || !s.w) { uiAlert('The save is corrupted.'); return; } wh = { w: s.w, h: s.h }; }
      bootLoadMap(name, wh.w, wh.h);
    });
    row.appendChild(ld);
    const del = document.createElement('button'); del.className = 'del'; del.title = 'Delete'; del.innerHTML = MM_IC.trash();
    del.addEventListener('click', () => uiAsk(_fmt('Delete "{0}"?', name), 'Delete', () => { SaveStore.remove(name); _saveListCache = null; _refreshSaveList(); }, { danger: true, icon: 'trash' }));
    row.appendChild(del);
    box.appendChild(row);
  }
  // готовые миры включённых дополнений (mods.js): начать игру в любом из них
  const mw = (typeof modWorlds === 'function') ? modWorlds() : [];
  if (mw.length) {
    const hd = document.createElement('div'); hd.className = 'sl-lab'; hd.style.margin = '14px 11px 6px'; hd.textContent = 'Add-on worlds'; box.appendChild(hd);
    for (const w of mw) {
      const row = document.createElement('div'); row.className = 'mm-save';
      const img = document.createElement('img'); if (w.thumb) img.src = w.thumb; row.appendChild(img);
      const nm = document.createElement('div'); nm.className = 'nm';
      const b = document.createElement('b'); b.textContent = w.name;
      const sp = document.createElement('span'); sp.textContent = [w.modName, w.w + '×' + w.h, 'year ' + w.year].join(' · ');
      if (w.desc) sp.title = w.desc;
      nm.appendChild(b); nm.appendChild(sp); row.appendChild(nm);
      const go = document.createElement('button'); go.textContent = 'Start';
      go.addEventListener('click', () => { const r = modWorldStart(w.modId, w.id); if (r && !r.ok && typeof flash === 'function') flash('Could not open the world: ' + r.why); });
      row.appendChild(go); box.appendChild(row);
    }
  }
}

// ---- автосохранение и быстрое сохранение ----
let _menuStartup = !(typeof _boot !== 'undefined' && _boot);   // меню открыто при запуске игры (а не по Esc посреди партии)
const AUTOSAVE_NAME = () => 'Autosave', QUICK_NAME = () => 'Quick save';
// служебные ячейки называются на языке игры, но это ОДНА ячейка: после смены языка F9 находит сохранение
// под прежним именем, а новая запись убирает копию на другом языке — двух «быстрых» в списке не бывает
// Russian names are kept on purpose: old saves made by the Russian build still use them as slot names
const _SLOT_NAMES = { quick: ['Быстрое сохранение', 'Quick save'], auto: ['Автосохранение', 'Autosave'] };
function _slotFind(kind) { try { const names = _SLOT_NAMES[kind]; return SaveStore.list().find(x => names.indexOf(x.name) >= 0 && x.meta && x.meta.w) || null; } catch (e) { return null; } }
function _slotWrite(kind, name) {
  const n = saveWorldToStorage(name, true);
  if (n) for (const other of _SLOT_NAMES[kind]) if (other !== name) { try { SaveStore.remove(other); } catch (e) {} }
  _saveListCache = null;
  return n;
}
function autosaveMinutes() { try { const v = localStorage.getItem('earthsim.autosave'); return v === null ? 10 : Math.max(0, parseInt(v, 10) || 0); } catch (e) { return 10; } }
function _worldHasLife() { if (typeof states === 'undefined') return false; for (const s of states) if (s.alive) return true; return false; }
function _lastSave() {
  let bad = []; try { bad = JSON.parse(localStorage.getItem('earthsim.badsaves') || '[]'); } catch (e) {}
  try { const l = SaveStore.list(); for (const e of l) if (e.meta && e.meta.w && e.meta.h && bad.indexOf(e.name) < 0) return e; } catch (e) {}
  return null;
}
let _autoT = performance.now(), _autoYear = -1;
// зовётся из главного цикла раз в ~10 с. Пишем, только если мир жил и изменился: пустая планета и пауза в сейве не нуждаются
function autosaveTick() {
  const min = autosaveMinutes(); if (!min || W.paused) return;
  const now = performance.now(); if (now - _autoT < min * 60000) return;
  if (typeof walkActive !== 'undefined' && walkActive) return;
  _autoT = now;
  const y = Math.floor(W.simYear);
  if (!_worldHasLife() || y === _autoYear) return;
  _autoYear = y;
  if (_slotWrite('auto', AUTOSAVE_NAME())) flash('Game autosaved');
}
function quickSave() {
  const n = _slotWrite('quick', QUICK_NAME());
  flash(n ? 'Quick save done (F9 to load)' : 'Could not save the game');
}
function quickLoad() {
  const e = _slotFind('quick');
  if (!e) { flash('No quick save yet (F5 to save)'); return; }
  bootLoadMap(e.name, e.meta.w, e.meta.h);
}
// выход из игры с живым миром: тихо сохраняем, чтобы «Продолжить» вернуло ровно сюда
function _saveOnExit() { try { if (autosaveMinutes() > 0 && _worldHasLife() && W.simYear >= 1) { _slotWrite('auto', AUTOSAVE_NAME()); return true; } } catch (e) {} return false; }

function showMainMenu() {
  const m = _buildMenu();
  if (typeof demoMenuRefresh === 'function') demoMenuRefresh();
  m.classList.toggle('still', typeof GFX !== 'undefined' && (GFX.preset === 'fast' || !GFX.post));
  m.classList.add('show');
  const cont0 = m.querySelector(".mm-item[data-pane='continue']");
  if (cont0) {
    // при запуске «Продолжить» ведёт в последнее сохранение — подписываем, в какое именно
    const last = _menuStartup ? _lastSave() : null;
    cont0.textContent = 'Continue';
    if (last) { const sm = document.createElement('small'); sm.style.cssText = 'display:block;margin-top:4px;font-size:11px;font-weight:400;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      sm.textContent = last.name + (last.meta.year != null ? ' · ' + 'year ' + last.meta.year : ''); cont0.style.flexDirection = 'column'; cont0.style.alignItems = 'flex-start'; cont0.style.justifyContent = 'center'; cont0.appendChild(sm); }
  }
  if (!_curPane) { const cont = m.querySelector(".mm-item[data-pane='continue']"); if (cont) cont.classList.add('primary'); }
  // Пауза держится, пока открыто меню, и возвращается ровно такой, какой была. Повторный showMainMenu (меню уже на экране)
  // не должен перезаписывать «прежнюю» паузу уже включённой — иначе после закрытия мир остался бы стоять навсегда
  if (typeof W !== 'undefined' && !_menuHold) {
    _menuHold = true; MENU_UP = true; _prevPaused = W.paused; if (!netLive()) W.paused = true;
    // в прогулке мир идёт по своему времени (WK.time, сутки, жители), а не по W.paused: останавливаем и его
    if (typeof walkActive !== 'undefined' && walkActive && typeof WK !== 'undefined') { _prevWkPaused = WK.paused; WK.paused = true; _menuWk = true; }
    syncPlayGlyph();
  }
}
function hideMainMenu() {
  _menuStartup = false;
  if (_menuEl) { if (_curPane) closeMenuPane(); _menuEl.classList.remove('show'); }
  // восстанавливаем только то, что сами остановили: hideMainMenu зовут и тогда, когда меню не было открыто, — мир пользователя на паузе не трогаем
  if (typeof W !== 'undefined' && _menuHold) {
    _menuHold = false; MENU_UP = false; W.paused = netLive() ? NP.paused : _prevPaused;   // меню не оставляет игру «замороженной навсегда»
    if (_menuWk) { _menuWk = false; if (typeof walkActive !== 'undefined' && walkActive && typeof WK !== 'undefined') { WK.paused = _prevWkPaused; WK.last = 0; } }
    syncPlayGlyph();
  }
}
function syncPlayGlyph() { const g = document.getElementById('play-glyph'); if (g) g.textContent = W.paused ? 'Play' : 'Pause'; const b = document.getElementById('btn-play'); if (b) b.classList.toggle('paused', W.paused); }
function flash(msg, ms) { let f = document.getElementById('mm-flash'); if (!f) { f = document.createElement('div'); f.id = 'mm-flash'; f.style.cssText = 'pointer-events:none;position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:500;background:linear-gradient(180deg,rgba(13,30,54,.96),rgba(6,15,29,.96));color:#dbe9fb;padding:11px 22px;border-radius:12px;backdrop-filter:blur(10px);font-family:' + UI_FONT + ';font-size:13px;font-weight:600;border:1px solid rgba(90,160,235,.55);transition:opacity .4s;box-shadow:0 10px 30px rgba(0,0,0,.55),0 0 20px rgba(48,128,220,.2)'; document.body.appendChild(f); } f.textContent = msg; f.style.opacity = '1'; clearTimeout(f._t); f._t = setTimeout(() => f.style.opacity = '0', ms || 1900); }
// кнопка меню в HUD
function installMenuButton() {
  const b = document.getElementById('btn-menu');
  if (b && !b._wired) { b._wired = true; b.addEventListener('click', showMainMenu); }
  try { SaveStore.migrate(); } catch (e) {}                 // сохранения версии 1.x переезжают из localStorage на диск (один раз)
  // закрытие окна крестиком: сохраняем мир и только потом даём окну закрыться
  try { if (window.nw && nw.Window) { const win = nw.Window.get(); win.on('close', function () { _saveOnExit(); if (typeof demoFlush === 'function') demoFlush(); this.close(true); }); } } catch (e) {}
}