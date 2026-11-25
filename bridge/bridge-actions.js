// The actions this site shares with other agent sites, through its action bridge.
// The build names this file in bridge/agent-manifest.json. When another site's assistant
// calls this site, the bridge loads it in a hidden frame on this site's origin, which has
// no page.
//
// This site shares exactly one thing: the audit itself. It is a pure function over the
// arguments, reads no page state and returns nothing about any visitor, so sharing it
// with every origin costs nothing and is the reason the capability is worth publishing.

import { auditReceipt } from "../js/audit-core.js";

const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

class BridgeActions {
  /**
   * Origins allowed to call these reads. "*" is deliberate here: the audit is arithmetic
   * over the caller's own arguments, never over this site's data or a visitor's history.
   */
  static CALLERS = ["*"];

  static registerActions(actions) {
    actions.register(BridgeActions.auditAction());
  }

  static auditAction() {
    return {
      name: "audit_receipt",
      description:
        "Audits a receipt's line items and returns the item sum, the printed total, the difference, any item "
        + "name that appears more than once, and the amount plausibly overcharged from those duplicates. "
        + "Arithmetic on the values you pass only: it never estimates a fair price and cannot read an image.",
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
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
                name: { type: "string", minLength: 1, maxLength: 120, description: "The item name as printed." },
                qty: { type: "number", minimum: 0, maximum: 999, description: "Units on this line. Defaults to 1." },
                unit_price: { type: "number", minimum: -1000000, maximum: 1000000, description: "Price per unit if printed." },
                amount: { type: "number", minimum: -1000000, maximum: 1000000, description: "The line total as printed." },
              },
              required: ["name", "amount"],
              additionalProperties: false,
            },
          },
          printed_total: {
            type: "number",
            minimum: -1000000,
            maximum: 1000000,
            description: "The total printed on the receipt. Omit rather than computing one.",
          },
          currency: { type: "string", maxLength: 8, description: "Currency code, such as CNY." },
        },
        required: ["items"],
        additionalProperties: false,
      },
      execute(args) {
        const items = (args.items || []).map((it) => ({
          name: it.name,
          qty: it.qty == null ? 1 : it.qty,
          unit_price: it.unit_price == null ? null : it.unit_price,
          amount: it.amount,
        }));
        const result = auditReceipt({
          items,
          printed_total: args.printed_total == null ? null : args.printed_total,
          currency: args.currency || "CNY",
        });
        if (result.ok === false) {
          return { ok: false, reason: result.reason };
        }
        return {
          ok: true,
          currency: result.currency,
          line_count: result.line_count,
          item_sum: money(result.item_sum),
          printed_total: result.printed_total == null ? null : money(result.printed_total),
          total_delta: result.total_delta == null ? null : money(result.total_delta),
          duplicates: result.duplicates.map((d) => ({ name: d.name, count: d.count, excess: money(d.excess) })),
          suspect_overcharge: money(result.suspect_overcharge),
          findings: result.findings.map((f) => f.text),
          limits: result.limits,
        };
      },
    };
  }
}

// The bridge calls the module's registerActions export.
export const registerActions = BridgeActions.registerActions;
