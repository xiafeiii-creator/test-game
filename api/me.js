import { json, bad, method, readJson, verifyTelegramInitData, supabaseFetch } from "./_lib.js";

function defaultSave() {
  return {
    coins: 50,
    level: 1,
    xp: 0,
    totalHarvests: 0,
    totalEarned: 0,
    plotCount: 2,
    inv: { lettuce: 0, corn: 0, tomato: 0 },
    plots: Array.from({ length: 2 }, (_, i) => ({
      slot: i,
      status: "empty",
      cropId: null,
      plantedAt: null,
      growSec: null,
      reward: null,
      xp: null,
    })),
  };
}

export default async function handler(req, res) {
  if (!method(res, req, ["POST"])) return;

  const body = await readJson(req);
  const initData = body.initData;
  const v = verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!v.ok) return bad(res, v.error);

  const userId = v.user.id;

  // read from supabase
  const q = await supabaseFetch(`farm_saves?user_id=eq.${userId}&select=*`, { method: "GET" });
  if (q.ok && Array.isArray(q.data) && q.data.length) {
    return json(res, 200, { ok: true, userId, data: q.data[0].data });
  }

  // create new
  const fresh = defaultSave();
  const ins = await supabaseFetch(`farm_saves`, {
    method: "POST",
    body: JSON.stringify([{ user_id: userId, data: fresh }]),
  });

  if (!ins.ok) return json(res, 500, { ok: false, error: "DB insert failed", detail: ins.data });

  return json(res, 200, { ok: true, userId, data: fresh });
}
