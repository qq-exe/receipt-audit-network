// audit-core.js — deterministic receipt audit. No model, no network, no guessing.
//
// Everything here is arithmetic on what the receipt says. If a value is not printed,
// it is reported as missing rather than inferred. That property is the whole point of
// publishing this as an agent capability: another agent gets an answer it can re-check.

/**
 * Normalise a line-item name so that "Eggs 30-pack" and "eggs  30-pack " group together.
 * @param {string} s
 * @returns {string}
 */
export function normaliseName(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Round to 2 decimals without float drift (0.1 + 0.2 problems).
 * @param {number} n
 * @returns {number}
 */
export function money(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Parse one line of pasted receipt text into an amount.
 * Takes the right-most money-looking token, which is where receipts put the amount.
 * Returns null when the line has no amount, so the caller can skip it honestly.
 *
 * @param {string} line
 * @returns {number|null}
 */
export function amountFromLine(line) {
  const matches = String(line).match(/-?\d{1,7}(?:[.,]\d{2})/g);
  if (!matches || matches.length === 0) return null;
  const raw = matches[matches.length - 1].replace(',', '.');
  const n = Number(raw);
  return Number.isFinite(n) ? money(n) : null;
}

/**
 * Parse pasted receipt text into items. A line that looks like a total is not an item.
 * This is a convenience for humans; agents should pass structured items instead.
 *
 * @param {string} text
 * @returns {{items: Array, printed_total: number|null, skipped: Array<string>}}
 */
export function parseReceiptText(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const items = [];
  const skipped = [];
  let printed_total = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const amount = amountFromLine(line);
    if (amount == null) {
      skipped.push(line);
      continue;
    }

    // A total line carries the number but no quantity and no item name worth keeping.
    if (/^(total|amount due|balance|grand total|合计|总计|应收)/i.test(line)) {
      printed_total = amount;
      continue;
    }

    const qtyMatch = line.match(/(?:^|\s)(\d{1,3})\s*[x×*]\s*\d/i);
    const qty = qtyMatch ? Number(qtyMatch[1]) : 1;

    // Name = line minus the trailing amount, minus a quantity pattern.
    let name = line.replace(/\s*-?\d{1,7}[.,]\d{2}\s*$/, '');
    name = name.replace(/\s*\d{1,3}\s*[x×*]\s*\d+(?:[.,]\d+)?\s*$/i, '');
    name = name.replace(/\s{2,}.*$/, '').trim();
    if (!name) {
      skipped.push(line);
      continue;
    }

    items.push({
      name,
      qty,
      amount,
      unit_price: qty > 0 ? money(amount / qty) : null,
    });
  }

  return { items, printed_total, skipped };
}

/**
 * Audit structured items against the printed total.
 *
 * Rules, all arithmetic:
 *   1. group identical names; a group with a count above one is a probable double scan
 *   2. the duplicated amount is every occurrence beyond the first
 *   3. compare the item sum with the printed total and report the difference
 *
 * It never decides whether a price was fair. That would need a market-price source,
 * which this site does not have, and pretending otherwise is what makes receipt apps wrong.
 *
 * @param {{items: Array<{name: string, qty?: number, unit_price?: number|null, amount: number}>,
 *          printed_total?: number|null, currency?: string}} input
 * @returns {object}
 */
export function auditReceipt(input) {
  const currency = (input && input.currency) || 'CNY';
  const rawItems = Array.isArray(input && input.items) ? input.items : [];

  if (rawItems.length === 0) {
    return { ok: false, reason: 'no_items', skipped: [] , accepted: 0 };
  }

  const accepted = [];
  const rejected = [];

  for (const [i, it] of rawItems.entries()) {
    const name = it && it.name != null ? String(it.name).trim() : '';
    const amount = it && it.amount != null ? Number(it.amount) : NaN;

    if (!name) {
      rejected.push({ index: i, reason: 'missing_name' });
      continue;
    }
    if (!Number.isFinite(amount)) {
      rejected.push({ index: i, reason: 'missing_amount' });
      continue;
    }
    const qty = it.qty != null && Number.isFinite(Number(it.qty)) && Number(it.qty) > 0
      ? Number(it.qty)
      : 1;

    accepted.push({
      name,
      key: normaliseName(name),
      qty,
      amount: money(amount),
      unit_price: it.unit_price != null && Number.isFinite(Number(it.unit_price))
        ? money(Number(it.unit_price))
        : money(amount / qty),
    });
  }

  if (accepted.length === 0) {
    return { ok: false, reason: 'no_valid_items', skipped: rejected, accepted: 0 };
  }

  const groups = new Map();
  for (const it of accepted) {
    if (!groups.has(it.key)) {
      groups.set(it.key, { name: it.name, count: 0, amounts: [] });
    }
    const g = groups.get(it.key);
    g.count += 1;
    g.amounts.push(it.amount);
  }

  const duplicates = [];
  let duplicate_excess = 0;
  for (const [, g] of groups) {
    if (g.count > 1) {
      const excess = money(g.amounts.slice(1).reduce((a, b) => a + b, 0));
      duplicate_excess = money(duplicate_excess + excess);
      duplicates.push({
        name: g.name,
        count: g.count,
        amounts: g.amounts,
        excess,
      });
    }
  }

  const item_sum = money(accepted.reduce((a, it) => a + it.amount, 0));
  const printed_total = input.printed_total != null && Number.isFinite(Number(input.printed_total))
    ? money(Number(input.printed_total))
    : null;

  const total_delta = printed_total == null ? null : money(printed_total - item_sum);

  const findings = [];
  for (const d of duplicates) {
    findings.push({
      kind: 'duplicate_line',
      text: `"${d.name}" appears ${d.count} times (${d.amounts.map((a) => a.toFixed(2)).join(', ')}).`,
      amount: d.excess,
    });
  }
  if (printed_total == null) {
    findings.push({
      kind: 'no_printed_total',
      text: 'No printed total on this receipt, so the sum was not reconciled.',
      amount: null,
    });
  } else if (Math.abs(total_delta) >= 0.01) {
    findings.push({
      kind: 'total_mismatch',
      text: total_delta > 0
        ? `Printed total is ${total_delta.toFixed(2)} higher than the items add up to.`
        : `Printed total is ${Math.abs(total_delta).toFixed(2)} lower than the items add up to.`,
      amount: total_delta,
    });
  } else {
    findings.push({
      kind: 'total_matches',
      text: 'Printed total matches the sum of the items.',
      amount: 0,
    });
  }

  return {
    ok: true,
    currency,
    line_count: accepted.length,
    item_sum,
    printed_total,
    total_delta,
    duplicates,
    duplicate_excess,
    suspect_overcharge: duplicate_excess,
    findings,
    rejected,
    limits: 'Arithmetic on printed values only. No market prices, no tax inference, no guessing.',
  };
}
