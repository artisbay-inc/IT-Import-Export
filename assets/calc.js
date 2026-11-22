// Clearing-cost calculator maths, shared by /calculator and the admin preview.
//
// Each charge is one of:
//   percent_value   - rate % of the car's value             (e.g. customs duty 25%)
//   percent_running - rate % of value + the charges above it (e.g. VAT 15% on value + duty)
//   fixed           - a set amount                           (e.g. agency fee N$ 3,500)
// All amounts are whole cents, so totals never drift.
window.ITIE_CALC = {
  compute(valueCents, lines) {
    let charges = 0;
    const rows = lines.map((l) => {
      let cents = 0;
      if (l.kind === "fixed") cents = Math.round(Number(l.amount_cents) || 0);
      else if (l.kind === "percent_value") cents = Math.round(valueCents * (Number(l.rate) || 0) / 100);
      else if (l.kind === "percent_running") cents = Math.round((valueCents + charges) * (Number(l.rate) || 0) / 100);
      charges += cents;
      return { label: l.label, kind: l.kind, rate: Number(l.rate) || 0, cents };
    });
    return { rows, charges, total: valueCents + charges };
  },

  // "18,250.50" -> 1825050 cents, or null
  cents(text) {
    const clean = String(text ?? "").replace(/[,\s]/g, "");
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(clean)) return null;
    return Math.round(parseFloat(clean) * 100);
  },

  money(cents, currency) {
    return `${currency} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  describe(row, currency) {
    if (row.kind === "fixed") return "fixed amount";
    if (row.kind === "percent_value") return `${row.rate}% of the car's value`;
    return `${row.rate}% of the value plus the charges above`;
  },
};
