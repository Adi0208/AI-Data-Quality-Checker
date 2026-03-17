/**
 * app.js — UI controller, file parsing, AI API integration, rendering
 */

/* ── State ── */
let parsedData = null;
let allIssues = [];
let fileName = '';

/* ── DOM refs ── */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const loadingBar = document.getElementById('loadingBar');
const loadingFill = document.getElementById('loadingFill');
const loadingLabel = document.getElementById('loadingLabel');
const resultsEl = document.getElementById('results');

/* ── File upload & drag-drop ── */
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  fileName = file.name;

  if (ext === 'csv') {
    parseCSV(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    parseExcel(file);
  } else {
    alert('Unsupported file type. Please upload a CSV or Excel file.');
  }
}

function parseCSV(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const result = Papa.parse(ev.target.result, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false
    });
    onFileParsed(result.data, result.meta.fields);
  };
  reader.readAsText(file);
}

function parseExcel(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const wb = XLSX.read(ev.target.result, { type: 'binary' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
    const fields = json.length > 0 ? Object.keys(json[0]) : [];
    onFileParsed(json, fields);
  };
  reader.readAsBinaryString(file);
}

function onFileParsed(data, fields) {
  parsedData = { data, meta: { fields } };
  dropZone.querySelector('.upload-title').innerHTML =
    `✓ <strong>${fileName}</strong> loaded`;
  dropZone.querySelector('.upload-sub').textContent =
    `${data.length} rows · ${fields.length} columns · Ready to analyze`;
  analyzeBtn.disabled = false;
}

/* ── Analyze ── */
analyzeBtn.addEventListener('click', async () => {
  if (!parsedData) return;

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing…';
  resultsEl.style.display = 'none';
  allIssues = [];

  showLoading('Running local checks…', 20);

  const checks = {
    missing: document.getElementById('chkMissing').checked,
    dupes: document.getElementById('chkDupes').checked,
    format: document.getElementById('chkFormat').checked,
    chars: document.getElementById('chkChars').checked,
    formula: document.getElementById('chkFormula').checked,
    outlier: document.getElementById('chkOutlier').checked
  };

  const mandatoryRaw = document.getElementById('mandatoryInput').value;
  const mandatory = mandatoryRaw
    ? mandatoryRaw.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const localIssues = runLocalChecks(parsedData, checks, mandatory);
  showLoading('Calling AI for deep analysis…', 60);

  const { aiIssues, summary, score } = await callClaudeAI(localIssues);

  allIssues = [...localIssues, ...aiIssues];
  showLoading('Rendering results…', 95);

  setTimeout(() => {
    hideLoading();
    renderResults(summary, score);
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Re-analyze →';
  }, 300);
});

/* ── Claude AI call ── */
async function callClaudeAI(localIssues) {
  const { data, meta } = parsedData;
  const context = document.getElementById('contextInput').value || 'general business dataset';
  const sample = data.slice(0, 5);

  const prompt = `You are a senior data quality engineer. Analyze this dataset and return ONLY a raw JSON object — no markdown, no explanation, no backticks.

Dataset: ${fileName}
Context: ${context}
Columns: ${meta.fields.join(', ')}
Sample rows (first 5): ${JSON.stringify(sample)}
Total rows: ${data.length}
Issues already detected locally: ${JSON.stringify(localIssues.slice(0, 10))}

Return this exact JSON:
{
  "summary": "2-3 sentence plain English summary of overall data quality state",
  "score": <integer 0-100>,
  "aiIssues": [
    { "severity": "critical|warning|info", "type": "Issue type name", "desc": "Clear description of the issue", "meta": "Column name or context" }
  ]
}

Focus ONLY on issues not already in the locally-detected list. Look for: semantic inconsistencies (e.g. both opt-in and opt-out are Yes), business logic violations, naming convention inconsistencies, cross-column contradictions, encoding anomalies, suspicious placeholder values (e.g. 'N/A', '0000', 'test'), case inconsistency within same column, unusual patterns in free-text fields.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) throw new Error('API error: ' + response.status);

    const result = await response.json();
    const text = result.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return {
      aiIssues: parsed.aiIssues || [],
      summary: parsed.summary || '',
      score: typeof parsed.score === 'number' ? parsed.score : null
    };
  } catch (err) {
    console.warn('AI analysis error:', err);
    return {
      aiIssues: [],
      summary: 'Local analysis complete. AI deep analysis unavailable — check your API key in the config.',
      score: null
    };
  }
}

/* ── Render ── */
function renderResults(summary, aiScore) {
  const critical = allIssues.filter(i => i.severity === 'critical').length;
  const warnings = allIssues.filter(i => i.severity === 'warning').length;
  const info = allIssues.filter(i => i.severity === 'info').length;

  const score = aiScore !== null
    ? aiScore
    : computeScore(allIssues, parsedData.data.length);

  const scoreColor = score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'bad';

  // File info
  document.getElementById('fileInfo').innerHTML =
    `📄 <strong>${fileName}</strong>&nbsp;&nbsp;·&nbsp;&nbsp;${parsedData.data.length} rows&nbsp;&nbsp;·&nbsp;&nbsp;${parsedData.meta.fields.length} columns`;

  // Metrics
  document.getElementById('metrics').innerHTML = `
    <div class="metric">
      <div class="m-label">Quality score</div>
      <div class="m-val ${scoreColor}">${score}</div>
    </div>
    <div class="metric">
      <div class="m-label">Critical</div>
      <div class="m-val ${critical > 0 ? 'bad' : 'ok'}">${critical}</div>
    </div>
    <div class="metric">
      <div class="m-label">Warnings</div>
      <div class="m-val ${warnings > 0 ? 'warn' : 'ok'}">${warnings}</div>
    </div>
    <div class="metric">
      <div class="m-label">Info</div>
      <div class="m-val">${info}</div>
    </div>
  `;

  // AI summary
  if (summary) {
    document.getElementById('aiSummary').style.display = 'block';
    document.getElementById('aiSummaryText').textContent = summary;
  }

  renderIssues('all');
  resultsEl.style.display = 'block';
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderIssues(filter) {
  const list = filter === 'all'
    ? allIssues
    : allIssues.filter(i => i.severity === filter);

  document.getElementById('issueCount').textContent = list.length;

  if (list.length === 0) {
    document.getElementById('issuesList').innerHTML =
      '<div class="no-issues">No issues found for this filter ✓</div>';
    return;
  }

  document.getElementById('issuesList').innerHTML = list.map(i => `
    <div class="issue-card ${i.severity}">
      <div class="issue-top">
        <span class="badge ${i.severity}">${i.severity}</span>
        <span class="issue-title">${escapeHtml(i.type)}</span>
      </div>
      <div class="issue-desc">${escapeHtml(i.desc)}</div>
      <div class="issue-meta">${escapeHtml(i.meta || '')}</div>
    </div>
  `).join('');
}

/* ── Filter tabs ── */
document.getElementById('filterTabs').addEventListener('click', e => {
  const tab = e.target.closest('.ftab');
  if (!tab) return;
  document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  renderIssues(tab.dataset.filter);
});

/* ── Export ── */
document.getElementById('exportBtn').addEventListener('click', exportReport);

function exportReport() {
  const lines = [
    'AI DATA QUALITY REPORT',
    '='.repeat(50),
    `File: ${fileName}`,
    `Date: ${new Date().toLocaleString()}`,
    `Total rows: ${parsedData.data.length}`,
    `Total issues: ${allIssues.length}`,
    `Critical: ${allIssues.filter(i => i.severity === 'critical').length}`,
    `Warnings: ${allIssues.filter(i => i.severity === 'warning').length}`,
    `Info: ${allIssues.filter(i => i.severity === 'info').length}`,
    '',
    'ISSUES',
    '-'.repeat(50),
    ...allIssues.map((issue, n) =>
      `${n + 1}. [${issue.severity.toUpperCase()}] ${issue.type}\n   ${issue.desc}\n   ${issue.meta || ''}\n`
    )
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `data-quality-report-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Helpers ── */
function showLoading(label, pct) {
  loadingBar.style.display = 'block';
  loadingFill.style.width = pct + '%';
  loadingLabel.textContent = label;
}

function hideLoading() {
  loadingFill.style.width = '100%';
  setTimeout(() => {
    loadingBar.style.display = 'none';
    loadingFill.style.width = '0%';
    loadingLabel.textContent = '';
  }, 300);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
