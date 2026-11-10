(function (root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.StocklyBusinessRules = rules;
})(globalThis, function () {
  const zone = 'Asia/Karachi';
  const formatters = new Map();
  const limit = BigInt(Number.MAX_SAFE_INTEGER);

  function safeMinor(value) {
    if (value > limit || value < -limit) throw new RangeError('Amount exceeds the safe range');
    return Number(value);
  }

  function parseMinorUnits(value, { signed = false } = {}) {
    if (!['string', 'number'].includes(typeof value)) throw new Error('Invalid amount');
    const text = String(value).trim();
    if (!(signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(text) || text.length > 32) {
      throw new Error('Invalid amount: use at most two decimal places');
    }
    const negative = text.startsWith('-');
    const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
    const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return safeMinor(negative ? -amount : amount);
  }

  function sumMoney(values) {
    return safeMinor(values.reduce((sum, value) => sum + BigInt(parseMinorUnits(value ?? 0, { signed: true })), 0n)) / 100;
  }

  function sumSaleEvents(events) {
    let revenue = 0n, cost = 0n, profit = 0n, units = 0n;
    for (const event of events) {
      if (![event.salePriceMinor, event.buyPriceMinor, event.profitMinor, event.units ?? 1].every(Number.isSafeInteger)) throw new Error('Invalid sale amount');
      revenue += BigInt(event.salePriceMinor);
      cost += BigInt(event.buyPriceMinor);
      profit += BigInt(event.profitMinor);
      units += BigInt(event.units ?? 1);
    }
    const revenueMinor = safeMinor(revenue), costMinor = safeMinor(cost), profitMinor = safeMinor(profit);
    return { revenue: revenueMinor / 100, cost: costMinor / 100, profit: profitMinor / 100,
      revenueMinor, costMinor, profitMinor, units: safeMinor(units) };
  }

  function dayRowCost(row, extra) {
    if (extra) return parseMinorUnits(row.boughtFor ?? 0, { signed: true }) / 100;
    if (row.soldCost !== undefined) return parseMinorUnits(row.soldCost, { signed: true }) / 100;
    const quantity = row.out ?? 0;
    if (!Number.isSafeInteger(quantity)) throw new Error('Invalid stock quantity');
    return safeMinor(BigInt(parseMinorUnits(row.costPerUnit ?? 0)) * BigInt(quantity)) / 100;
  }

  function sumDayRows(cats, config) {
    const rows = Object.entries(cats || {}).flatMap(([cat, value]) =>
      (value.rows || []).map(row => ({ row, extra: !!config[cat]?.isExtra })));
    const revenue = sumMoney(rows.map(({ row }) => row.soldFor || 0));
    const cost = sumMoney(rows.map(({ row, extra }) => dayRowCost(row, extra)));
    const units = safeMinor(rows.reduce((sum, { row, extra }) => {
      const count = extra ? row.unitsDelta || 0 : row.out || 0;
      if (!Number.isSafeInteger(count)) throw new Error('Invalid stock quantity');
      return sum + BigInt(count);
    }, 0n));
    return { revenue, cost, profit: sumMoney([revenue, -cost]), units };
  }

  function parts(instant, timeZone) {
    if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
    return Object.fromEntries(formatters.get(timeZone).formatToParts(new Date(instant)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  }

  function businessDate(instant = new Date(), timeZone = zone) {
    const value = parts(instant, timeZone);
    return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
  }

  function midnight(date, timeZone) {
    const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    let guess = target;
    for (let attempt = 0; attempt < 5; attempt++) {
      const p = parts(guess, timeZone);
      const delta = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      if (!delta) return new Date(guess).toISOString();
      guess += delta;
    }
    throw new RangeError('The selected business date does not have a valid midnight');
  }

  function periodBounds(period, type, timeZone = zone) {
    const pattern = type === 'daily' ? /^(\d{4})-(\d{2})-(\d{2})$/ : type === 'monthly' ? /^(\d{4})-(\d{2})$/ : null;
    const match = typeof period === 'string' && pattern ? period.match(pattern) : null;
    if (!match) throw new RangeError('Invalid reporting period');
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3] || 1);
    const start = new Date(Date.UTC(year, month - 1, day));
    if (year < 1000 || year > 9998 || start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) throw new RangeError('Invalid reporting period');
    const end = new Date(start);
    if (type === 'daily') end.setUTCDate(day + 1);
    else end.setUTCMonth(month);
    return { start: midnight(start, timeZone), end: midnight(end, timeZone) };
  }

  return { parseMinorUnits, sumMoney, sumSaleEvents, dayRowCost, sumDayRows, businessDate, periodBounds };
});
