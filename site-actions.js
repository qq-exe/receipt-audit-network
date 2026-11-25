// site-actions.js — registers this site's operations with the agent runtime.
//
// agent-manifest.json loads this module through "actions.module". Only the names listed
// in "actions.agentTools" become model tools, exposed as website_<name>.
//
// Every action wraps a function the page's own buttons already use, so the visitor and
// the agent get one set of rules, and nothing here decides anything the page cannot.

import { App } from "./js/app.js";

const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Registers one exact capability (audit a receipt), plus the two reads an agent needs
 * to use it honestly: what the site supports, and a way to show the result on the page.
 */
class SiteActions {
  /**
   * Register every site action with the runtime.
   * @param {{register: (definition: object) => void}} actions
   */
  static registerActions(actions) {
    actions.register(SiteActions.readSiteAction());
    actions.register(SiteActions.auditReceiptAction());
    actions.register(SiteActions.showAuditAction());
  }

  /**
   * What this site can and cannot do. Kept as one read so the rules are not copied
   * into the agent's instructions, where they would drift.
   */
  static readSiteAction() {
    return {
      name: "read_site",
      description:
        "Returns what this receipt-audit site supports: the capability it publishes, the input it takes, "
        + "and the checks it refuses to make. Call this before promising the visitor any kind of check, "
        + "so you do not offer something this site cannot do.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      effect: "read",
      execute() {
        const s = App.page.state();
        return {
          site: "Receipt Audit Network",
          capability: s.capability.name,
          input: s.capability.input,
          output: s.capability.output,
          does_not: s.capability.does_not,
          supported_checks: [
            "repeated lines with the same item name (probable double scan)",
            "the difference between the items' sum and the printed total",
            "the amount plausibly overcharged, from duplicates only",
          ],
          refused_checks: [
            "whether a unit price is fair or above market",
            "tax, tip or discount correctness when the receipt does not print them",
            "reading a photo: this site takes text or structured line items only",
            "contacting the merchant, filing a dispute or issuing a refund",
          ],
          sample_text: s.sample_text,
          limits: "Arithmetic on printed values only. No market prices, no guessing.",
        };
      },
    };
  }

  /**
   * The capability itself: audit line items against the printed total.
   * Deterministic. Same input, same answer, no model involved.
   */
  static auditReceiptAction() {
    return {
      name: "audit_receipt",
      description:
        "Audits a receipt's line items. Returns the item sum, the printed total, the difference between them, "
        + "any item name that appears more than once (a probable double scan), and the amount plausibly "
        + "overcharged from those duplicates. Use it whenever the visitor gives you receipt lines and asks "
        + "whether they were overcharged or whether the total is right. It only does arithmetic on the values "
        + "you pass: it never estimates a fair price, and it does not read images. Pass every printed line, "
        + "including repeated ones, exactly once each.",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 200,
            description: "The printed line items, one entry per line, including repeated lines.",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  minLength: 1,
                  maxLength: 120,
                  description: "The item name as printed, without the price.",
                },
                qty: {
                  type: "number",
                  minimum: 0,
                  maximum: 999,
                  description: "Units on this line, from a printed '2 x' pattern. Defaults to 1.",
                },
                unit_price: {
                  type: "number",
                  minimum: -1000000,
                  maximum: 1000000,
                  description: "Price per unit if printed. Omit when the line only shows a line amount.",
                },
                amount: {
                  type: "number",
                  minimum: -1000000,
                  maximum: 1000000,
                  description: "The line total as printed, after any line-level discount.",
                },
              },
              required: ["name", "amount"],
              additionalProperties: false,
            },
          },
          printed_total: {
            type: "number",
            minimum: -1000000,
            maximum: 1000000,
            description: "The total printed on the receipt. Omit if the receipt shows no total, rather than computing one.",
          },
          currency: {
            type: "string",
            maxLength: 8,
            description: "Currency code shown on the receipt, such as CNY. Defaults to CNY.",
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
      effect: "read",
      execute(args) {
        const items = (args.items || []).map((it) => ({
          name: it.name,
          qty: it.qty == null ? 1 : it.qty,
          unit_price: it.unit_price == null ? null : it.unit_price,
          amount: it.amount,
        }));
        const printed = args.printed_total == null ? null : args.printed_total;
        const result = App.page.auditItems(items, printed, args.currency);
        if (result.ok === false) {
          return { ok: false, reason: result.reason, rejected: result.skipped || [] };
        }
        // Trim to what the model needs; the page keeps the full object.
        return {
          ok: true,
          currency: result.currency,
          line_count: result.line_count,
          item_sum: money(result.item_sum),
          printed_total: result.printed_total == null ? null : money(result.printed_total),
          total_delta: result.total_delta == null ? null : money(result.total_delta),
          duplicates: result.duplicates.map((d) => ({
            name: d.name,
            count: d.count,
            excess: money(d.excess),
          })),
          suspect_overcharge: money(result.suspect_overcharge),
          findings: result.findings.map((f) => f.text),
          limits: result.limits,
        };
      },
    };
  }

  /**
   * Same audit, but leaves the report on the page so the visitor sees what ran.
   * A write: it changes visible page state and the visitor can audit again to undo it.
   */
  static showAuditAction() {
    return {
      name: "show_audit",
      description:
        "Runs the audit and displays the full report on this page, so the visitor can read it themselves. "
        + "Use it after audit_receipt when the visitor would benefit from seeing the numbers on screen, or "
        + "when they ask you to 'show me'. It changes only the report panel, never the receipt text.",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 200,
            description: "The same line items you passed to audit_receipt.",
            items: {
              type: "object",
              properties: {
                name: { type: "string", minLength: 1, maxLength: 120 },
                qty: { type: "number", minimum: 0, maximum: 999 },
                unit_price: { type: "number", minimum: -1000000, maximum: 1000000 },
                amount: { type: "number", minimum: -1000000, maximum: 1000000 },
              },
              required: ["name", "amount"],
              additionalProperties: false,
            },
          },
          printed_total: {
            type: "number",
            minimum: -1000000,
            maximum: 1000000,
            description: "The printed total, if the receipt shows one.",
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
      effect: "write",
      execute(args) {
        const items = (args.items || []).map((it) => ({
          name: it.name,
          qty: it.qty == null ? 1 : it.qty,
          unit_price: it.unit_price == null ? null : it.unit_price,
          amount: it.amount,
        }));
        const result = App.page.auditItems(items, args.printed_total == null ? null : args.printed_total);
        if (result.ok === false) {
          return { ok: false, reason: result.reason };
        }
        return {
          ok: true,
          shown: true,
          line_count: result.line_count,
          suspect_overcharge: money(result.suspect_overcharge),
          total_delta: result.total_delta == null ? null : money(result.total_delta),
        };
      },
    };
  }
}

export { SiteActions };
export function registerActions(actions) {
  SiteActions.registerActions(actions);
}
