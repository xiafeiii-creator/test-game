import { json, bad, method, readJson, verifyTelegramInitData, supabaseFetch } from "./_lib.js";

const CROPS = {
  lettuce: { id: "lettuce", growSec: 120, seedPrice: 5, reward: 10, xp: 3 },
  corn:    { id: "corn",    growSec: 600, seedPrice: 25, reward: 60, xp: 10 },
  tomato:  { id: "tomato",  growSec: 3600, seedPrice: 150, reward: 400, xp: 40 },
};

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function ensureShape(s) {
  if (!s || typeof s !== "object") throw new Error("Bad save");
  if (!s.inv) s.inv = { lettuce:0, corn:0, tomato:0 };
  for (const k of Object.keys(CROPS)) if (typeof s.inv[k] !== "number") s.inv[k] = 0;
  if (!Array.isArray(s.plots)) s.plots = [];
  if (!s.plotCount) s.plotCount = s.plots.length || 2;
  if (s.plots.length < s.plotCount) {
    for (let i = s.plots.length; i < s.plotCount; i++) s.plots.push({ slot:i, status:"empty", cropId:null, plantedAt:null, growSec:null, reward:null, xp:null });
  }
  if (s.plots.length > s.plotCount) s.plots = s.plots.slice(0, s.plotCount);
  if (typeof s.coins !== "number") s.coins = 0;
  if (typeof s.level !== "number") s.level = 1;
  if (typeof s.xp !== "number") s.xp = 0;
  if (typeof s.totalHarvests !== "number") s.totalHarvests = 0;
  if (typeof s.totalEarned !== "number") s.totalEarned = 0;
  return s;
}

function levelUpIfNeeded(s){
  while(s.xp >= 20 * s.level){
    s.xp -= 20 * s.level;
    s.level += 1;
  }
}

export default async function handler(req, res) {
  if (!method(res, req, ["POST"])) return;
  const body = await readJson(req);

  const v = verifyTelegramInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!v.ok) return bad(res, v.error);
  const userId = v.user.id;

  const action = body.action; // "plant" | "harvest" | "buySeed" | "buyPlot"
  if (!action) return bad(res, "Missing action");

  // Load save
  const q = await supabaseFetch(`farm_saves?user_id=eq.${userId}&select=*`, { method: "GET" });
  let save = (q.ok && Array.isArray(q.data) && q.data.length) ? q.data[0].data : null;
  if (!save) return bad(res, "No save found. Call /api/me first.");

  try { save = ensureShape(save); } catch(e){ return bad(res, e.message); }

  const nowMs = Date.now();

  if (action === "buySeed") {
    const cropId = body.cropId;
    const c = CROPS[cropId];
    if (!c) return bad(res, "Bad cropId");
    if (save.coins < c.seedPrice) return json(res, 200, { ok:false, error:"Not enough coins" });

    save.coins -= c.seedPrice;
    save.inv[cropId] += 1;
  }

  else if (action === "buyPlot") {
    const MAX_PLOTS = 8;
    if (save.plotCount >= MAX_PLOTS) return json(res, 200, { ok:false, error:"Max plots" });

    const n = save.plotCount - 2;
    const cost = Math.floor(200 + (n*n)*120 + n*180);
    if (save.coins < cost) return json(res, 200, { ok:false, error:"Not enough coins" });

    save.coins -= cost;
    save.plotCount += 1;
    save.plots.push({ slot: save.plotCount-1, status:"empty", cropId:null, plantedAt:null, growSec:null, reward:null, xp:null });
  }

  else if (action === "plant") {
    const slot = clamp(Number(body.slot), 0, save.plotCount-1);
    const cropId = body.cropId;
    const c = CROPS[cropId];
    if (!c) return bad(res, "Bad cropId");

    const p = save.plots[slot];
    if (!p || p.status !== "empty") return json(res, 200, { ok:false, error:"Plot busy" });

    if ((save.inv[cropId] || 0) <= 0) return json(res, 200, { ok:false, error:"No seed in inventory" });

    // use seed
    save.inv[cropId] -= 1;

    // plant with SERVER time
    p.status = "growing";
    p.cropId = cropId;
    p.plantedAt = nowMs;
    p.growSec = c.growSec;
    p.reward = c.reward;
    p.xp = c.xp;
  }

  else if (action === "harvest") {
    const slot = clamp(Number(body.slot), 0, save.plotCount-1);
    const p = save.plots[slot];
    if (!p || p.status !== "growing") return json(res, 200, { ok:false, error:"Nothing to harvest" });

    const end = (p.plantedAt || 0) + (p.growSec || 0) * 1000;
    if (nowMs < end) return json(res, 200, { ok:false, error:"Not ready yet", remainMs: end - nowMs });

    // reward
    save.totalHarvests += 1;
    save.xp += (p.xp || 0);
    const reward = Number(p.reward || 0);
    save.coins += reward;
    save.totalEarned += reward;

    // clear plot
    save.plots[slot] = { slot, status:"empty", cropId:null, plantedAt:null, growSec:null, reward:null, xp:null };

    // small passive xp
    save.xp += Math.floor(reward / 20);
    levelUpIfNeeded(save);
  }

  else {
    return bad(res, "Unknown action");
  }

  // Save back
  const upd = await supabaseFetch(`farm_saves?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ data: save, updated_at: new Date().toISOString() }),
  });

  if (!upd.ok) return json(res, 500, { ok:false, error:"DB update failed", detail: upd.data });

  return json(res, 200, { ok:true, data: save });
}
