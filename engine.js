// The phone's copy of the Mac's reader and commission engine, so the phone can read the sheet by itself.
// It mirrors truth/rules_parse.py, truth/commission.py and the month figures of truth/build_state.py line by line.
// tests/test_phone_engine.py runs both on the same input and requires identical output; and the page checks at run
// time that this code reproduces the Mac's own month figures before it trusts itself with live rows.
"use strict";
const Engine = (() => {
  // ---------------------------------------------------------------- helpers
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const strip = (s, chars) => {
    let a = 0, b = s.length;
    while (a < b && chars.includes(s[a])) a++;
    while (b > a && chars.includes(s[b - 1])) b--;
    return s.slice(a, b);
  };
  const words = s => s.split(/\s+/).filter(Boolean).join(" ");
  const replaceAll = (s, what, by) => s.split(what).join(by);

  // ---------------------------------------------------------------- reader (truth/rules_parse.py)
  const COMPANIES = ["הראל", "מנורה", "הפניקס", "מגדל", "כלל", "איילון", "הכשרה", "מיטב", "מור", "אנליסט", "אלטשולר שחם", "אלטשולר",
    "אינפיניטי", "ילין לפידות", "הלמן אלדובי", "ישיר", "שלמה", "ליברה", "AIG", "ווישור", "פסגות", "אקסלנס", "שומרה", "ביטוח חקלאי"];
  const BY_LENGTH = COMPANIES.map(esc).map((c, i) => [c, i]).sort((x, y) => y[0].length - x[0].length || x[1] - y[1]).map(x => x[0]);
  const COMPANY = new RegExp("(?<![א-ת])(מ|ל|ב|ה|ו|של |בחברת |לחברת |מחברת )?(" + BY_LENGTH.join("|") + ")(?![א-ת])", "g");
  const PRODUCTS = [
    ["גמל להשקעה", "גמל להשקעה|גמלש|קופג להשקעה|קופ.?ג להשקעה"],
    ["השתלמות", "השתלמות|השלתמות|קה״ש|קהש"],
    ["גמל", "(?<![א-ת])גמל|קופת גמל|קופג"],
    ["פנסיה", "פנסיה|פנסיית"],
    ["אובדן כושר עבודה", "אובדן כושר|אכ״ע|אכע"],
    ["סיעוד", "סיעוד"],
    ["תאונות אישיות", "תאונות"],
    ["בריאות + מחלות", "בריאות\\s*(?:ו|\\+\\s*|מלא ו|בסיס ו?|ו?בסיס )?\\s*מחלות|מחלות\\s*ו\\s*בריאות|בסיס\\s*ו?\\s*מחלות"],
    ["מחלות קשות", "מחלות|סרטן"],
    ["בריאות", "בריאות|(?<![א-ת])בסיס(?![א-ת])"],
    ["חיים", "חיים|ריסק|משכנתא"],
  ].map(([name, rx]) => [name, new RegExp(rx)]);
  const FINANCE = new Set(["גמל", "השתלמות", "גמל להשקעה"]);
  const NUM = "\\d[\\d,]*(?:\\.\\d+)?";
  const BIG = () => new RegExp("(" + NUM + ")\\s*(מיליון|מילון|m|M|אלף|א׳|א'|k|K)(?![א-תa-zA-Z])", "g");
  const PLAIN = () => new RegExp("(?<![\\d.,/])(" + NUM + ")(?![\\d/%])", "g");
  const IGNORE = () => new RegExp("(?:זוג|יחיד|בעל|אישה|אורי|הורים)\\s*\\+\\s*\\d+|ל?\\d+\\s*(?:ילדים|בנות|בנים|בגירים|נפשות)|הנחה\\s*\\d+\\s*%|\\d+\\s*%|מס(?:פר)?\\.? סוכן\\s*\\d+|מספר פוליסה\\s*\\d+|שוגר(?:ה)? דיגיטלית|לא שוגר|ללא ביטול(?:ים)?|"
    + "מצורף [^,.]*|הרשאה לחיוב[^,.]*|מצב(?: טופס)?|טופס הצטרפות|ש״ח|ש\"ח|₪", "g");
  const ignore = s => s.replace(IGNORE(), " ");

  const number = t => parseFloat(t.replace(/,/g, ""));
  const big = m => number(m[1]) * (["מיליון", "מילון", "m", "M"].includes(m[2]) ? 1000000 : 1000);
  const product = text => {
    for (const [name, rx] of PRODUCTS) { if (rx.test(text)) return name; }
    return null;
  };
  const companies = text => [...text.matchAll(COMPANY)].map(m => [m[1] || "", m[2], m.index]);
  const plain = text => [...text.matchAll(PLAIN())].map(m => number(m[1]));

  function clauses(text) {
    text = text.replace(/\([^)]*\)/g, " ");
    text = text.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
    text = text.replace(/בריאות\s*\+\s*מחלות(?: קשות)?/g, "בריאות ומחלות");
    const parts = text.split(/\s*[,;\n⏎]\s*|\s+\.\s*|\.\s+|\.$|\s+[-–—]{2,}\s+/);
    const out = [];
    for (const part of parts) {
      const pieces = part.split(/\s+\+\s+/);
      const merged = [pieces[0]];
      for (const piece of pieces.slice(1)) {
        const startsItem = (product(piece) && !/^\s*\d+\s*$/.test(piece)) || piece.includes("מינוי") || piece.includes("ניוד");
        if (product(merged[merged.length - 1]) && startsItem && /\d/.test(piece)) merged.push(piece);
        else merged[merged.length - 1] += " + " + piece;
      }
      out.push(...merged);
    }
    return out.filter(c => strip(c, " -–:.")).map(c => strip(c, " -–:"));
  }

  const newDeal = month => ({ person: null, action: "הצטרפות", product: null, company: null, from_company: null, premium: null,
    salary: null, deposit: null, amount: null, month: month, cancels: null, lien: null, note: null,
    sure: true, unsure: null, money_question: false });

  function parse(text, month = null) {
    const deals = [], why = [];
    let headerCompany = null, pending = null, sticky = null;
    const last = () => deals[deals.length - 1];
    for (const raw of clauses(text || "")) {
      let clause = raw;
      if (/^(?:חדש|חדשה)\s*:?\s*$/.test(clause) || /^חדש\s*:/.test(clause)) {
        sticky = null;
        clause = clause.replace(/^חדש\s*:?\s*/, "");
      }
      if (/^(?:ביטוחים\s*)?מינוי(?:י)? סוכן(?: ביטוח)?\s*:/.test(clause)) {
        sticky = "מינוי סוכן";
        clause = clause.replace(/^(?:ביטוחים\s*)?מינוי(?:י)? סוכן(?: ביטוח)?\s*:\s*/, "");
      }
      if (/^(?:פנסיוני|פיננסים|פיננסי)\s*:?\s*/.test(clause)) {
        sticky = null; headerCompany = null;
        clause = clause.replace(/^(?:פנסיוני|פיננסים|פיננסי)\s*:?\s*/, "");
      }
      if (!clause) continue;

      let cancels = null, remark = null;
      const cut = /(?<!ללא )(?<![א-ת])ו?ביטול(?:ים)?(?![א-ת])/.exec(clause);
      if (cut) {
        const after0 = clause.slice(cut.index + cut[0].length);
        const at = after0.indexOf(" - ");
        const tail = at < 0 ? after0 : after0.slice(0, at), after = at < 0 ? "" : after0.slice(at + 3);
        cancels = strip(words(ignore(tail)), " -–:.") || null;
        remark = strip(words(after.replace(/שוגר(?:ה)? דיגיטלית|לא שוגר/g, " ")), " -–:.") || null;
        clause = strip(clause.slice(0, cut.index), " -–:");
      }
      const moneyWord = "(?:פרמיה|הפקדה|צבירה|שכר)\\s*[-–:]?\\s*\\d|\\d\\s*(?:ש״ח\\s*)?(?:פרמיה|הפקדה|צבירה)";
      for (const dash of clause.matchAll(/\s[-–]\s/g)) {
        const head = ignore(clause.slice(0, dash.index)), tail = clause.slice(dash.index + dash[0].length);
        if (product(head) && new RegExp(moneyWord).test(head) && !new RegExp(moneyWord + "|מינוי|ניוד").test(tail)) {
          remark = remark || strip(words(tail), " -–:.") || null;
          clause = clause.slice(0, dash.index);
          break;
        }
      }
      let body = ignore(clause);
      const prod = product(body);
      const lien = /(?:שעבוד|משועבד)\s+(?:ל|בנק\s+)?([א-ת]+(?:\s+[א-ת]+)?)/.exec(body);
      if (lien) body = replaceAll(body, lien[0], " ");
      const found = companies(body);

      if (!prod) {
        if (body.includes("מינוי") && found.length && !/\d/.test(body)) {
          pending = { action: "מינוי סוכן", company: found[0][1] };
        } else if (cancels && deals.length && !last().cancels) {
          last().cancels = cancels;
        } else if (lien && deals.length && !last().lien && !/\d/.test(body)) {
          last().lien = lien[1];
        } else if (/\d/.test(body) && (found.length || body.includes("פרמיה")) && deals.length && last().premium === null &&
                   !(FINANCE.has(last().product) || last().product === "פנסיה")) {
          const numbers = plain(body.replace(BIG(), " "));
          if (numbers.length === 1) {
            last().premium = numbers[0];
            if (found.length && !last().company) last().company = found[0][1];
          } else why.push(raw);
        } else if (/\d/.test(body) || (found.length && !cancels)) {
          if (/^\s*[א-ת\s]*$/.test(body) && found.length === 1 && !deals.length &&
              new RegExp("^\\s*" + esc(found[0][1]) + "\\s*(?:חדש)?\\s*$").test(body)) headerCompany = found[0][1];
          else why.push(raw);
        }
        continue;
      }

      const deal = newDeal(month);
      deal.product = prod; deal.cancels = cancels; deal.note = remark;
      if (lien) deal.lien = lien[1];
      if (body.includes("מנהלים")) deal.note = "ביטוח מנהלים";
      const waiting = pending; pending = null;

      const isMoney = FINANCE.has(prod) || prod === "פנסיה";
      const moving = new RegExp("ניוד|הועבר|העברה|איחוד|(?<![א-ת])מ(?:" + COMPANIES.map(esc).join("|") + ")").test(body);
      if (body.includes("מינוי") || waiting || (sticky && !body.includes("ניוד"))) deal.action = "מינוי סוכן";
      else if (isMoney && moving) deal.action = "ניוד";

      if (deal.action === "ניוד") {
        const to = found.filter(c => ["ל", "לחברת"].includes(c[0].trim()));
        const frm = found.filter(c => ["מ", "מחברת"].includes(c[0].trim()));
        deal.company = to.length ? to[0][1] : null;
        deal.from_company = frm.length ? frm[0][1] : null;
        if (!to.length && found.length && !frm.length) deal.company = found[found.length - 1][1];
      } else if (found.length) {
        deal.company = found[0][1];
        if (new RegExp("^\\s*" + esc(found[0][1]) + "\\s*[-–]").test(body) && !deals.length) headerCompany = found[0][1];
      } else if (waiting) {
        deal.company = waiting.company;
      } else if (headerCompany && !isMoney) {
        deal.company = headerCompany;
      }

      const bigs = [...body.matchAll(BIG())].map(big);
      let rest = body.replace(BIG(), " ");
      const salary = new RegExp("שכר\\s*(" + NUM + ")").exec(rest);
      if (salary) {
        const value = number(salary[1]);
        deal.salary = value < 100 ? value * 1000 : value;
        rest = replaceAll(rest, salary[0], " ");
      }
      const deposit = new RegExp("הפקד(?:ה|ות)\\s*(?:של\\s*)?(" + NUM + ")|(" + NUM + ")\\s*הפקד(?:ה|ות)").exec(rest);
      if (deposit) {
        deal.deposit = number(deposit[1] || deposit[2]);
        rest = replaceAll(rest, deposit[0], " ");
      }
      const saved = new RegExp("צבירה\\s*(?:של\\s*)?(" + NUM + ")|(" + NUM + ")\\s*צבירה").exec(rest);
      if (saved) {
        bigs.push(number(saved[1] || saved[2]));
        rest = replaceAll(rest, saved[0], " ");
      }
      const plains = plain(rest);

      if (isMoney) {
        if (bigs.length) deal.amount = bigs[0];
        if (bigs.length > 1 || plains.length) {
          if (!bigs.length && plains.length === 1 && deal.deposit === null && deal.salary === null && prod !== "פנסיה") deal.amount = plains[0];
          else { deal.sure = false; deal.unsure = "יש בשורה מספרים שלא ברור למה הם שייכים"; }
        }
        if (deal.amount === null && deal.deposit === null && deal.salary === null) {
          deal.sure = false; deal.unsure = "לא כתוב סכום, הפקדה או שכר";
          deal.money_question = deal.action !== "מינוי סוכן";
        }
        if (!deal.company && deal.sure) { deal.sure = false; deal.unsure = "לא ברור לאיזו חברה"; }
      } else {
        const named = new RegExp("פרמיה\\s*[-–:]?\\s*(" + NUM + ")|(" + NUM + ")\\s*(?:ש״ח\\s*)?פרמיה").exec(rest);
        if (named) {
          deal.premium = number(named[1] || named[2]);
          let extra = plains.filter(n => n !== deal.premium);
          const plus = new RegExp("(" + NUM + ")\\s*\\+\\s*(" + NUM + ")").exec(rest);
          if (plus && [number(plus[1]), number(plus[2])].includes(deal.premium)) {
            deal.premium = number(plus[1]) + number(plus[2]);
            deal.note = plus[1] + " + " + plus[2];
            extra = extra.filter(n => n !== number(plus[1]) && n !== number(plus[2]));
          }
          if (extra.length) { deal.sure = false; deal.unsure = "יש בשורה מספר נוסף שלא ברור מה הוא"; }
        } else if (plains.length === 1) {
          deal.premium = plains[0];
        } else if (plains.length) {
          deal.sure = false; deal.unsure = "כמה מספרים, לא ברור מהי הפרמיה"; deal.money_question = true;
        } else {
          deal.sure = false; deal.unsure = "לא כתובה פרמיה";
          deal.money_question = deal.action === "הצטרפות";
        }
        if (!deal.company && deal.sure) { deal.sure = false; deal.unsure = "לא כתובה חברה"; }
      }
      let families = new Set(PRODUCTS.filter(([, rx]) => rx.test(body)).map(([name]) => name));
      if (prod === "בריאות + מחלות") { families.delete("בריאות"); families.delete("מחלות קשות"); }
      if (prod === "גמל להשקעה") families.delete("גמל");
      if (families.size > 1 && deal.sure) { deal.sure = false; deal.unsure = "שני מוצרים באותו פריט, לא ברור למי שייך הסכום"; }
      if (!deal.sure) why.push(raw);
      else if (isMoney) why.push(raw);
      deals.push(deal);
    }
    return { deals, confident: !why.length, why };
  }

  // ---------------------------------------------------------------- exact decimals (Python's Decimal, for money)
  const Dec = {
    of(x) {
      let s = String(x);
      if (/e/i.test(s)) s = Number(x).toFixed(20).replace(/0+$/, "");
      const neg = s.startsWith("-");
      if (neg) s = s.slice(1);
      const [i, f = ""] = s.split(".");
      const n = BigInt(i + f || "0");
      return { n: neg ? -n : n, s: f.length };
    },
    zero: { n: 0n, s: 0 },
    up(a, s) { return { n: a.n * 10n ** BigInt(s - a.s), s }; },
    add(a, b) { const s = Math.max(a.s, b.s); return { n: Dec.up(a, s).n + Dec.up(b, s).n, s }; },
    mul(a, b) { return { n: a.n * b.n, s: a.s + b.s }; },
    div1000(a) { return { n: a.n, s: a.s + 3 }; },
    num(a) { return Number(a.n) / 10 ** a.s; },
    money(a) {  // round half up to agorot, as commission.money
      if (a.s <= 2) return Dec.num(Dec.up(a, 2));
      const q = 10n ** BigInt(a.s - 2), neg = a.n < 0n, abs = neg ? -a.n : a.n;
      const r = (abs + q / 2n) / q;
      return Number(neg ? -r : r) / 100;
    },
  };

  // ---------------------------------------------------------------- commission (truth/commission.py)
  const INSURANCE = new Set(["חיים", "בריאות", "מחלות קשות", "בריאות + מחלות", "תאונות אישיות", "סיעוד", "אובדן כושר עבודה"]);
  const LABELS = { insurance_new: "ביטוח חדש", insurance_appointment: "מינוי ביטוח", pension: "פנסיה",
    pension_appointment: "מינוי פנסיה", managers_appointment: "מינוי ביטוח מנהלים",
    finance_raise: "גיוס גמל והשתלמות", finance_appointment: "מינוי פיננסים", undefined: "לא מוגדר" };

  function kindOf(deal) {
    const action = deal.action, prod = deal.product, note = deal.note || "";
    if (prod === "פנסיה") {
      if (action === "מינוי סוכן") return "pension_appointment";
      if (action === "ניוד" || action === "הצטרפות") return "pension";
      return "undefined";
    }
    if (note.includes("מנהלים") || (prod || "").includes("מנהלים")) return action === "מינוי סוכן" ? "managers_appointment" : "undefined";
    if (FINANCE.has(prod)) {
      if (action === "מינוי סוכן") return "finance_appointment";
      if (["ניוד", "הצטרפות", "הפקדה"].includes(action)) return "finance_raise";
      return "undefined";
    }
    const isInsurance = INSURANCE.has(prod) || deal.premium !== null && deal.premium !== undefined;
    if (isInsurance || ((prod === null || prod === undefined || prod === "אחר") && ["הצטרפות", "מינוי סוכן"].includes(action) &&
        (deal.amount === null || deal.amount === undefined))) {
      if (action === "הצטרפות") return "insurance_new";
      if (action === "מינוי סוכן") return "insurance_appointment";
    }
    return "undefined";
  }

  function compute(deal, rules) {
    const kind = kindOf(deal);
    const out = { kind, label: LABELS[kind], share: null, scope: null, trailing: null, estimated: false, assumed: null,
      missing: null, critical: false, production: {} };
    const D = x => (x === null || x === undefined) ? null : Dec.of(x);
    const premium = D(deal.premium), amount = D(deal.amount);
    let deposit = D(deal.deposit);
    const salary = D(deal.salary);
    let share = null;
    if (rules.agreement_70_active) share = Dec.of(rules.share_when_70_active);
    else { const s = rules.share_by_source[(deal.source || "").trim()]; share = s ? Dec.of(s) : null; }
    const rate = Dec.of(rules.trailing_rate);
    const stop = (why, critical = true) => { out.missing = why; out.critical = critical; return out; };

    if (kind === "pension_appointment") {
      out.scope = 0; out.trailing = 0;
      if (amount !== null) out.production.pension_appointment_accumulation = Dec.num(amount);
      return out;
    }
    if (kind === "managers_appointment") { out.scope = 0; out.trailing = 0; return out; }
    if (kind === "undefined") return stop("סוג העסקה לא מוגדר בהסדר העמלות", false);

    if (kind === "insurance_new") {
      if (premium === null) return stop("פרמיה לא ידועה");
      out.production.new_premium = Dec.num(premium);
    } else if (kind === "insurance_appointment") {
      if (premium === null) return stop("פרמיית המינוי לא ידועה");
      out.production.appointment_premium = Dec.num(premium);
    } else if (kind === "pension") {
      if (amount !== null) out.production.pension_accumulation = Dec.num(amount);
      if (deposit === null && salary === null) return stop("חסרים הפקדה או שכר בפנסיה");
      if (deposit === null) { deposit = Dec.mul(salary, Dec.of(rules.pension_deposit_from_salary)); out.estimated = true; }
      out.production.pension_deposit = Dec.num(deposit);
    } else if (kind === "finance_raise") {
      if (amount === null) {
        if (deposit !== null) return stop("הוראת קבע בלבד: לא נוצרת עמלה", false);
        return stop("סכום הגיוס לא ידוע");
      }
      out.production.finance_raised = Dec.num(amount);
    } else if (kind === "finance_appointment") {
      const company = deal.company || "";
      if (!company) out.assumed = "חברה לא ידועה: הונחה זכאות לנפרעים";
      if (company && rules.finance_appointment_no_trailing.some(x => company.includes(x))) { out.scope = 0; out.trailing = 0; return out; }
      if (amount === null) return stop("סכום המינוי לא ידוע");
    }
    if (share === null) return stop("מקור הליד לא ידוע: אי אפשר לקבוע את חלקי בעמלה");
    out.share = Dec.num(share);
    let scope, trailing;
    if (kind === "insurance_new") {
      scope = Dec.mul(Dec.mul(premium, Dec.of(rules.insurance_scope_multiplier)), share);
      trailing = Dec.mul(Dec.mul(premium, rate), share);
    } else if (kind === "insurance_appointment") {
      scope = Dec.zero; trailing = Dec.mul(Dec.mul(premium, rate), share);
    } else if (kind === "pension") {
      scope = Dec.mul(deposit, share); trailing = Dec.zero;
    } else if (kind === "finance_raise") {
      scope = Dec.mul(Dec.mul(Dec.div1000(amount), Dec.of(rules.finance_per_thousand_scope)), share);
      trailing = Dec.mul(Dec.mul(Dec.div1000(amount), rate), share);
    } else {
      scope = Dec.zero; trailing = Dec.mul(Dec.mul(Dec.div1000(amount), rate), share);
    }
    Object.defineProperty(out, "_scope", { value: scope, enumerable: false });
    Object.defineProperty(out, "_trailing", { value: trailing, enumerable: false });
    out.scope = Dec.money(scope); out.trailing = Dec.money(trailing);
    return out;
  }

  const STALE = () => ({ kind: "undefined", label: "לא מעודכן", share: null, scope: null, trailing: null, estimated: false,
    missing: "השורה השתנתה והפענוח נכשל", critical: true, production: {} });

  // ---------------------------------------------------------------- month figures (truth/build_state.py)
  const pyRound = x => {  // Python's round(): halves go to the even neighbour
    const f = Math.floor(x), d = x - f;
    return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
  };
  const round2 = x => Number(x.toFixed(2));
  const monthKey = m => { const [mm, yy] = m.split("/"); return [Number(yy), Number(mm)]; };
  const PROD = ["new_premium", "appointment_premium", "finance_raised", "pension_deposit", "pension_accumulation", "pension_appointment_accumulation"];

  function months(rows, clients, rules, today) {
    const results = new Map(rows.map(r => [r.id, r.stale ? STALE() : compute(r, rules)]));
    const byMonth = new Map();
    for (const r of rows) {
      if (!r.month || !r.month.includes("/") || r.test) continue;
      if (!byMonth.has(r.month)) byMonth.set(r.month, { joins: 0, appointments: 0, transfers: 0, other: 0, premium: 0, unsure: 0, clients: new Set() });
      const m = byMonth.get(r.month);
      const kind = { "הצטרפות": "joins", "מינוי סוכן": "appointments", "ניוד": "transfers" }[r.action] || "other";
      m[kind] += 1;
      m.clients.add(r.clientId);
      if (kind === "joins" && r.premium !== null && r.premium !== undefined) m.premium += r.premium;
      if (!r.sure) m.unsure += 1;
    }
    const list = [...byMonth.entries()].sort((a, b) => { const x = monthKey(a[0]), y = monthKey(b[0]); return x[0] - y[0] || x[1] - y[1]; })
      .map(([month, v]) => ({ month, joins: v.joins, appointments: v.appointments, transfers: v.transfers, other: v.other,
        premium: v.premium, unsure: v.unsure, clients: v.clients.size }));
    let running = 0;
    list.forEach((m, i) => {
      running += m.premium;
      m.cumulative = running;
      const prev = i ? list[i - 1].premium : 0;
      m.partial = m.month === today;
      m.deltaPct = prev && !m.partial ? pyRound((m.premium - prev) / prev * 100) : null;
    });
    let book = Dec.zero, cumulative = Dec.zero;
    for (const m of list) {
      const res = rows.filter(r => r.month === m.month && !r.test).map(r => results.get(r.id));
      const scope = res.reduce((t, x) => Dec.add(t, x._scope || Dec.zero), Dec.zero);
      const fresh = res.reduce((t, x) => Dec.add(t, x._trailing || Dec.zero), Dec.zero);
      book = Dec.add(book, fresh);
      cumulative = Dec.add(cumulative, book);
      const production = {};
      for (const k of PROD) production[k] = round2(res.reduce((t, x) => t + (x.production[k] || 0), 0));
      m.commission = { scope: Dec.money(scope), trailingNew: Dec.money(fresh), trailingMonthly: Dec.money(book),
        trailingCumulative: Dec.money(cumulative), production,
        computed: res.filter(x => x.scope !== null).length, estimated: res.filter(x => x.estimated).length,
        questions: res.filter(x => x.critical).length };
    }
    let best = null;
    for (const m of list) if (!best || m.premium > best.premium) best = m;
    const insights = { bestMonth: best ? best.month : null, bestPremium: best ? best.premium : 0, totalPremium: running,
      totalJoins: list.reduce((t, m) => t + m.joins, 0), totalClients: clients.filter(c => !c.test).length };
    return { months: list, insights, results };
  }

  // ---------------------------------------------------------------- the live sheet
  // Row identity shared with truth/phone.py: FNV-1a over UTF-16 code units, two seeds.
  function fnv(s) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x01000193) >>> 0;
    }
    return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
  }
  const cell = c => String(c === null || c === undefined ? "" : c).trim();
  const WAITING = "נקרא בלי AI. לבדוק שהמוצרים והסכומים נכונים ושלא חסר מוצר";
  const COMMISSION = ["label", "kind", "scope", "trailing", "estimated", "assumed", "missing", "critical"];

  // Brings the Mac's snapshot up to date with the sheet as it is now. Rows the Mac already read stay exactly as the
  // Mac read them; a new or edited row is read here, and marked for checking unless the reader is sure of it.
  function applyLive(state, values, today) {
    const known = state.sheet || {};
    const live = [];
    values.forEach((r, i) => {
      const v = [...r].slice(0, 8).map(cell);
      while (v.length < 8) v.push("");
      if (!(v[1] || v[7])) return;
      live.push({ row: i + 1, tz: v[0], name: v[1], followup: v[3], month: v[4], source: v[6], text: v[7] });
    });
    const count = Object.keys(known).length;
    if (count && live.length < count / 2) return { state, error: "הגיליון חזר כמעט ריק" };
    const seen = new Set(), changed = [];
    for (const rec of live) {
      const key = fnv(rec.tz + "|" + rec.name + "|" + rec.month);
      seen.add(key);
      const old = known[key];
      if (old && old.h === fnv(rec.text + "\u0001" + rec.source)) continue;
      changed.push({ rec, key, old });
    }
    const gone = Object.entries(known).filter(([k]) => !seen.has(k)).map(([, v]) => v.id);
    if (!changed.length && !gone.length) return { state, changed: 0, removed: 0 };
    const drop = new Set([...gone, ...changed.filter(c => c.old).map(c => c.old.id)]);
    const tests = new Set(state.rules.test_clients || []);
    const rows = state.rows.filter(r => !drop.has(r.clientId));
    const clients = state.clients.filter(c => !drop.has(c.id) || changed.some(x => x.old && x.old.id === c.id));
    for (const { rec, key, old } of changed) {
      const id = old ? old.id : "live-" + key;
      const read = parse(rec.text, rec.month);
      const deals = read.confident && !(old && old.ans) ? read.deals
        : read.deals.map(d => Object.assign({}, d, { sure: false, unsure: d.unsure || WAITING }));
      const isTest = tests.has(rec.name);
      deals.forEach((d, i) => {
        let month = d.month || rec.month;
        if (!month || !month.includes("/")) month = rec.month;
        const row = { id: id + "-l" + i, clientId: id, client: rec.name, person: d.person, action: d.action || "אחר", product: d.product,
          company: d.company, fromCompany: d.from_company, premium: d.premium, amount: d.amount, deposit: d.deposit, salary: d.salary,
          month, source: rec.source, cancels: d.cancels, lien: d.lien, note: d.note, sure: d.sure !== false, unsure: d.unsure,
          stale: false, test: isTest };
        const res = compute(row, state.rules);
        row.commission = Object.fromEntries(COMMISSION.map(k => [k, res[k] === undefined ? null : res[k]]));
        rows.push(row);
      });
      const before = clients.findIndex(c => c.id === id);
      const client = Object.assign(before >= 0 ? clients[before] : { hasFolder: false, folderRel: null, pdfCount: 0, tzConflict: false, sheetPending: false },
        { id, name: rec.name, month: rec.month, source: rec.source, followup: rec.followup || null, deals: deals.length, stale: false, test: isTest, audit: [] });
      if (before < 0) clients.push(client);
    }
    const figures = months(rows, clients, state.rules, today);
    return { state: Object.assign({}, state, { rows, clients, months: figures.months, insights: figures.insights }),
      changed: changed.length, removed: gone.length };
  }

  // Before trusting itself with live rows, the page checks that this code reproduces the Mac's own figures.
  function agrees(state, today) {
    const mine = months(state.rows, state.clients, state.rules, today);
    const strip2 = ms => JSON.stringify(ms.map(m => Object.assign({}, m, { partial: undefined, deltaPct: undefined })));
    return strip2(mine.months) === strip2(state.months) && JSON.stringify(mine.insights) === JSON.stringify(state.insights);
  }

  return { parse, compute, months, applyLive, agrees, fnv, Dec };
})();
if (typeof module !== "undefined") module.exports = Engine;
