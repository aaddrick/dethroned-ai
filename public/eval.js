// The Chronicle: renders /api/eval, and the raw two-call record of any turn from /api/eval/turn/<id>.
const FACTIONS = ['church', 'people', 'army', 'treasury'];
const LABEL = { church: 'Church', people: 'People', army: 'Army', treasury: 'Treasury' };
const FLAW = { vain: 'Vain', pious: 'Pious', greedy: 'Greedy', warlike: 'Warlike', paranoid: 'Paranoid', indolent: 'Indolent' };
const DEATH = {
  church: { low: 'Excommunicated', high: 'Retired to a monastery' },
  people: { low: 'Revolution', high: 'Loved too well' },
  army: { low: 'Invaded', high: 'Military coup' },
  treasury: { low: 'Bankrupt', high: 'Gold rots' },
};
const LEVELS = ['Collapses', 'Falls', 'Unchanged', 'Rises', 'Surges'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const num = (v, d = 0) => (v == null ? '–' : Number(v).toFixed(d));
const wisdom = (w) => (w < 0.35 ? 'Reckless' : w < 0.65 ? 'Wary' : 'Shrewd');
const clip = (s, n = 150) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const delta = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');
const single = new URLSearchParams(location.search).get('turn');

function tile(value, label, note = '') {
  return `<div class="tile"><div class="value">${value}</div><div class="label">${label}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
}

// A thin horizontal bar: fill share of the track, label on the left, value on the right.
function bar(label, share, right, cls = '') {
  const w = share == null ? 0 : Math.max(0, Math.min(100, share * 100));
  return `<div class="hbar ${cls}"><span class="l">${label}</span><span class="track"><span class="fill" style="width:${w}%"></span></span><span class="v">${right}</span></div>`;
}

// ---- summary sections -----------------------------------------------------------

function renderHeadline(d) {
  $('headline').innerHTML = [
    tile(d.turns, 'petitions heard', d.custom ? `${d.custom} written by players` : ''),
    tile(d.reigns, 'reigns', `${d.ended} ended${d.assistedReigns ? ` · ${d.assistedReigns} more heard a player's own petition` : ''}`),
    tile(d.medianYears == null ? '–' : num(d.medianYears, d.medianYears % 1 ? 1 : 0), 'median reign, years', 'of reigns that ended'),
    tile(d.medianLatency == null ? '–' : `${Math.round(d.medianLatency)} ms`, 'median turn', 'two calls to the model'),
    tile(esc(d.models.join(', ') || '–'), 'model', d.first ? `since ${new Date(d.first).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}` : ''),
  ].join('');
}

function renderDeaths(d) {
  const maxDeath = Math.max(1, ...FACTIONS.flatMap((f) => [d.deaths[f].low, d.deaths[f].high]));
  $('deaths').innerHTML = `<div class="sub">By cause</div>` + FACTIONS.flatMap((f) => [
    bar(`${LABEL[f]} at 0 · ${DEATH[f].low}`, d.deaths[f].low / maxDeath, d.deaths[f].low),
    bar(`${LABEL[f]} at 100 · ${DEATH[f].high}`, d.deaths[f].high / maxDeath, d.deaths[f].high),
  ]).join('');

  const h = d.histogram || [];
  if (!h.length) { $('histogram').innerHTML = `<div class="sub">By length</div><p class="none">No reign has ended yet.</p>`; return; }
  const W = 420, H = 140, padB = 22, padL = 6;
  const n = h.length - 1;
  const max = Math.max(1, ...h);
  const bw = Math.max(2, (W - padL) / n - 2);
  const bars = [];
  for (let y = 1; y <= n; y++) {
    const v = h[y] || 0;
    const bh = (v / max) * (H - padB - 14);
    const x = padL + (y - 1) * ((W - padL) / n);
    bars.push(`<rect x="${x.toFixed(1)}" y="${(H - padB - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1"><title>${v} ${v === 1 ? 'reign' : 'reigns'} ended in year ${y}</title></rect>`);
    if (v === max) bars.push(`<text class="lab" x="${(x + bw / 2).toFixed(1)}" y="${(H - padB - bh - 4).toFixed(1)}" text-anchor="middle">${v}</text>`);
  }
  const ticks = [1, ...[5, 10, 15, 20, 25, 30, 40, 50].filter((t) => t <= n), n].filter((t, i, a) => a.indexOf(t) === i);
  const axis = ticks.map((t) => `<text class="ax" x="${(padL + (t - 1) * ((W - padL) / n) + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${t}</text>`).join('');
  $('histogram').innerHTML = `<div class="sub">By length, in years</div><svg class="hist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reigns ended per year of length">${bars.join('')}<line x1="${padL}" x2="${W}" y1="${H - padB + 0.5}" y2="${H - padB + 0.5}" class="base"/>${axis}</svg>`;
}

function renderFlaws(d) {
  const rows = Object.keys(FLAW).filter((k) => d.flaws[k]).map((k) => {
    const f = d.flaws[k];
    return `<tr><th>${FLAW[k]}</th><td>${f.turns}</td><td>${f.ended}<span class="dim"> of ${f.reigns}</span></td><td>${f.medianYears == null ? '–' : num(f.medianYears, f.medianYears % 1 ? 1 : 0)}</td>` +
      `<td>${pct(f.wantedBait)}<span class="dim"> of ${f.targeted}</span></td><td>${pct(f.tookBait)}</td><td>${pct(f.wantedLeftOther)}</td><td>${pct(f.disagree)}</td><td>${pct(f.trapTargeted)}<span class="dim"> / </span>${pct(f.trapOther)}</td></tr>`;
  });
  $('flaws').innerHTML = `<thead><tr><th>Temperament</th><th>Turns</th><th>Reigns ended</th><th>Median years</th><th>Wanted the bait</th><th>Took the bait</th><th>First option, other petitions</th><th>Disagreed with advisor</th><th>Trap read, targeted / other</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="9" class="none">No turns yet.</td></tr>'}</tbody>`;
}

function renderAdvisor(d) {
  const a = d.advisor;
  $('advisor').innerHTML = [
    tile(a.danger, 'turns in danger', 'a meter within 20 of an edge'),
    tile(pct(a.protected), 'advisor chose the safer option', 'by the model\'s own forecasts'),
    tile(pct(a.followed), 'the crown then took it', 'after wisdom and the roll'),
  ].join('');
}

function renderTrap(d) {
  const t = d.trap;
  $('trap').innerHTML = [
    bar(`Petitions that play to the king's flaw <span class="dim">n=${t.n.targeted}</span>`, t.targeted, pct(t.targeted)),
    bar(`Other petitions from the deck <span class="dim">n=${t.n.untargeted}</span>`, t.untargeted, pct(t.untargeted)),
    bar(`Petitions written by players <span class="dim">n=${t.n.custom}</span>`, t.custom, pct(t.custom)),
  ].join('') + `<div class="sub">Mean probability that the petition is a manipulation</div>`;
}

function levelsBar(probabilities, title = '') {
  const segs = LEVELS.map((name, i) => { const v = Number(probabilities?.[String(i)] ?? probabilities?.[i] ?? 0); return `<span class="seg lv${i}" style="width:${(v * 100).toFixed(2)}%" title="${name}: ${pct(v)}"></span>`; }).join('');
  return `<div class="stack"${title ? ` title="${esc(title)}"` : ''}>${segs}</div>`;
}

function renderForecast(d) {
  const f = d.forecasts;
  if (!f.total) { $('forecast').innerHTML = '<p class="none">No forecasts yet.</p>'; return; }
  const legend = f.levels.map((v, i) => `<span class="key"><span class="swatch lv${i}"></span>${LEVELS[i]} ${pct(v)}</span>`).join('');
  $('forecast').innerHTML = `${levelsBar(f.levels)}<div class="legend">${legend}</div><div class="sub">${f.total} forecasts</div>`;
}

function cardCell(c) {
  if (c.message == null) return `<span class="dim">A player's own petition</span>`;
  return `<span class="who">${esc(c.speaker)}</span> ${esc(clip(c.message))}`;
}

function renderCards(d) {
  const rows = d.cards.map((c) => `<tr><td class="pet">${cardCell(c)}</td><td>${c.tag === 'any' ? '<span class="dim">any</span>' : FLAW[c.tag] || esc(c.tag)}</td><td>${c.plays}</td>` +
    `<td><span class="opt">${esc(c.left)}</span> ${pct(c.wantLeft)}</td><td>${pct(c.choseLeft)}</td><td>${pct(c.trap)}</td><td>${c.deaths || '<span class="dim">0</span>'}</td></tr>`);
  $('cards').innerHTML = `<thead><tr><th>Petition</th><th>Plays to</th><th>Plays</th><th>Model wanted</th><th>Crown chose it</th><th>Trap</th><th>Reigns ended</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="7" class="none">No deck petition has been played yet.</td></tr>'}</tbody>`;
}

function renderContested(d) {
  if (!d.contested.length) { $('contested').innerHTML = '<p class="none">Every repeated petition drew the same answer so far.</p>'; return; }
  $('contested').innerHTML = d.contested.map((c) => `<div class="contest"><div class="pet">${cardCell(c)}</div>` +
    `<div class="meta">${FLAW[c.flaw]} king · ${c.plays} plays · wanted <span class="opt">${esc(c.left)}</span> ${Math.round(c.leftShare * c.plays)} of ${c.plays} times, <span class="opt r">${esc(c.right)}</span> the rest</div></div>`).join('');
}

// ---- one turn ---------------------------------------------------------------------

function entryHtml(r, expanded = false) {
  const custom = r.card.message == null;
  const left = custom ? 'first option' : esc(r.card.left), right = custom ? 'second option' : esc(r.card.right);
  const when = new Date(r.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const before = FACTIONS.map((f) => `<span class="m${r.before[f] <= 20 || r.before[f] >= 80 ? ' danger' : ''}">${LABEL[f][0]} ${r.before[f]}</span>`).join('');
  const after = FACTIONS.map((f) => `<span class="m ${r.applied[f] > 0 ? 'up' : r.applied[f] < 0 ? 'down' : ''}">${LABEL[f][0]} ${delta(r.applied[f])}</span>`).join('');
  const minis = [['wants', r.want], ['knows', r.know], ['blend', r.blend]].map(([k, v]) => `<div class="mini"><span class="k">${k}</span><span class="track"><span class="fill" style="width:${(v * 100).toFixed(1)}%"></span></span><span class="k">${pct(v)}</span></div>`).join('');
  const rolled = r.roll == null ? '' : ` · rolled ${Math.round(r.roll * 100)} against ${Math.round(r.blend * 100)}`;
  return `<article class="entry${r.death ? ' fatal' : ''}" data-id="${esc(r.id)}">
    <div class="head"><span>Year ${r.year} · ${esc(r.king.name)} · ${FLAW[r.king.flaw] || esc(r.king.flaw)} · ${wisdom(r.king.wisdom)}</span><span class="dim">${when} · ${r.latency ? r.latency.forecast + r.latency.advisor : '–'} ms · <a href="/eval?turn=${encodeURIComponent(r.id)}">permalink</a></span></div>
    <div class="meters-line">${before}<span class="dim">before</span></div>
    <div class="pet">${cardCell(r.card)}</div>
    <div class="verdict-line"><span class="opt${r.chosen === 'left' ? ' chosen' : ''}">${left}</span><div class="minis">${minis}</div><span class="opt r${r.chosen === 'right' ? ' chosen' : ''}">${right}</span></div>
    <div class="meters-line">${after}<span class="dim">trap ${pct(r.trap)}${rolled}</span>${r.death ? `<span class="fate">${DEATH[r.death.faction][r.death.edge]}</span>` : ''}</div>
    <button type="button" class="text expand" ${expanded ? 'hidden' : ''}>Show both calls</button>
    <div class="detail-slot"></div>
  </article>`;
}

// Generic key/value rendering of the state as it was sent.
function kv(obj) {
  return `<dl class="kv">${Object.entries(obj).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v && typeof v === 'object' ? (Array.isArray(v) ? esc(v.join(' · ')) : kv(v)) : esc(String(v))}</dd>`).join('')}</dl>`;
}

function choiceAnswer(q, a) {
  const best = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0]?.[0];
  return Object.entries(q.criteria).map(([key, label]) => bar(`<span class="opt${key === 'right' ? ' r' : ''}${key === best ? ' chosen' : ''}">${esc(label)}</span>`, a.probabilities[key], pct(a.probabilities[key]))).join('') +
    `<div class="sub">choice ${esc(a.choice)} · confidence ${num(a.confidence, 2)}</div>`;
}

function question(name, q, answerHtml) {
  return `<div class="qa"><div class="qname">${esc(name)} <span class="dim">${esc(q.type)}</span></div><p class="instr">${esc(q.instructions)}</p>${q.type === 'noul' ? `<p class="instr"><b>true</b> ${esc(q.criteria.true)}<br><b>false</b> ${esc(q.criteria.false)}</p>` : ''}${answerHtml}</div>`;
}

function detailHtml(r) {
  if (!r.calls) return `<div class="detail"><p class="none">${r.card.tag === 'custom' ? 'The raw calls for player-written petitions are recorded but not shown.' : 'This turn was recorded before the raw calls were kept.'}</p></div>`;
  const [one, two] = r.calls;
  const q1 = one.request.questions, a1 = one.response.answers;
  const q2 = two.request.questions, a2 = two.response.answers;
  const tokens = (c) => c.response.usage?.input_tokens ?? '–';

  // Call one: the forecast grid, faction by option, each cell the five-level distribution.
  const grid = `<div class="fgrid"><div></div><div class="opt">${esc(r.card.left)}</div><div class="opt r">${esc(r.card.right)}</div>` +
    FACTIONS.map((f) => `<div class="fname">${LABEL[f]}</div>` + ['left', 'right'].map((side) => {
      const a = a1[`${side}_${f}`];
      return `<div class="fcell">${levelsBar(a.probabilities, q1[`${side}_${f}`].instructions)}<div class="fnum">score ${num(a.score, 2)} <span class="dim">→</span> ${delta(r.predicted[side][f])} <span class="dim">· conf ${num(a.confidence, 2)}</span></div></div>`;
    }).join('')).join('') + `</div>`;
  const legend = LEVELS.map((n, i) => `<span class="key"><span class="swatch lv${i}"></span>${n}</span>`).join('');
  const instructions = ['left', 'right'].flatMap((side) => FACTIONS.map((f) => `<p class="instr"><b>${esc(side)}_${f}</b> ${esc(q1[`${side}_${f}`].instructions)}</p>`)).join('');

  const callOne = `<div class="call"><h3>Call one · forecast <span class="dim">${one.latencyMs} ms · ${tokens(one)} tokens · ${esc(one.response.model)}</span></h3>
    <div class="sub">State sent</div>${kv(one.request.state)}
    <div class="sub">Ten questions, answered independently</div>
    ${question('decision', q1.decision, choiceAnswer(q1.decision, a1.decision))}
    ${question('trap', q1.trap, bar('manipulation', a1.trap.noul, pct(a1.trap.noul)))}
    <div class="qa"><div class="qname">left_* and right_* <span class="dim">score, eight questions</span></div>
      <p class="instr">Rubric: ${LEVELS.map((n, i) => `${i} ${n}`).join(' · ')}. Delta = (score − 2) × ${r.step}.</p>
      ${grid}<div class="legend">${legend}</div>
      <details><summary class="text">The eight instructions as sent</summary>${instructions}</details>
    </div></div>`;

  // Call two: what was added to the state, and the advisor's question.
  const added = { forecast: two.request.state.forecast };
  if (two.request.state.kingdom?.danger) added.danger = two.request.state.kingdom.danger;
  const callTwo = `<div class="call"><h3>Call two · advisor <span class="dim">${two.latencyMs} ms · ${tokens(two)} tokens · ${esc(two.response.model)}</span></h3>
    <div class="sub">Added to the same state: the first call's forecasts as numbers</div>${kv(added)}
    ${Object.entries(q2).map(([name, q]) => question(name, q, choiceAnswer(q, a2[name]))).join('')}</div>`;

  // The court's arithmetic.
  const w = r.king.wisdom;
  const chosenLabel = r.chosen === 'left' ? r.card.left : r.card.right;
  const arithmetic = `<div class="call"><h3>The court's arithmetic</h3>
    <dl class="kv">
      <dt>wants</dt><dd>${pct(r.want)} for <span class="opt">${esc(r.card.left)}</span> <span class="dim">(decision, call one)</span></dd>
      <dt>knows</dt><dd>${pct(r.know)} for <span class="opt">${esc(r.card.left)}</span> <span class="dim">(prudence, call two)</span></dd>
      <dt>wisdom</dt><dd>${w} <span class="dim">(${wisdom(w)})</span></dd>
      <dt>blend</dt><dd>(1 − ${w}) × ${num(r.want, 3)} + ${w} × ${num(r.know, 3)} = <b>${num(r.blend, 3)}</b> for <span class="opt">${esc(r.card.left)}</span></dd>
      <dt>roll</dt><dd>${r.roll == null ? '<span class="dim">not recorded</span>' : `${num(r.roll, 3)} ${r.roll < r.blend ? '&lt;' : '≥'} ${num(r.blend, 3)}`} → <b>${esc(chosenLabel)}</b></dd>
      <dt>applied</dt><dd>${FACTIONS.map((f) => `${LABEL[f]} ${delta(r.predicted[r.chosen][f])} + ${r.recovery ?? 1} recovery = <b>${delta(r.applied[f])}</b>`).join('<br>')}</dd>
      <dt>kingdom</dt><dd>${FACTIONS.map((f) => `${LABEL[f]} ${r.before[f]} → <b>${r.after[f]}</b>`).join(' · ')}</dd>
      ${r.death ? `<dt>reign ends</dt><dd class="fate">${LABEL[r.death.faction]} at ${r.death.edge === 'low' ? 0 : 100} · ${DEATH[r.death.faction][r.death.edge]}</dd>` : ''}
    </dl></div>`;

  return `<div class="detail">${callOne}${callTwo}${arithmetic}<details><summary class="text">Raw record (JSON)</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details></div>`;
}

async function expand(article) {
  const slot = article.querySelector('.detail-slot');
  const btn = article.querySelector('.expand');
  if (slot.innerHTML) { slot.innerHTML = ''; btn.textContent = 'Show both calls'; return; }
  btn.textContent = 'Fetching…';
  try {
    const res = await fetch(`/api/eval/turn/${encodeURIComponent(article.dataset.id)}`);
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    slot.innerHTML = detailHtml(await res.json());
    btn.textContent = 'Hide the calls';
  } catch (e) {
    slot.innerHTML = `<p class="none">${esc(e.message)}</p>`;
    btn.textContent = 'Show both calls';
  }
}

function renderFeed(d) {
  $('feed').innerHTML = d.feed.map((r) => entryHtml(r)).join('');
}

// ---- loading ---------------------------------------------------------------------

async function loadSummary() {
  let d;
  try {
    const res = await fetch('/api/eval', { cache: 'no-store' });
    d = await res.json();
  } catch (e) {
    $('status').textContent = `Could not load the chronicle: ${e.message}`;
    return;
  }
  $('mock-note').hidden = !d.mock;
  $('empty').hidden = d.turns > 0;
  document.body.classList.toggle('no-data', d.turns === 0);
  renderHeadline(d);
  renderDeaths(d);
  renderFlaws(d);
  renderAdvisor(d);
  renderTrap(d);
  renderForecast(d);
  renderCards(d);
  renderContested(d);
  renderFeed(d);
  const where = d.log?.store === 'postgres' ? 'kept in Postgres' : 'kept on this server';
  $('status').textContent = `${d.turns} records ${where} · last ${d.last ? new Date(d.last).toLocaleString() : '–'} · refreshes every 30 s`;
}

async function loadSingle(id) {
  document.body.classList.add('single');
  $('single').hidden = false;
  try {
    const res = await fetch(`/api/eval/turn/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    const r = await res.json();
    $('single-turn').innerHTML = entryHtml(r, true);
    $('single-turn').querySelector('.detail-slot').innerHTML = detailHtml(r);
  } catch (e) {
    $('single-turn').innerHTML = `<p class="none">${esc(e.message)}</p>`;
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.expand');
  if (btn) expand(btn.closest('.entry'));
});

if (single) loadSingle(single);
else { loadSummary(); setInterval(loadSummary, 30_000); }
