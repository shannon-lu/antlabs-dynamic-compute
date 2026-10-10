/* Claude Collaborate — browser UI. Receives the full run state over SSE and re-renders. */
(() => {
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const $ = (id) => document.getElementById(id);
  let state = null;
  let config = null;
  let lastJson = '';
  const showChanges = {}; // sectionId -> bool (user toggles)
  let activeTab = 'planned';

  // ---- wiring -------------------------------------------------------------
  fetch('/api/config').then((r) => r.json()).then((c) => {
    config = c;
    const sel = $('model');
    sel.innerHTML = c.models.map((m) => `<option value="${m.id}" ${m.id === c.defaultModel ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
    $('provider-line').textContent = c.providerDescription;
  });

  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    if (e.data === lastJson) return;
    lastJson = e.data;
    state = JSON.parse(e.data);
    render();
  };
  es.onerror = () => { $('provider-line').textContent = 'disconnected from server, retrying…'; };

  $('start').onclick = () => post('/api/run/start', { model: $('model').value, allowWeb: $('allow-web').checked });
  $('stop').onclick = () => post('/api/run/stop', {});
  $('extend').onclick = () => post('/api/run/pause/extend', { ms: 30000 });
  $('continue').onclick = () => post('/api/run/pause/continue', {});
  function selectTab(name) {
    const t = document.querySelector(`.tab[data-tab="${name}"]`);
    if (!t) return;
    activeTab = name;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    try { history.replaceState(null, '', '#' + name); } catch { /* ignore */ }
  }
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => selectTab(t.dataset.tab); });
  if (location.hash) selectTab(location.hash.slice(1));

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) toast(j.error || 'Request failed');
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  // ---- timers (countdown, elapsed) ---------------------------------------
  setInterval(() => {
    if (!state) return;
    if (state.pause) {
      $('pause-count').textContent = Math.max(0, Math.ceil((state.pause.until - Date.now()) / 1000));
    }
    document.querySelectorAll('[data-since]').forEach((el) => {
      el.textContent = fmtDur(Date.now() - new Date(el.dataset.since).getTime());
    });
  }, 250);

  // ---- render -------------------------------------------------------------
  function render() {
    const s = state;
    const busy = ['planning', 'paused', 'running'].includes(s.status);

    $('status-pill').textContent = s.status === 'running' && s.currentStepId ? `running ${s.currentStepId}` : s.status;
    $('status-pill').className = 'pill ' + s.status;
    $('start').hidden = busy;
    $('start').textContent = s.status === 'idle' ? 'Start run' : 'Start new run';
    $('stop').hidden = !busy;
    $('model').disabled = busy;
    $('allow-web').disabled = busy;
    $('prompt-text').textContent = s.prompt;

    const t = s.totals;
    $('totals').textContent = t.calls
      ? `${t.calls} calls · ${fmtN(t.outputTokens)} output tokens` + (t.thinkingTokens ? ` (${fmtN(t.thinkingTokens)} thinking)` : '') + (t.costUsd ? ` · ~$${t.costUsd.toFixed(2)}` : '')
      : '';

    // pause banner
    const pb = $('pause-banner');
    if (s.pause) {
      pb.hidden = false;
      if (s.pause.reason === 'after_plan') {
        $('pause-title').textContent = 'Plan ready. Review the effort levels.';
        $('pause-sub').textContent = 'Change any step’s effort in the Planned steps tab. The run continues on its own when the countdown ends.';
      } else {
        const st = s.steps.find((x) => x.id === s.pause.stepId);
        $('pause-title').textContent = `Claude flagged "${st ? st.title : s.pause.stepId}" as uncertain.`;
        $('pause-sub').textContent = st && st.uncertainReason ? st.uncertainReason : 'Adjust effort before it runs.';
      }
    } else pb.hidden = true;

    renderDoc(s);
    renderPlanned(s);
    renderExecuted(s);
    renderLog(s);
  }

  function renderDoc(s) {
    const body = $('doc-body');
    const scroll = $('doc-pane').scrollTop;
    if (s.sectionOrder.length === 0) {
      body.innerHTML = `<div class="empty">${s.status === 'idle' ? 'Start a run. Claude plans the steps first, then the document fills in as each step finishes.' : s.status === 'planning' ? 'Claude is planning the steps…' : 'No sections yet.'}</div>`;
      return;
    }
    const lastStep = s.executed.length ? s.executed[s.executed.length - 1].stepId : null;
    body.innerHTML = s.sectionOrder.map((id) => {
      const sec = s.sections[id];
      const v = sec.versions;
      if (v.length === 0) {
        const writer = s.steps.find((st) => st.sections.includes(id) && st.status !== 'done');
        return `<div class="section pending"><div class="section-head"><h2>${esc(sec.title)}</h2><div class="section-meta">${writer ? `pending · ${esc(writer.id)}: ${esc(writer.title)}` : 'pending'}</div></div></div>`;
      }
      const cur = v[v.length - 1];
      const prev = v.length > 1 ? v[v.length - 2] : null;
      // A near-total rewrite reads better clean; an edit reads better with changes marked.
      const rewrite = prev ? unchangedShare(prev.markdown, cur.markdown) < 0.25 : false;
      const show = prev && (showChanges[id] !== undefined ? showChanges[id] : !rewrite);
      const fresh = cur.stepId === lastStep;
      const html = show ? diffBlocks(prev.markdown, cur.markdown) : md(cur.markdown);
      return `<div class="section ${fresh ? 'fresh' : ''}" data-sec="${id}">
        <div class="section-head"><h2>${esc(sec.title)}</h2>
          <div class="section-meta">
            <span>v${v.length} · ${v.length > 1 ? (rewrite ? 'rewritten' : 'updated') : 'written'} by ${esc(cur.stepId)}</span>
            ${prev ? `<label><input type="checkbox" data-toggle="${id}" ${show ? 'checked' : ''}> show changes</label>` : ''}
          </div></div>
        <div class="section-body">${html}</div></div>`;
    }).join('');
    body.querySelectorAll('[data-toggle]').forEach((cb) => {
      cb.onchange = () => { showChanges[cb.dataset.toggle] = cb.checked; renderDoc(state); };
    });
    $('doc-pane').scrollTop = scroll;
  }

  function renderPlanned(s) {
    const pane = $('tab-planned');
    const scroll = pane.parentElement.scrollTop;
    const pending = s.steps.filter((st) => st.status !== 'done' && st.status !== 'failed');
    $('count-planned').textContent = pending.length;
    if (s.steps.length === 0) {
      pane.innerHTML = `<div class="hint">${s.status === 'planning' ? 'Claude is choosing steps and effort levels…' : 'No plan yet.'}</div>`;
      return;
    }
    const canEdit = ['paused', 'running', 'planning'].includes(s.status);
    pane.innerHTML = (pending.length ? '' : '<div class="hint">All steps finished.</div>') + pending.map((st) => {
      const idx = s.steps.indexOf(st) + 1;
      const inProg = st.status === 'in_progress';
      const eff = st.userEffort || st.effort;
      const sel = `<select class="effort-select" data-step="${st.id}" ${inProg || !canEdit ? 'disabled' : ''} aria-label="Effort for ${esc(st.title)}">
        ${EFFORTS.map((e) => `<option value="${e}" ${e === eff ? 'selected' : ''}>${e}</option>`).join('')}</select>`;
      const chips = [];
      if (inProg) chips.push(`<span class="chip progress"><span class="spinner"></span> in progress · <span data-since="${s.currentStepStartedAt}"></span></span>`);
      if (st.userEffort) chips.push(`<span class="chip user">you set ${st.userEffort}${st.userEffort !== st.effort ? ` (Claude chose ${st.effort})` : ''}</span>`);
      else chips.push(`<span class="chip">Claude's choice</span>`);
      if (st.uncertain) chips.push(`<span class="chip uncertain">pauses before running</span>`);
      if (st.origin.kind === 'added') chips.push(`<span class="chip added">added by ${esc(st.origin.byStepId)}</span>`);
      const applied = st.effortChanges.filter((c) => c.applied);
      if (applied.length) chips.push(`<span class="chip changed">effort changed by Claude</span>`);
      const markers = [];
      if (st.origin.kind === 'added') markers.push(`<div class="marker claude"><strong>Added after ${esc(st.origin.byStepId)}.</strong> ${esc(st.origin.reason)}</div>`);
      for (const c of st.effortChanges) {
        markers.push(`<div class="marker ${c.applied ? 'claude' : 'user'}"><strong>${c.applied ? `Claude changed ${c.from} → ${c.to}` : `Claude proposed ${c.to}, kept your ${c.from}`}</strong> (after ${esc(c.byStepId)}). ${esc(c.reason)}</div>`);
      }
      if (st.uncertain && st.uncertainReason) markers.push(`<div class="marker claude"><strong>Why uncertain:</strong> ${esc(st.uncertainReason)}</div>`);
      return `<div class="card ${inProg ? 'in-progress' : ''} ${st.userEffort ? 'user-set' : ''}">
        <div class="card-head"><span class="card-num">${idx}</span><span class="card-title">${esc(st.title)}</span>${sel}</div>
        <div class="card-reason">${esc(st.reason)}</div>
        <div class="card-row">${chips.join('')}</div>
        ${markers.join('')}</div>`;
    }).join('');
    pane.querySelectorAll('.effort-select').forEach((sel) => {
      sel.onchange = () => post('/api/run/effort', { stepId: sel.dataset.step, effort: sel.value });
    });
    pane.parentElement.scrollTop = scroll;
  }

  function renderExecuted(s) {
    const pane = $('tab-executed');
    const scroll = pane.parentElement.scrollTop;
    $('count-executed').textContent = s.executed.length;
    const items = [];
    if (s.planUsage) {
      items.push(`<div class="card"><div class="card-head"><span class="card-num">0</span><span class="card-title">Plan</span><span class="chip effort">high</span></div>
        <div class="card-reason">Claude drafted the sections and steps, with an effort level and reason for each.</div>
        ${metrics(s.planUsage)}</div>`);
    }
    if (!s.executed.length && !s.planUsage) items.push('<div class="hint">Finished steps appear here with the effort used, the tokens spent, and the assumptions and decisions Claude made.</div>');
    for (const ex of [...s.executed].reverse()) {
      const idx = s.steps.findIndex((st) => st.id === ex.stepId) + 1;
      items.push(`<div class="card ${ex.error ? 'failed' : ''}">
        <div class="card-head"><span class="card-num">${idx || ''}</span><span class="card-title">${esc(ex.title)}</span>
          <span class="chip effort">${ex.effortUsed}</span>
          ${ex.effortSource === 'user' ? `<span class="chip user">you set${ex.claudeEffort !== ex.effortUsed ? ` · Claude chose ${ex.claudeEffort}` : ''}</span>` : `<span class="chip">Claude's choice</span>`}
          ${ex.error ? '<span class="chip err">failed</span>' : '<span class="chip ok">done</span>'}</div>
        ${ex.error ? `<div class="summary">${esc(ex.error)}</div>` : ''}
        ${metrics(ex.usage)}
        ${ex.summary ? `<div class="summary">${esc(ex.summary)}</div>` : ''}
        ${list('Sections updated', ex.sectionsUpdated.map((id) => (s.sections[id] ? s.sections[id].title : id)))}
        ${list('Assumptions', ex.assumptions)}
        ${list('Decisions to confirm', ex.decisions)}
        ${list('Plan changes', ex.planChanges)}
      </div>`);
    }
    pane.innerHTML = items.join('');
    pane.parentElement.scrollTop = scroll;
  }

  function renderLog(s) {
    const pane = $('tab-log');
    const atBottom = pane.parentElement.scrollHeight - pane.parentElement.scrollTop - pane.parentElement.clientHeight < 40;
    pane.innerHTML = s.log.map((l) => `<div class="log-line"><time>${new Date(l.at).toLocaleTimeString()}</time><span>${esc(l.text)}</span></div>`).join('') || '<div class="hint">Nothing yet.</div>';
    if (atBottom && activeTab === 'log') pane.parentElement.scrollTop = pane.parentElement.scrollHeight;
  }

  function metrics(u) {
    const cells = [
      ['output tokens', fmtN(u.outputTokens)],
      ['thinking', u.thinkingTokens === null ? 'n/a' : fmtN(u.thinkingTokens)],
      ['input (incl. cache)', fmtN(u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens)],
      ['time', fmtDur(u.durationMs)],
    ];
    if (u.costUsd !== null && u.costUsd !== undefined) cells.push(['est. cost', '$' + u.costUsd.toFixed(3)]);
    return `<div class="metrics">${cells.map(([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>`;
  }

  function list(title, arr) {
    if (!arr || !arr.length) return '';
    return `<div class="sublist"><h4>${title}</h4><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }

  // ---- markdown + diff ----------------------------------------------------
  function md(text) {
    if (window.marked) {
      try { return window.marked.parse(text, { gfm: true, breaks: false }); } catch { /* fall through */ }
    }
    return `<pre>${esc(text)}</pre>`;
  }

  /** Block-level diff of two markdown bodies. Within a run of changes, new blocks come before removed ones. */
  function diffBlocks(oldText, newText) {
    const a = splitBlocks(oldText), b = splitBlocks(newText);
    const ops = lcsDiff(a, b);
    let out = '', keep = [], ins = [], del = [];
    const flushKeep = () => { if (keep.length) { out += md(keep.join('\n\n')); keep = []; } };
    const flushChange = () => {
      for (const blk of ins) out += `<div class="block ins">${md(blk)}</div>`;
      for (const blk of del) out += `<div class="block del">${md(blk)}</div>`;
      ins = []; del = [];
    };
    for (const [op, block] of ops) {
      if (op === '=') { flushChange(); keep.push(block); }
      else { flushKeep(); (op === '+' ? ins : del).push(block); }
    }
    flushChange(); flushKeep();
    return out;
  }

  function unchangedShare(oldText, newText) {
    const a = splitBlocks(oldText), b = splitBlocks(newText);
    if (!a.length && !b.length) return 1;
    const same = lcsDiff(a, b).filter(([op]) => op === '=').length;
    return same / Math.max(a.length, b.length);
  }

  function splitBlocks(text) {
    // Split into paragraphs; keep table/list runs together as one block.
    return text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  }

  function lcsDiff(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push(['=', a[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', a[i]]); i++; }
      else { ops.push(['+', b[j]]); j++; }
    }
    while (i < n) ops.push(['-', a[i++]]);
    while (j < m) ops.push(['+', b[j++]]);
    return ops;
  }

  // ---- utils --------------------------------------------------------------
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtN(n) { return Number(n || 0).toLocaleString(); }
  function fmtDur(ms) { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }
})();
