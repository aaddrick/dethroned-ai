// Dethrone client. Keeps the game state; the server is stateless.
const FACTIONS = ['church', 'people', 'army', 'treasury'];
const LABEL = { church: 'Church', people: 'People', army: 'Army', treasury: 'Treasury' };
const HAND_SIZE = 5;
const FLAW_SHARE = 0.45; // chance each draw comes from the pile that targets the king's flaw
const $ = (id) => document.getElementById(id);

let game = null;      // { reign, king, flaw, kingdom, year, deck, mock, model }
let piles = null;     // { flaw: [...], other: [...] } remaining draw piles for this reign
let hand = [];
let busy = false;

// ---- meters ---------------------------------------------------------------

function buildMeters() {
  $('meters').innerHTML = FACTIONS.map((f) => `
    <div class="meter" data-f="${f}">
      <div class="name"><span>${LABEL[f]}</span><span class="delta"></span></div>
      <div class="track">
        <div class="fill" style="width:50%"></div>
        <div class="ghost-mark l"></div>
        <div class="ghost-mark r"></div>
      </div>
    </div>`).join('');
}

function renderMeters(kingdom, applied) {
  for (const f of FACTIONS) {
    const el = document.querySelector(`.meter[data-f="${f}"]`);
    el.querySelector('.fill').style.width = `${kingdom[f]}%`;
    const d = el.querySelector('.delta');
    const v = applied ? applied[f] : null;
    d.textContent = v == null ? String(kingdom[f]) : (v > 0 ? `+${v}` : v === 0 ? '0' : `−${Math.abs(v)}`);
    d.className = 'delta' + (v > 0 ? ' up' : v < 0 ? ' down' : '');
    el.classList.toggle('danger', kingdom[f] <= 15 || kingdom[f] >= 85);
  }
}

function showGhosts(kingdom, predicted, recovery = 0) {
  for (const f of FACTIONS) {
    const el = document.querySelector(`.meter[data-f="${f}"]`);
    for (const side of ['left', 'right']) {
      const m = el.querySelector(`.ghost-mark.${side[0]}`);
      if (!predicted) { m.classList.remove('on'); continue; }
      const v = Math.max(0, Math.min(100, kingdom[f] + predicted[side][f] + recovery));
      m.style.left = `calc(${v}% - 1px)`;
      m.classList.add('on');
    }
  }
}

// ---- deck and hand --------------------------------------------------------

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function buildPiles() {
  piles = {
    flaw: shuffle(game.deck.filter((c) => c.tag === game.king.flaw)),
    other: shuffle(game.deck.filter((c) => c.tag !== game.king.flaw)),
  };
}

function draw() {
  const preferFlaw = Math.random() < FLAW_SHARE;
  const first = preferFlaw ? piles.flaw : piles.other;
  const second = preferFlaw ? piles.other : piles.flaw;
  if (first.length) return first.pop();
  if (second.length) return second.pop();
  buildPiles(); // deck exhausted: reshuffle everything
  return draw();
}

function dealHand() {
  hand = [];
  while (hand.length < HAND_SIZE) hand.push(draw());
  renderHand();
}

function renderHand() {
  $('hand').innerHTML = hand.map((c, i) => `
    <button type="button" class="hand-card${c.tag === game.king.flaw ? ' exploit' : ''}" data-i="${i}" ${busy ? 'disabled' : ''}>
      <span class="speaker">${esc(c.speaker)}</span>
      <span class="message">${esc(c.message)}</span>
      <span class="opts"><span class="l">${esc(c.left)}</span><span class="r">${esc(c.right)}</span></span>
    </button>`).join('');
}

function setHandEnabled(on) {
  for (const b of document.querySelectorAll('.hand-card')) b.disabled = !on;
}

// ---- reign ----------------------------------------------------------------

async function newReign() {
  const res = await fetch('/api/reign');
  game = await res.json();
  $('king-name').textContent = game.king.name;
  $('king-flaw').textContent = game.flaw.label;
  $('king-wisdom').textContent = game.wisdomLabel;
  $('year').textContent = game.year;
  $('mock-banner').hidden = !game.mock;
  $('hint').textContent = `${game.king.name} ${game.flaw.desc}, and is ${game.wisdomLabel.toLowerCase()}: sober counsel wins about ${Math.round(game.king.wisdom * 100)}% of the time.`;
  $('readout').textContent = 'Gold-edged petitions play to the flaw.';
  $('overlay').hidden = true;
  $('card-speaker').textContent = 'The Court';
  $('card-message').textContent = 'Pick a petition from your hand. The king decides in under a second.';
  $('opt-left').textContent = '';
  $('opt-right').textContent = '';
  resetCard();
  renderMeters(game.kingdom);
  showGhosts(game.kingdom, null);
  buildPiles();
  dealHand();
}

function setBar(k, p) {
  const l = p ? p.left : 0.5;
  $(`fill-${k}`).style.width = `${Math.round(l * 100)}%`;
  $(`pct-${k}-l`).textContent = p ? `${Math.round(l * 100)}%` : '';
  $(`pct-${k}-r`).textContent = p ? `${Math.round((1 - l) * 100)}%` : '';
}

function resetCard() {
  $('card').className = 'card';
  $('verdict-left').classList.remove('on');
  $('verdict-right').classList.remove('on');
  setBar('blend', null);
}

// ---- turn -----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function playFromHand(e) {
  const btn = e.target.closest('.hand-card');
  if (!btn || busy) return;
  const i = Number(btn.dataset.i);
  const card = hand[i];
  presentCard(card, () => {
    hand.splice(i, 1, draw());
    renderHand();
  });
}

function playCustom(e) {
  e.preventDefault();
  const card = {
    speaker: $('in-speaker').value.trim() || 'A Petitioner',
    message: $('in-message').value.trim(),
    left: $('in-left').value.trim(),
    right: $('in-right').value.trim(),
    tag: 'custom',
  };
  $('custom').hidden = true;
  presentCard(card, () => {});
}

async function presentCard(card, afterPlay) {
  if (busy || !game) return;
  $('error').hidden = true;
  busy = true;
  $('present').disabled = true;
  setHandEnabled(false);

  // Show the card being read.
  resetCard();
  $('card-speaker').textContent = card.speaker;
  $('card-message').textContent = card.message;
  $('opt-left').textContent = card.left;
  $('opt-right').textContent = card.right;
  $('card').classList.add('thinking');
  showGhosts(game.kingdom, null);

  let r;
  try {
    const res = await fetch('/api/turn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reign: game.reign, king: game.king, kingdom: game.kingdom, year: game.year, card }),
    });
    r = await res.json();
    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
  } catch (err) {
    $('card').classList.remove('thinking');
    $('error').textContent = err.message;
    $('error').hidden = false;
    busy = false; $('present').disabled = false; setHandEnabled(true);
    return;
  }

  $('raw').textContent = JSON.stringify({ model: r.model, latency: r.latency, usage: r.usage, ...r.raw }, null, 2);
  $('raw-link').href = `/eval?turn=${encodeURIComponent(r.id)}`;
  $('raw-link').hidden = !r.id;

  // 1. Reveal what the model expected from each side.
  $('card').classList.remove('thinking');
  showGhosts(game.kingdom, r.predicted, r.recovery);
  setBar('blend', r.blend);
  $('readout').textContent = `Smells a trap ${Math.round(r.trap * 100)}% · forecast ${r.latency.forecast} ms + advisor ${r.latency.advisor} ms · ${r.model}`;
  await sleep(900);

  // 2. The king commits.
  $('card').classList.add(r.chosen === 'left' ? 'swipe-left' : 'swipe-right');
  const v = $(`verdict-${r.chosen}`);
  v.textContent = `Chosen at ${Math.round((r.blend[r.chosen] ?? 0) * 100)}% · roll ${Math.round(r.roll * 100)}`;
  v.classList.add('on');
  await sleep(500);

  // 3. Consequences land.
  game.kingdom = r.kingdom;
  game.year = r.year;
  renderMeters(game.kingdom, r.applied);
  $('year').textContent = game.year;
  logTurn(card, r);
  afterPlay();

  if (r.death) {
    await sleep(900);
    endReign(r);
  }
  busy = false;
  $('present').disabled = false;
  setHandEnabled(true);
}

function logTurn(card, r) {
  const parts = FACTIONS.map((f) => `${LABEL[f]} ${r.applied[f] > 0 ? '+' : r.applied[f] < 0 ? '−' : ''}${Math.abs(r.applied[f])}`).join(' · ');
  $('readout').textContent = `${card.speaker} asked; the king chose ${card[r.chosen]}. ${parts}. Trap ${Math.round(r.trap * 100)}% · ${r.latencyMs} ms`;
}

function endReign(r) {
  const years = game.year - 1;
  const best = Math.min(Number(localStorage.getItem('dethrone.best') || Infinity), years);
  try { localStorage.setItem('dethrone.best', String(best)); } catch {}
  $('death-title').textContent = `${game.king.name} has fallen`;
  $('death-text').textContent = r.death.text;
  $('death-years').textContent = `${years} ${years === 1 ? 'year' : 'years'}`;
  $('best').textContent = `${best} ${best === 1 ? 'year' : 'years'}`;
  $('share').onclick = () => {
    const text = `I dethroned ${game.king.name} (${game.flaw.label}, ${game.wisdomLabel}) in ${years} ${years === 1 ? 'year' : 'years'}. ${r.death.text} Play Dethrone: the model is king, you are the court.`;
    navigator.clipboard?.writeText(text);
    $('share').textContent = 'Copied';
    setTimeout(() => ($('share').textContent = 'Copy boast'), 1500);
  };
  $('overlay').hidden = false;
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---- wiring ---------------------------------------------------------------

buildMeters();
$('hand').addEventListener('click', playFromHand);
$('petition').addEventListener('submit', playCustom);
$('custom-open').addEventListener('click', () => { $('custom').hidden = false; $('in-message').focus(); });
$('custom-close').addEventListener('click', () => ($('custom').hidden = true));
$('raw-toggle').addEventListener('click', () => ($('rawbox').hidden = false));
$('raw-close').addEventListener('click', () => ($('rawbox').hidden = true));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('custom').hidden = true; $('rawbox').hidden = true; } });
$('new-reign').addEventListener('click', newReign);
$('again').addEventListener('click', newReign);
newReign();
