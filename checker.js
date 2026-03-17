/**
 * checker.js — Local data quality rules engine
 * All checks run client-side, no data leaves the browser at this stage.
 */

const INVALID_CHAR_RE = /[^0-9A-Za-z@]/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Run all enabled local checks on parsed data.
 * @param {Object} parsedData  - { data: Array<Object>, meta: { fields: string[] } }
 * @param {Object} checks      - enabled check flags
 * @param {string[]} mandatory - list of mandatory column names
 * @returns {Object[]} array of issue objects
 */
function runLocalChecks(parsedData, checks, mandatory) {
  const { data, meta } = parsedData;
  const fields = meta.fields;
  const issues = [];

  if (checks.dupes) {
    issues.push(...checkDuplicates(data));
  }

  if (checks.missing) {
    issues.push(...checkMissingValues(data, fields));
  }

  if (mandatory && mandatory.length > 0) {
    issues.push(...checkMandatoryColumns(data, fields, mandatory));
  }

  if (checks.chars) {
    issues.push(...checkInvalidCharacters(data, fields));
  }

  if (checks.format) {
    issues.push(...checkFormats(data, fields));
  }

  if (checks.formula) {
    issues.push(...checkMixedTypes(data, fields));
  }

  if (checks.outlier) {
    issues.push(...checkOutliers(data, fields));
  }

  return issues;
}

/* ── Individual check functions ── */

function checkDuplicates(data) {
  const issues = [];
  const seen = new Map();
  let dupCount = 0;
  const dupRows = [];

  data.forEach((row, i) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) {
      dupCount++;
      dupRows.push(i + 2); // 1-indexed + header row
    } else {
      seen.set(key, i + 2);
    }
  });

  if (dupCount > 0) {
    issues.push({
      severity: 'critical',
      type: 'Duplicate rows',
      desc: `${dupCount} exact duplicate row(s) detected. These inflate counts and skew aggregations.`,
      meta: `Rows: ${dupRows.slice(0, 5).join(', ')}${dupRows.length > 5 ? ' ...' : ''}`
    });
  }
  return issues;
}

function checkMissingValues(data, fields) {
  const issues = [];
  fields.forEach(col => {
    const missing = data.filter(r =>
      r[col] === '' || r[col] === null || r[col] === undefined
    ).length;

    if (missing > 0) {
      const pct = Math.round((missing / data.length) * 100);
      issues.push({
        severity: pct > 20 ? 'critical' : 'warning',
        type: 'Missing values',
        desc: `Column "${col}" has ${missing} missing value(s) — ${pct}% of all rows.`,
        meta: `Column: ${col}`
      });
    }
  });
  return issues;
}

function checkMandatoryColumns(data, fields, mandatory) {
  const issues = [];
  mandatory.forEach(col => {
    const match = fields.find(f => f.trim().toLowerCase() === col.trim().toLowerCase());
    if (!match) {
      issues.push({
        severity: 'critical',
        type: 'Mandatory column missing',
        desc: `Required column "${col}" does not exist in the dataset.`,
        meta: 'Expected mandatory column'
      });
    } else {
      const empty = data.filter(r =>
        r[match] === '' || r[match] === null || r[match] === undefined
      ).length;
      if (empty > 0) {
        issues.push({
          severity: 'critical',
          type: 'Mandatory column has blank values',
          desc: `Mandatory column "${match}" has ${empty} blank value(s).`,
          meta: `Column: ${match}`
        });
      }
    }
  });
  return issues;
}

function checkInvalidCharacters(data, fields) {
  const issues = [];
  fields.forEach(col => {
    const badRows = [];
    data.forEach((r, i) => {
      if (typeof r[col] === 'string' && INVALID_CHAR_RE.test(r[col])) {
        badRows.push(i + 2);
      }
    });
    if (badRows.length > 0) {
      issues.push({
        severity: 'warning',
        type: 'Invalid characters',
        desc: `Column "${col}" has ${badRows.length} cell(s) containing disallowed characters (\\, <, >, |, control chars, etc.).`,
        meta: `Column: ${col} · Rows: ${badRows.slice(0, 5).join(', ')}${badRows.length > 5 ? ' ...' : ''}`
      });
    }
  });
  return issues;
}

function checkFormats(data, fields) {
  const issues = [];
  fields.forEach(col => {
    const lc = col.toLowerCase();

    // Email columns
    if (lc.includes('email')) {
      const bad = data.filter(r => r[col] && r[col] !== '' && !EMAIL_RE.test(r[col].trim()));
      if (bad.length) {
        issues.push({
          severity: 'warning',
          type: 'Invalid email format',
          desc: `Column "${col}" has ${bad.length} cell(s) that don't match a valid email pattern.`,
          meta: `Column: ${col} · Expected: user@domain.com`
        });
      }
    }

    // Date columns
    if (lc.includes('date') || lc.includes('dob') || lc.includes('created') || lc.includes('updated')) {
      const nonEmpty = data.filter(r => r[col] && r[col] !== '');
      const badDates = nonEmpty.filter(r => isNaN(Date.parse(r[col])));
      if (badDates.length) {
        issues.push({
          severity: 'warning',
          type: 'Invalid date format',
          desc: `Column "${col}" has ${badDates.length} value(s) that cannot be parsed as a date.`,
          meta: `Column: ${col}`
        });
      }
    }

    // Phone columns
    if (lc.includes('phone') || lc.includes('mobile') || lc.includes('tel')) {
      const bad = data.filter(r => r[col] && !/^[\d\s+\-().]{7,20}$/.test(r[col]));
      if (bad.length) {
        issues.push({
          severity: 'info',
          type: 'Inconsistent phone format',
          desc: `Column "${col}" has ${bad.length} value(s) with potentially invalid phone numbers.`,
          meta: `Column: ${col}`
        });
      }
    }

    // URL columns
    if (lc.includes('url') || lc.includes('website') || lc.includes('link')) {
      const bad = data.filter(r => {
        if (!r[col] || r[col] === '') return false;
        try { new URL(r[col]); return false; } catch { return true; }
      });
      if (bad.length) {
        issues.push({
          severity: 'info',
          type: 'Invalid URL format',
          desc: `Column "${col}" has ${bad.length} value(s) that are not valid URLs.`,
          meta: `Column: ${col}`
        });
      }
    }

    // Whitespace padding
    const padded = data.filter(r =>
      typeof r[col] === 'string' && r[col] !== r[col].trim() && r[col].trim() !== ''
    );
    if (padded.length > 0) {
      issues.push({
        severity: 'info',
        type: 'Leading/trailing whitespace',
        desc: `Column "${col}" has ${padded.length} value(s) with leading or trailing spaces.`,
        meta: `Column: ${col}`
      });
    }

    // All-caps text (possible data entry error)
    if (!lc.includes('id') && !lc.includes('code')) {
      const allCaps = data.filter(r =>
        typeof r[col] === 'string' && r[col].length > 3 &&
        r[col] === r[col].toUpperCase() && /[A-Z]/.test(r[col])
      );
      if (allCaps.length > 0 && allCaps.length < data.length * 0.5) {
        issues.push({
          severity: 'info',
          type: 'All-caps values',
          desc: `Column "${col}" has ${allCaps.length} value(s) in ALL CAPS — may indicate inconsistent data entry.`,
          meta: `Column: ${col}`
        });
      }
    }
  });
  return issues;
}

function checkMixedTypes(data, fields) {
  const issues = [];
  fields.forEach(col => {
    const vals = data.map(r => r[col]).filter(v => v !== '' && v !== null && v !== undefined);
    if (vals.length < 5) return;

    const nums = vals.filter(v => !isNaN(parseFloat(v)) && isFinite(v));
    const strs = vals.filter(v => isNaN(parseFloat(v)) || !isFinite(v));

    if (nums.length > 0 && strs.length > 0) {
      const minorPct = Math.round((Math.min(nums.length, strs.length) / vals.length) * 100);
      if (minorPct > 5) {
        issues.push({
          severity: 'warning',
          type: 'Mixed data types',
          desc: `Column "${col}" contains a mix of numeric (${nums.length}) and text (${strs.length}) values — likely a formula/type mismatch.`,
          meta: `Column: ${col}`
        });
      }
    }

    // Boolean inconsistency — mix of Yes/No with 1/0 or TRUE/FALSE
    const boolWords = vals.filter(v => /^(yes|no|true|false)$/i.test(String(v).trim()));
    const boolNums = vals.filter(v => /^[01]$/.test(String(v).trim()));
    if (boolWords.length > 0 && boolNums.length > 0) {
      issues.push({
        severity: 'warning',
        type: 'Inconsistent boolean format',
        desc: `Column "${col}" mixes boolean representations: Yes/No (${boolWords.length}) and 1/0 (${boolNums.length}).`,
        meta: `Column: ${col} · Standardise to one format`
      });
    }
  });
  return issues;
}

function checkOutliers(data, fields) {
  const issues = [];
  fields.forEach(col => {
    const nums = data.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
    if (nums.length < 10) return;

    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nums.length;
    const std = Math.sqrt(variance);
    if (std === 0) return;

    const outliers = nums.filter(v => Math.abs(v - mean) > 3 * std);
    if (outliers.length > 0) {
      issues.push({
        severity: 'info',
        type: 'Statistical outliers',
        desc: `Column "${col}" has ${outliers.length} value(s) beyond 3 standard deviations from the mean.`,
        meta: `Column: ${col} · Mean: ${mean.toFixed(2)} · Std dev: ${std.toFixed(2)}`
      });
    }
  });
  return issues;
}

/**
 * Compute overall quality score from issues array.
 * @param {Object[]} issues
 * @param {number} rowCount
 * @returns {number} 0-100
 */
function computeScore(issues, rowCount) {
  const critical = issues.filter(i => i.severity === 'critical').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const info = issues.filter(i => i.severity === 'info').length;
  const score = Math.max(0, 100 - critical * 15 - warnings * 7 - info * 2);
  return Math.min(100, score);
}
