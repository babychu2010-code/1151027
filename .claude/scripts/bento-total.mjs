#!/usr/bin/env node
// 便當訂單算錢（order-bento 技能用）：小計、運費、小額費、折扣、總計、每個人該付多少，全由這支算，不靠 Claude 心算。
// 用法：node .claude/scripts/bento-total.mjs <訂單.json>        （也可以從 stdin 餵：... | node .claude/scripts/bento-total.mjs -）
// 訂單格式（金額都是新台幣整數）：
// {
//   "shop": "阿嬤的雞腿便當",
//   "menu": { "雞腿便當": 120, "排骨便當": 100, "加蛋": 15 },
//   "items": [ { "who": "小美", "name": "雞腿便當", "qty": 1, "addons": ["加蛋"], "note": "飯少" } ],
//   "delivery_fee": 39,                         // 運費（選填，預設 0）
//   "min_order": 200, "small_order_fee": 20,     // 未滿 min_order 收小額費（選填）
//   "free_delivery_over": 500,                   // 滿額免運（選填）
//   "discount": { "type": "amount", "value": 50 } // 或 { "type": "percent", "value": 10 }，只打在餐點小計上（選填）
// }
// 運費、小額費、折扣依每人餐點金額比例分攤，四捨五入後的零頭由金額最大的人吸收，加總一定等於總計。
// 結束碼：0＝算好了、1＝訂單有問題（看「卡在」那行）。
import { readFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) { console.log('卡在：缺訂單檔。用法：node .claude/scripts/bento-total.mjs <訂單.json>'); process.exit(1); }
let order;
try { order = JSON.parse(readFileSync(src === '-' ? 0 : src, 'utf8')); } catch (e) {
  console.log(`卡在：訂單檔讀不懂（${String(e.message || e).slice(0, 80)}）。`); process.exit(1);
}

const menu = order.menu || {};
const problems = [];
const money = (n) => `$${n.toLocaleString('en-US')}`;
const isPrice = (n) => Number.isInteger(n) && n >= 0;

const perPerson = new Map();
const lines = [];
for (const [i, it] of (order.items || []).entries()) {
  const who = String(it.who || '我').trim();
  const qty = it.qty ?? 1;
  if (!Number.isInteger(qty) || qty < 1) { problems.push(`第 ${i + 1} 項「${it.name}」數量 ${qty} 不對`); continue; }
  const parts = [it.name, ...(it.addons || [])];
  const missing = parts.filter((p) => !isPrice(menu[p]));
  if (missing.length) { problems.push(`菜單上找不到價格：${missing.join('、')}`); continue; }
  const unit = parts.reduce((s, p) => s + menu[p], 0);
  const amount = unit * qty;
  lines.push({ who, label: [it.name, ...(it.addons || []).map((a) => `+${a}`)].join(' '), qty, unit, amount, note: it.note });
  perPerson.set(who, (perPerson.get(who) || 0) + amount);
}
if (!lines.length && !problems.length) problems.push('訂單裡沒有任何品項');
if (problems.length) { for (const p of problems) console.log('卡在：' + p); process.exit(1); }

const subtotal = lines.reduce((s, l) => s + l.amount, 0);
let discount = 0;
const d = order.discount;
if (d && d.type === 'amount') discount = Math.min(subtotal, Math.round(d.value));
else if (d && d.type === 'percent') discount = Math.round((subtotal * d.value) / 100);
let delivery = order.delivery_fee || 0;
if (order.free_delivery_over && subtotal >= order.free_delivery_over) delivery = 0;
const smallFee = order.min_order && subtotal < order.min_order ? (order.small_order_fee || 0) : 0;
const total = subtotal - discount + delivery + smallFee;

// 每人分攤：餐點金額 + 依比例分到的（運費＋小額費−折扣）
const shared = delivery + smallFee - discount;
const people = [...perPerson.entries()].map(([who, food]) => ({ who, food, pay: food + Math.round((shared * food) / subtotal) }));
const diff = total - people.reduce((s, p) => s + p.pay, 0);
if (diff) people.reduce((a, b) => (b.food > a.food ? b : a)).pay += diff;

console.log(`店家：${order.shop || '（沒寫）'}`);
console.log('明細：');
for (const l of lines) console.log(`  ${l.who}｜${l.label} × ${l.qty}（單價 ${money(l.unit)}）＝ ${money(l.amount)}${l.note ? `｜備註：${l.note}` : ''}`);
console.log(`餐點小計：${money(subtotal)}`);
if (discount) console.log(`折扣：−${money(discount)}`);
console.log(`運費：${money(delivery)}${order.free_delivery_over && subtotal >= order.free_delivery_over ? `（滿 ${money(order.free_delivery_over)} 免運）` : ''}`);
if (smallFee) console.log(`小額費：${money(smallFee)}（未滿 ${money(order.min_order)}，再點 ${money(order.min_order - subtotal)} 就免）`);
console.log(`總計：${money(total)}`);
if (people.length > 1) {
  console.log('每人應付（運費／折扣按比例分攤）：');
  for (const p of people) console.log(`  ${p.who}：${money(p.pay)}`);
}
