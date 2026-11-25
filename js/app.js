// app.js — page state and operations for the receipt audit site.
//
// The page's own buttons and the agent's tools call the same methods, so the visitor
// and an agent always get the same answer from the same code.

import { parseReceiptText, auditReceipt } from './audit-core.js';

const SAMPLE_TEXT = [
  'SAMPLE SUPERMARKET',
  'No.20261124-1932   Cashier 07',
  'Fragrant Rice 5kg      1 x 39.90     39.90',
  'Pure Milk 250mlx12     1 x 45.00     45.00',
  'Eggs 30-pack           1 x 18.50     18.50',
  'Eggs 30-pack           1 x 18.50     18.50',
  'Tomatoes 500g          1 x  6.60      6.60',
  'TOTAL                               128.50',
].join('\n');

const el = (id) => document.getElementById(id);

const page = {
  /** Last audit result, kept so the state reader and the page show the same thing. */
  _last: null,
  /** Monotonic counter: increments whenever the shown result changes. */
  _version: 0,

  /**
   * Plain-JSON snapshot of what the page currently shows.
   * Copies values; never returns live objects.
   */
  state() {
    const input = el('receipt-text');
    return {
      version: this._version,
      sample_text: SAMPLE_TEXT,
      input_text: input ? input.value : '',
      input_lines: input ? input.value.split(/\r?\n/).filter((l) => l.trim()).length : 0,
      last_result: this._last ? JSON.parse(JSON.stringify(this._last)) : null,
      has_result: Boolean(this._last),
      capability: {
        name: 'audit_receipt',
        input: 'line items (name, qty, unit_price, amount) and the printed total',
        output: 'duplicate lines, item sum, printed total, total delta, suspect overcharge',
        does_not: 'estimate fair prices, infer tax, read a photo, or contact a merchant',
      },
    };
  },

  /**
   * Audit pasted receipt text. Convenience path for humans.
   * @param {string} text
   * @returns {object} result, or a refusal with ok:false
   */
  auditText(text) {
    const parsed = parseReceiptText(text);
    if (parsed.items.length === 0) {
      return {
        ok: false,
        reason: 'No line items with an amount were found in that text. Paste the item lines, or send structured items.',
        skipped: parsed.skipped.slice(0, 6),
      };
    }
    return this._finish(auditReceipt({
      items: parsed.items,
      printed_total: parsed.printed_total,
    }));
  },

  /**
   * Audit structured items. This is what the agent capability calls.
   * @param {Array<{name: string, qty?: number, unit_price?: number|null, amount: number}>} items
   * @param {number|null} printedTotal
   * @param {string} [currency]
   * @returns {object}
   */
  auditItems(items, printedTotal, currency) {
    const result = auditReceipt({
      items,
      printed_total: printedTotal == null ? null : printedTotal,
      currency: currency || 'CNY',
    });
    if (!result.ok) return result;
    return this._finish(result);
  },

  /**
   * Store a result, re-render, and return it.
   * @param {object} result
   * @returns {object}
   */
  _finish(result) {
    this._last = result;
    this._version += 1;
    render(result);
    return result;
  },

  /** Load the built-in sample into the textarea (does not audit by itself). */
  loadSample() {
    const input = el('receipt-text');
    if (input) input.value = SAMPLE_TEXT;
    return { ok: true, loaded: true, lines: SAMPLE_TEXT.split('\n').length };
  },
};

function fmt(n) {
  if (n == null) return '—';
  const v = Number(n);
  return (v < 0 ? '-' : '') + Math.abs(v).toFixed(2);
}

function render(result) {
  const out = el('result');
  if (!out) return;

  if (!result || result.ok === false) {
    out.innerHTML = `<div class="empty"><strong>Nothing to audit yet.</strong><span>${result ? result.reason : 'Paste a receipt and press Audit.'}</span></div>`;
    return;
  }

  const dupRows = result.duplicates.length
    ? result.duplicates.map((d) => `<tr><td>${escapeHtml(d.name)}</td><td>${d.count}</td><td class="num neg">−${fmt(d.excess)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">No repeated lines.</td></tr>';

  const findings = result.findings
    .map((f) => `<li class="f ${f.kind}">${escapeHtml(f.text)}</li>`)
    .join('');

  const delta = result.total_delta == null
    ? '<span class="muted">not printed</span>'
    : `<span class="${Math.abs(result.total_delta) >= 0.01 ? 'neg' : 'ok'}">${result.total_delta > 0 ? '+' : ''}${fmt(result.total_delta)}</span>`;

  out.innerHTML = `
    <div class="kpis">
      <div><span>Lines</span><b>${result.line_count}</b></div>
      <div><span>Items add up to</span><b>${fmt(result.item_sum)}</b></div>
      <div><span>Printed total</span><b>${result.printed_total == null ? '—' : fmt(result.printed_total)}</b></div>
      <div><span>Difference</span><b>${delta}</b></div>
      <div class="hl"><span>Suspect overcharge</span><b class="${result.suspect_overcharge > 0 ? 'neg' : ''}">${fmt(result.suspect_overcharge)}</b></div>
    </div>
    <h3>Duplicate lines</h3>
    <table class="t"><thead><tr><th>Item</th><th>Count</th><th>Excess</th></tr></thead><tbody>${dupRows}</tbody></table>
    <h3>Findings</h3>
    <ul class="findings">${findings}</ul>
    <p class="limits">${escapeHtml(result.limits)}</p>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function boot() {
  const form = el('audit-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = el('receipt-text') ? el('receipt-text').value : '';
      const result = page.auditText(text);
      if (result.ok === false) {
        const out = el('result');
        if (out) {
          out.innerHTML = `<div class="empty"><strong>That did not parse.</strong><span>${escapeHtml(result.reason)}</span></div>`;
        }
      }
    });
  }

  const sampleBtn = el('load-sample');
  if (sampleBtn) {
    sampleBtn.addEventListener('click', () => {
      page.loadSample();
    });
  }

  // JSON path, so a visitor can see exactly what an agent sends.
  const jsonForm = el('json-form');
  if (jsonForm) {
    jsonForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const box = el('json-input');
      let parsed;
      try {
        parsed = JSON.parse(box.value);
      } catch (err) {
        el('json-msg').textContent = 'Not valid JSON: ' + err.message;
        return;
      }
      const result = page.auditItems(parsed.items || [], parsed.printed_total ?? null, parsed.currency);
      el('json-msg').textContent = result.ok === false
        ? 'Refused: ' + result.reason
        : `Audited ${result.line_count} lines. Suspect overcharge ${result.suspect_overcharge.toFixed(2)}.`;
      render(result);
    });
  }

  // Start with the sample in the box so the first screen is not empty.
  page.loadSample();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// The runtime and the actions module both reach the page through App.page.
const App = { page };

export { App, page, SAMPLE_TEXT };
