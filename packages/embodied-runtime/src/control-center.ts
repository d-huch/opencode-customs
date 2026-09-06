export const controlCenter = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Embodied Agent Control Center</title>
  <style>
    :root { color-scheme: dark; font: 15px/1.45 system-ui, sans-serif; background: #0c1017; color: #eef3ff; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, #17253a, #0c1017 55%); }
    main { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0; }
    h1 { margin: 0; font-size: 30px; } h2 { margin-top: 0; font-size: 17px; }
    .muted { color: #9ba9bd; } .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(260px,1fr)); gap: 16px; }
    .card { background: #141b26; border: 1px solid #2c3b50; border-radius: 14px; padding: 20px; margin-top: 18px; }
    label { display: block; color: #b7c3d5; margin-top: 12px; }
    input, select, button { box-sizing: border-box; width: 100%; padding: 10px 12px; margin-top: 6px; border-radius: 9px; border: 1px solid #3b4c64; background: #0e141e; color: inherit; }
    button, a.button { cursor: pointer; background: #246bce; border: 1px solid #3784ed; border-radius: 9px; color: inherit; display: block; font-weight: 650; margin-top: 6px; padding: 10px 12px; text-align: center; text-decoration: none; }
    button.secondary { background: #1b2533; } .ok { color: #66e3a4; } .bad { color: #ff8f8f; }
    code { color: #8fc7ff; } ul { padding-left: 20px; } [hidden] { display: none !important; }
    .assertion { border-left: 3px solid #66e3a4; margin: 8px 0; padding: 7px 10px; background: #101923; }
    .assertion.failed { border-color: #ff8f8f; } .timeline { max-height: 280px; overflow: auto; }
    .event { display: grid; grid-template-columns: 58px 1fr auto; gap: 10px; border-bottom: 1px solid #263448; padding: 7px 0; }
  </style>
</head>
<body><main>
  <h1>Embodied Agent Runtime</h1><p class="muted">Local control center for Unity and Quest training deployments.</p>
  <section id="login" class="card">
    <h2>Unlock local controls</h2>
    <p class="muted">Paste the token from the Runtime state file <code>control.json</code>. It is stored only in an HttpOnly localhost cookie.</p>
    <label>Control token<input id="token" type="password" autocomplete="off"></label>
    <button id="unlock">Unlock</button><p id="loginError" class="bad"></p>
  </section>
  <div id="dashboard" hidden>
    <a class="button" href="/instructor">Open Live Instructor Console</a>
    <div class="grid">
      <section class="card"><h2>Runtime</h2><div id="runtime">Loading…</div></section>
      <section class="card"><h2>Unity / Quest</h2><div id="clients">Loading…</div></section>
    </div>
    <section class="card">
      <h2>Dialogue model</h2>
      <p class="muted">Alpha accepts loopback LM Studio or llama-server. Changes apply after Runtime restart.</p>
      <label>Provider<select id="provider"><option value="lmstudio">LM Studio</option><option value="llama-server">llama-server</option></select></label>
      <label>Endpoint<input id="baseURL" value="http://127.0.0.1:1234/v1"></label>
      <label>Model ID<input id="modelID" placeholder="loaded model ID"></label>
      <h3>AI Trainee model</h3>
      <p class="muted">Leave Model ID empty to inherit the dialogue model. Validation never switches this model during a run.</p>
      <label>Provider<select id="aiModelProvider"><option value="lmstudio">LM Studio</option><option value="llama-server">llama-server</option></select></label>
      <label>Endpoint<input id="aiModelURL" value="http://127.0.0.1:1234/v1"></label>
      <label>Model ID<input id="aiModelID" placeholder="inherit dialogue model"></label>
      <button id="save">Save local model</button><p id="saveState" class="muted"></p>
    </section>
    <section class="card">
      <h2>Validate Training</h2>
      <p class="muted">One-click validation is started from Scenario Studio. Runtime stores the evidence-backed report without changing the Unity scenario asset.</p>
      <div id="validationState">No validation has run.</div>
      <div id="validationComparison" class="grid"></div>
      <div id="validationFindings"></div>
      <div id="validationReplay"></div>
      <div id="validationExports" class="grid"></div>
    </section>
    <section class="card">
      <h2>Local voice</h2>
      <p class="muted">Optional OpenAI-compatible loopback endpoints. Leave a model empty to disable that direction.</p>
      <label>STT base URL<input id="sttURL" value="http://127.0.0.1:8000/v1"></label>
      <label>STT model<input id="sttModel" placeholder="whisper model ID"></label>
      <label>Language<input id="sttLanguage" value="uk"></label>
      <label>TTS endpoint<input id="ttsURL" value="http://127.0.0.1:8080/v1/audio/speech"></label>
      <label>TTS model<input id="ttsModel" placeholder="speech model ID"></label>
      <label>TTS voice<input id="ttsVoice" value="instructor"></label>
    </section>
    <section class="card">
      <h2>Training results and retention</h2>
      <p class="muted">JSON, CSV and signed audit remain local. Optional xAPI uses an OS-protected bearer credential and a durable idempotent outbox.</p>
      <label><input id="xapiEnabled" type="checkbox"> Enable xAPI delivery</label>
      <label>LRS endpoint<input id="xapiEndpoint" placeholder="https://lrs.example/xapi"></label>
      <label>Game-owned actor account<input id="xapiActor" placeholder="deployment pseudonym"></label>
      <label>Bearer credential<input id="xapiToken" type="password" autocomplete="off" placeholder="stored in Keychain or DPAPI"></label>
      <div class="grid"><button id="saveCredential">Store protected credential</button><button class="secondary" id="testXapi">Test xAPI</button><button class="secondary" id="retryXapi">Retry outbox</button></div>
      <p id="xapiState" class="muted"></p>
      <div class="grid">
        <label>Logs, days<input id="logsDays" type="number" min="1" max="3650" value="14"></label>
        <label>Replays, days<input id="replaysDays" type="number" min="1" max="3650" value="30"></label>
        <label>Results, days<input id="resultsDays" type="number" min="1" max="3650" value="365"></label>
      </div>
    </section>
    <section class="card">
      <h2>AI Scenario Tests</h2>
      <p class="muted">Run one visible AI Trainee in the connected Unity simulation, or up to 100 side-effect-free fixture runs. The AI can only choose typed capabilities exposed by the game.</p>
      <div class="grid">
        <label>Profile<select id="aiProfile"><option value="guided">Guided · sees current instruction</option><option value="blind">Blind · sees goal and world only</option></select></label>
        <label>Deterministic seed<input id="aiSeed" type="number" min="0" max="2147483647" value="1"></label>
      </div>
      <div class="grid"><button id="aiStart">Start live AI Trainee</button><button class="secondary" id="aiPause">Pause</button><button class="secondary" id="aiResume">Resume</button><button class="secondary" id="aiCancel">Stop</button></div>
      <p id="aiLiveState" class="muted">No active AI Trainee.</p>
      <div id="aiTimeline" class="timeline"></div>
      <hr>
      <div class="grid">
        <label>Fixture JSON<input id="aiFixture" type="file" accept="application/json,.json"></label>
        <label>Runs (1–100)<input id="aiRuns" type="number" min="1" max="100" value="10"></label>
      </div>
      <button id="aiBatch">Run safe fixture batch</button>
      <p id="aiBatchState" class="muted">No fixture batch has run.</p>
      <div class="grid"><a class="button" href="/v1/ai-trainee/export.json">Export JSON</a><a class="button" href="/v1/ai-trainee/junit">Export JUnit</a></div>
    </section>
    <section class="card">
      <h2>Replay Lab</h2>
      <p class="muted">Evaluate a sanitized fixture or compare it with a known-good baseline. Replay never executes live actions.</p>
      <div class="grid">
        <label>Candidate fixture<input id="replayCandidate" type="file" accept="application/json,.json"></label>
        <label>Optional baseline<input id="replayBaseline" type="file" accept="application/json,.json"></label>
      </div>
      <button id="runReplay">Run deterministic replay</button>
      <div id="replayResult" class="muted">No replay selected.</div>
      <div id="replayTimeline" class="timeline"></div>
    </section>
    <section class="card"><h2>Reliability</h2><p>Replay covers duplicate responses, ordering, reconnect and crash recovery, permissions, result delivery, memory isolation, terminal turns and barge-in.</p><a class="button" href="/v1/diagnostics">Export sanitized diagnostics</a></section>
  </div>
  <script>
    const login = document.querySelector('#login'); const dashboard = document.querySelector('#dashboard');
    const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
    async function load() {
      const response = await fetch('/v1/status'); if (!response.ok) return false;
      const value = await response.json(); login.hidden = true; dashboard.hidden = false;
      document.querySelector('#runtime').innerHTML = '<span class="' + (value.status === 'ready' ? 'ok' : 'bad') + '">' + esc(value.status) + '</span><br>Protocol ' + esc(value.bridge.protocol) + ' · ' + esc(value.bridge.version) + '<br>Engine ' + esc(value.engine.url) + '<br>Previous unclean shutdown: ' + esc(Boolean(value.supervisor?.previousUncleanShutdown));
      const clients = value.bridge.connectedClients ?? []; document.querySelector('#clients').innerHTML = clients.length ? '<ul>' + clients.map((item) => '<li>' + esc(item.clientID ?? 'client') + '</li>').join('') + '</ul>' : '<span class="muted">No connected clients</span>';
      if (value.configuration?.providerID) document.querySelector('#provider').value = value.configuration.providerID;
      if (value.configuration?.baseURL) document.querySelector('#baseURL').value = value.configuration.baseURL;
      if (value.configuration?.modelID) document.querySelector('#modelID').value = value.configuration.modelID;
      document.querySelector('#aiModelProvider').value = value.configuration?.aiTraineeModel?.providerID ?? value.configuration?.providerID ?? 'lmstudio';
      document.querySelector('#aiModelURL').value = value.configuration?.aiTraineeModel?.baseURL ?? value.configuration?.baseURL ?? 'http://127.0.0.1:1234/v1';
      document.querySelector('#aiModelID').value = value.configuration?.aiTraineeModel?.modelID ?? '';
      if (value.configuration?.speech?.transcription?.baseURL) document.querySelector('#sttURL').value = value.configuration.speech.transcription.baseURL;
      if (value.configuration?.speech?.transcription?.modelID) document.querySelector('#sttModel').value = value.configuration.speech.transcription.modelID;
      if (value.configuration?.speech?.transcription?.language) document.querySelector('#sttLanguage').value = value.configuration.speech.transcription.language;
      if (value.configuration?.speech?.synthesis?.endpoint) document.querySelector('#ttsURL').value = value.configuration.speech.synthesis.endpoint;
      if (value.configuration?.speech?.synthesis?.modelID) document.querySelector('#ttsModel').value = value.configuration.speech.synthesis.modelID;
      if (value.configuration?.speech?.synthesis?.voice) document.querySelector('#ttsVoice').value = value.configuration.speech.synthesis.voice;
      document.querySelector('#xapiEnabled').checked = Boolean(value.configuration?.xapi?.enabled);
      if (value.configuration?.xapi?.endpoint) document.querySelector('#xapiEndpoint').value = value.configuration.xapi.endpoint;
      if (value.configuration?.xapi?.actorAccount) document.querySelector('#xapiActor').value = value.configuration.xapi.actorAccount;
      document.querySelector('#logsDays').value = value.configuration?.retention?.logsDays ?? 14;
      document.querySelector('#replaysDays').value = value.configuration?.retention?.replaysDays ?? 30;
      document.querySelector('#resultsDays').value = value.configuration?.retention?.resultsDays ?? 365;
      document.querySelector('#xapiState').textContent = value.xapi?.configured ? 'Outbox: ' + (value.xapi.pending ?? 0) + ' pending · ' + (value.xapi.uncertain ?? 0) + ' uncertain · ' + (value.xapi.delivered ?? 0) + ' delivered' : 'xAPI credential is not configured.';
      const ai = value.aiTrainee?.active; const attempts = ai?.attempts ?? [];
      document.querySelector('#aiLiveState').innerHTML = ai ? '<strong>' + esc(ai.profile) + '</strong> · ' + esc(ai.status) + ' · ' + attempts.length + '/64 decisions' + (ai.reason ? '<br><span class="bad">' + esc(ai.reason) + '</span>' : '') : 'No active AI Trainee.';
      document.querySelector('#aiTimeline').innerHTML = attempts.map((attempt) => '<div class="event"><code>' + esc(attempt.sequence) + '</code><span>' + esc(attempt.decision.capabilityID) + ' → ' + esc(attempt.decision.entityID) + '</span><span class="' + (attempt.ok ? 'ok' : 'bad') + '">' + esc(attempt.code) + '</span></div>').join('');
      const batch = value.aiTrainee?.batch;
      document.querySelector('#aiBatchState').innerHTML = batch ? '<strong>' + esc(batch.status) + '</strong> · ' + esc(batch.completedRuns) + '/' + esc(batch.requestedRuns) + ' runs · pass ' + esc(Math.round((batch.passRate ?? 0) * 100)) + '% · completion ' + esc(Math.round((batch.completionRate ?? 0) * 100)) + '% · unsafe attempts ' + esc(batch.unsafeAttempts ?? 0) : 'No fixture batch has run.';
      const validation = value.validation?.active; const report = value.validation?.report;
      document.querySelector('#validationState').innerHTML = report ? '<strong class="' + (report.readiness === 'ready' ? 'ok' : 'bad') + '">' + esc(report.readiness.replace('_',' ').toUpperCase()) + '</strong><br>' + esc(report.summary) : validation ? '<strong>' + esc(validation.stage) + '</strong> · ' + esc(validation.status) : 'No validation has run.';
      const runCard = (label, run) => run ? '<div class="assertion"><strong>' + label + '</strong><br>' + esc(run.status) + ' · ' + esc(run.successfulActions) + '/' + esc(run.attempts) + ' successful' + (run.firstDivergence ? '<br><span class="bad">First divergence ' + esc(run.firstDivergence.sequence) + ': expected ' + esc(run.firstDivergence.expected) + ', got ' + esc(run.firstDivergence.actual) + '</span>' : '') + '</div>' : '';
      const platforms = (report?.platforms ?? []).map((item) => '<div class="assertion ' + (item.status === 'failed' ? 'failed' : '') + '"><strong>' + esc(item.platform.toUpperCase()) + '</strong><br>' + esc(item.status) + (item.detail ? ' · ' + esc(item.detail) : '') + '</div>').join('');
      document.querySelector('#validationComparison').innerHTML = report ? runCard('Guided', report.guided) + runCard('Blind', report.blind) + platforms : '';
      document.querySelector('#validationFindings').innerHTML = (report?.findings ?? []).map((item) => '<div class="assertion ' + (item.severity === 'error' ? 'failed' : '') + '"><strong>' + esc(item.title) + '</strong><br><span class="muted">' + esc(item.detail) + '</span><br>Fix: ' + esc(item.recommendation) + '</div>').join('');
      document.querySelector('#validationReplay').innerHTML = (report?.replayAssertions ?? []).map((item) => '<div class="assertion ' + (item.passed ? '' : 'failed') + '"><strong>Replay · ' + esc(item.fixtureID) + '</strong><br>' + (item.passed ? 'All assertions passed' : 'First failure: ' + esc(item.firstFailure ?? 'unknown')) + '</div>').join('');
      document.querySelector('#validationExports').innerHTML = report ? '<a class="button" href="/v1/validation/reports/' + encodeURIComponent(report.id) + '.json">JSON</a><a class="button" href="/v1/validation/reports/' + encodeURIComponent(report.id) + '.html">HTML</a><a class="button" href="/v1/validation/reports/' + encodeURIComponent(report.id) + '.junit.xml">JUnit</a>' : '';
      return true;
    }
    document.querySelector('#unlock').onclick = async () => {
      const response = await fetch('/v1/auth', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({token: document.querySelector('#token').value}) });
      if (!response.ok) { document.querySelector('#loginError').textContent = 'Invalid token'; return; } document.querySelector('#token').value = ''; await load();
    };
    document.querySelector('#save').onclick = async () => {
      const sttModel = document.querySelector('#sttModel').value.trim(); const ttsModel = document.querySelector('#ttsModel').value.trim();
      const speech = { ...(sttModel ? { transcription: { baseURL: document.querySelector('#sttURL').value, modelID: sttModel, language: document.querySelector('#sttLanguage').value } } : {}), ...(ttsModel ? { synthesis: { endpoint: document.querySelector('#ttsURL').value, modelID: ttsModel, voice: document.querySelector('#ttsVoice').value } } : {}) };
      const xapiEnabled = document.querySelector('#xapiEnabled').checked; const xapiEndpoint = document.querySelector('#xapiEndpoint').value.trim(); const xapiActor = document.querySelector('#xapiActor').value.trim();
      const aiModelID = document.querySelector('#aiModelID').value.trim();
      const body = { providerID: document.querySelector('#provider').value, baseURL: document.querySelector('#baseURL').value, modelID: document.querySelector('#modelID').value, ...(aiModelID ? { aiTraineeModel: { providerID: document.querySelector('#aiModelProvider').value, baseURL: document.querySelector('#aiModelURL').value, modelID: aiModelID } } : {}), ...(Object.keys(speech).length ? { speech } : {}), retention: { logsDays: Number(document.querySelector('#logsDays').value), replaysDays: Number(document.querySelector('#replaysDays').value), resultsDays: Number(document.querySelector('#resultsDays').value) }, ...(xapiEndpoint && xapiActor ? { xapi: { enabled: xapiEnabled, endpoint: xapiEndpoint, actorAccount: xapiActor } } : {}) };
      const response = await fetch('/v1/config', { method: 'PUT', headers: {'content-type':'application/json'}, body: JSON.stringify(body) });
      document.querySelector('#saveState').textContent = response.ok ? 'Saved. Restart Runtime to apply.' : 'Configuration is invalid.';
    };
    document.querySelector('#saveCredential').onclick = async () => {
      const token = document.querySelector('#xapiToken').value; if (!token) { document.querySelector('#xapiState').textContent = 'Enter a bearer credential.'; return; }
      const response = await fetch('/v1/xapi/credential', { method: 'PUT', headers: {'content-type':'application/json'}, body: JSON.stringify({bearerToken: token}) });
      document.querySelector('#xapiToken').value = ''; document.querySelector('#xapiState').textContent = response.ok ? 'Credential stored by the operating system.' : 'Credential storage failed.';
    };
    document.querySelector('#testXapi').onclick = async () => { const response = await fetch('/v1/xapi/test', {method:'POST'}); const value = await response.json(); document.querySelector('#xapiState').textContent = response.ok && value.ok ? 'xAPI endpoint is ready.' : 'xAPI test failed: ' + esc(value.status ?? value.error ?? 'unknown'); };
    document.querySelector('#retryXapi').onclick = async () => { const response = await fetch('/v1/xapi/retry', {method:'POST',headers:{'content-type':'application/json'},body:'{}'}); const value = await response.json(); document.querySelector('#xapiState').textContent = response.ok ? 'Outbox: ' + value.pending + ' pending · ' + value.uncertain + ' uncertain · ' + value.delivered + ' delivered' : 'xAPI retry failed.'; };
    const aiControl = async (action) => { const response = await fetch('/v1/ai-trainee/' + action, {method:'POST',headers:{'content-type':'application/json'},body: action === 'live' ? JSON.stringify({profile:document.querySelector('#aiProfile').value,seed:Number(document.querySelector('#aiSeed').value)}) : '{}'}); const value = await response.json(); if (!response.ok) document.querySelector('#aiLiveState').innerHTML = '<span class="bad">' + esc(value.error ?? value.code ?? 'AI Trainee command failed') + '</span>'; await load(); };
    document.querySelector('#aiStart').onclick = () => aiControl('live');
    document.querySelector('#aiPause').onclick = () => aiControl('pause');
    document.querySelector('#aiResume').onclick = () => aiControl('resume');
    document.querySelector('#aiCancel').onclick = () => aiControl('cancel');
    document.querySelector('#aiBatch').onclick = async () => {
      const file = document.querySelector('#aiFixture').files[0]; if (!file) { document.querySelector('#aiBatchState').textContent = 'Choose a fixture JSON file.'; return; }
      try {
        const fixture = JSON.parse(await file.text()); const response = await fetch('/v1/ai-trainee/batch', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fixture,profile:document.querySelector('#aiProfile').value,runs:Number(document.querySelector('#aiRuns').value),seed:Number(document.querySelector('#aiSeed').value)})});
        const value = await response.json(); document.querySelector('#aiBatchState').textContent = response.ok ? 'Batch started. Live Unity state will not be touched.' : (value.error ?? 'Batch failed to start.');
      } catch (error) { document.querySelector('#aiBatchState').textContent = error instanceof Error ? error.message : String(error); }
    };
    const replayFile = async (selector) => {
      const file = document.querySelector(selector).files[0];
      if (!file) return undefined;
      return JSON.parse(await file.text());
    };
    document.querySelector('#runReplay').onclick = async () => {
      const result = document.querySelector('#replayResult'); const timeline = document.querySelector('#replayTimeline');
      try {
        const candidate = await replayFile('#replayCandidate'); const baseline = await replayFile('#replayBaseline');
        if (!candidate) { result.textContent = 'Choose a candidate fixture.'; return; }
        const response = await fetch(baseline ? '/v1/replay/compare' : '/v1/replay/evaluate', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(baseline ? {baseline, candidate} : candidate) });
        const value = await response.json(); if (!response.ok) throw new Error(value.error ?? 'Replay failed');
        const assertions = value.assertions ?? value.regressions ?? [];
        result.innerHTML = '<p class="' + (value.passed ? 'ok' : 'bad') + '">' + (value.passed ? 'Replay passed' : 'Replay found a regression') + '</p>' + assertions.map((item) => '<div class="assertion ' + (item.passed ? '' : 'failed') + '"><strong>' + esc(item.id) + '</strong><br><span class="muted">' + esc(item.detail) + '</span></div>').join('') + (value.firstDifference ? '<div class="assertion failed"><strong>First divergence at sequence ' + esc(value.firstDifference.sequence) + '</strong><br>' + esc(value.firstDifference.detail) + '</div>' : '');
        timeline.innerHTML = (candidate.events ?? []).map((event) => '<div class="event"><code>' + esc(event.sequence) + '</code><span>' + esc(event.type) + '</span><span class="muted">' + esc(event.stepID ?? event.actionID ?? event.phase ?? '') + '</span></div>').join('');
      } catch (error) { result.textContent = error instanceof Error ? error.message : String(error); timeline.innerHTML = ''; }
    };
    load(); setInterval(() => { if (!dashboard.hidden) load(); }, 3000);
  </script>
</main></body></html>`
