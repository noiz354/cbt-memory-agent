/**
 * Seed Monetization + Analytics (FASE 4 + FASE 1-3) — dummy data demo.
 *
 * Mengisi ~6 bulan data deterministik:
 *   - marketing_ad_spend  : Google / Meta / TikTok / Organic (harian)
 *   - subscriptions       : langganan naik bulan demi bulan + churn + upgrade
 *   - user_events         : funnel checkout/payment (FASE 4) + telemetry
 *                           aktivasi (FASE 1-3: signup/onboarding/chat/finalize)
 *                           + aktivitas bulanan per cohort (retensi)
 *   - users               : ~45 akun dummy (id = md5(email)::uuid),
 *                           created_at di-backdate ke bulan join (anchor cohort)
 *
 * Run:  npx tsx scripts/seed-monetization.ts
 * Env : CRDB_CONNECTION_URL (dari .env)
 *
 * CATATAN:
 *   - Script DEV/mock → wipe tabel monetisasi + hapus akun seed-* (CASCADE)
 *     supaya idempoten saat dijalankan ulang. Tidak menyentuh users non-seed.
 *   - Jangan dipakai di produksi.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const lambdaRequire = createRequire(new URL("../lambda/package.json", import.meta.url));
const { Pool } = lambdaRequire("pg") as typeof import("pg");

interface ParsedEnv {
  [key: string]: string;
}

function loadEnv(): ParsedEnv {
  const env: ParsedEnv = {};
  const root = join(__dirname, "..");
  for (const file of [join(root, ".env"), join(root, ".env.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
  return { ...process.env, ...env };
}

/** PRNG deterministik supaya seed bisa direproduksi. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function md5Uuid(input: string): string {
  const hash = createHash("md5").update(input).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function toDateStr(iso: string): string {
  return iso.slice(0, 10);
}

function usd(n: number): string {
  return n.toFixed(2);
}

function minutesFrom(baseIso: string, minutes: number): string {
  return new Date(new Date(baseIso).getTime() + minutes * 60_000).toISOString();
}

const CHANNELS = ["google", "meta", "tiktok", "organic"];
const PLANS = [
  { planId: "starter", monthly: 19 },
  { planId: "pro", monthly: 49 },
  { planId: "team", monthly: 99 },
];

async function main(): Promise<void> {
  const env = loadEnv();
  const conn = env.CRDB_CONNECTION_URL ?? "";
  if (!conn) {
    console.error("❌ CRDB_CONNECTION_URL tidak diset di .env");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  const rand = mulberry32(0x0c0ffee);
  const now = new Date();

  const JOIN_WEIGHTS = [3, 4, 5, 6, 7, 8]; // Mar..Aug 2026 — cohort awal lebih besar
  const RETENTION_CURVE = [1, 0.8, 0.65, 0.5, 0.4, 0.32]; // retensi per bulan setelah join

  // ── 1) Wipe tabel (idempotent dev seed) ────────────────────────────────────
  for (const table of ["user_events", "subscriptions", "marketing_ad_spend"]) {
    await pool.query(`DELETE FROM ${table}`);
  }
  // Hapus akun seed (CASCADE membersihkan event + subscription terkait).
  await pool.query(`DELETE FROM users WHERE email LIKE 'seed-%@example.com'`);

  // ── 2) Users dummy (~45) — created_at di-backdate ke bulan join ───────────
  // created_at = anchor cohort retention (getRetention memakai bulan created_at).
  const userEmails: string[] = [];
  for (let i = 0; i < 45; i++) {
    userEmails.push(`seed-user-${String(i + 1).padStart(2, "0")}@example.com`);
  }
  const totalWeight = JOIN_WEIGHTS.reduce((a, b) => a + b, 0);
  const userRows: { id: string; email: string; joinIso: string; lastActive: string }[] = [];
  for (const email of userEmails) {
    const r = rand() * totalWeight;
    let acc = 0;
    let joinMonthIdx = 0;
    for (let j = 0; j < JOIN_WEIGHTS.length; j++) {
      acc += JOIN_WEIGHTS[j];
      if (r < acc) {
        joinMonthIdx = j;
        break;
      }
    }
    const joinDate = new Date(Date.UTC(2026, 2 + joinMonthIdx, 1 + Math.floor(rand() * 26)));
    const joinIso = joinDate.toISOString();
    userRows.push({ id: md5Uuid(email), email, joinIso, lastActive: joinIso });
  }
  for (const u of userRows) {
    await pool.query(
      `INSERT INTO users (id, email, display_name, auth_method, created_at)
       VALUES ($1, $2, $3, 'passkey', $4::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.email, u.email.split("@")[0], u.joinIso],
    );
  }

  let evCount = 0;

  // Helper insert event (dipakai untuk telemetry/funnel/aktivitas FASE 1-3).
  const insertEvent = async (
    userId: string,
    name: string,
    props: Record<string, unknown> | null,
    at: string,
    suffix: string | number,
  ): Promise<void> => {
    await pool.query(
      `INSERT INTO user_events (user_id, event_name, event_properties, session_id, device_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, name, props ? JSON.stringify(props) : null, `seed-${suffix}`, `device-${suffix}`, at],
    );
    evCount++;
  };

  // ── 3) marketing_ad_spend (6 bulan, harian per channel) ───────────────────
  const months: Date[] = [];
  for (let m = 2; m <= 7; m++) {
    months.push(new Date(Date.UTC(2026, m, 1)));
  }
  const adSpend = new Map<string, number>(); // "YYYY-MM" → total
  const today = toDateStr(now.toISOString());
  for (const month of months) {
    const days = new Date(month.getUTCFullYear(), month.getUTCMonth() + 1, 0).getDate();
    const key = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
    let monthTotal = 0;
    for (let day = 1; day <= days; day++) {
      const d = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day));
      const dateStr = toDateStr(d.toISOString());
      if (dateStr > today) continue;
      for (const channel of CHANNELS) {
        const base = channel === "google" ? 24 : channel === "meta" ? 18 : channel === "tiktok" ? 9 : 3;
        const cost = Math.round((base + rand() * 12) * 100) / 100;
        monthTotal += cost;
        await pool.query(
          `INSERT INTO marketing_ad_spend (period_date, channel, cost)
           VALUES ($1, $2, $3)`,
          [dateStr, channel, usd(cost)],
        );
      }
    }
    adSpend.set(key, Math.round(monthTotal * 100) / 100);
  }

  // ── 4) subscriptions + user_events (funnel / payment / churn / upgrade) ───
  let subCount = 0;
  const funnelDrop = { signup: 0, onboarding: 0, message: 0, finalized: 0 };
  for (let uIdx = 0; uIdx < userEmails.length; uIdx++) {
    const uRow = userRows[uIdx];
    const userId = uRow.id;
    const joinIso = uRow.joinIso;
    if (joinIso > now.toISOString()) continue;
    uRow.lastActive = joinIso;

    // 0. Telemetry aktivasi (FASE 1-3): signup → onboarding → chat → finalize.
    // Drop-off per tahap: onboarding ~15%, message_sent ~18%, finalized ~21%.
    funnelDrop.signup++;
    await insertEvent(userId, "signup_completed", null, joinIso, uIdx);
    if (rand() < 0.85) {
      funnelDrop.onboarding++;
      await insertEvent(userId, "onboarding_completed", null, minutesFrom(joinIso, 2 + Math.floor(rand() * 8)), uIdx);
    }
    if (rand() < 0.7) {
      funnelDrop.message++;
      await insertEvent(userId, "message_sent", { topic: "seed" }, minutesFrom(joinIso, 30 + Math.floor(rand() * 300)), uIdx);
    }
    if (rand() < 0.55) {
      funnelDrop.finalized++;
      await insertEvent(userId, "session_finalized", null, minutesFrom(joinIso, 1440 + Math.floor(rand() * 1440)), uIdx);
    }

    const plan = PLANS[rand() < 0.55 ? 1 : rand() < 0.5 ? 0 : 2]; // bias pro
    const yearly = rand() < 0.12;
    const amount = yearly ? plan.monthly * 12 : plan.monthly;

    // Upgrade path: ~12% pengguna mulai starter lalu upgrade ke pro.
    let upgrade = false;
    let upgradeAt: string | null = null;
    if (plan.planId === "pro" && rand() < 0.18) {
      const at = minutesFrom(joinIso, (10 + Math.floor(rand() * 40)) * 1440);
      if (at <= now.toISOString()) {
        upgrade = true;
        upgradeAt = at;
      }
    }

    // Churn: ~25% berhenti di join+1..3 bulan.
    const willChurn = rand() < 0.25;
    const churnAt = willChurn
      ? minutesFrom(joinIso, (30 + Math.floor(rand() * 60)) * 1440)
      : null;
    const canceled = churnAt !== null && churnAt <= now.toISOString();

    // 1. Checkout funnel
    const startedAt = minutesFrom(joinIso, -Math.floor(rand() * 40));
    await pool.query(
      `INSERT INTO user_events (user_id, event_name, event_properties, session_id, device_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, "checkout_started", JSON.stringify({ plan_id: plan.planId, billing_cycle: yearly ? "yearly" : "monthly", amount }), `seed-${uIdx}`, `device-${uIdx}`, startedAt],
    );
    evCount++;
    const completedAt = minutesFrom(startedAt, 2 + Math.floor(rand() * 6));
    if (completedAt <= now.toISOString()) {
      await pool.query(
        `INSERT INTO user_events (user_id, event_name, event_properties, session_id, device_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, "checkout_completed", JSON.stringify({ plan_id: plan.planId, billing_cycle: yearly ? "yearly" : "monthly", amount }), `seed-${uIdx}`, `device-${uIdx}`, completedAt],
      );
      evCount++;
    }

    // 2. Payment succeed / fail
    const payAt = completedAt <= now.toISOString() ? completedAt : startedAt;
    if (rand() < 0.08) {
      await pool.query(
        `INSERT INTO user_events (user_id, event_name, event_properties, session_id, device_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, "payment_failed", JSON.stringify({ plan_id: plan.planId, amount, error_code: "card_declined" }), `seed-${uIdx}`, `device-${uIdx}`, minutesFrom(payAt, 1)],
      );
      evCount++;
    } else {
      await pool.query(
        `INSERT INTO user_events (user_id, event_name, event_properties, session_id, device_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, "payment_succeeded", JSON.stringify({ plan_id: plan.planId, amount, subscription_id: randomUUID() }), `seed-${uIdx}`, `device-${uIdx}`, minutesFrom(payAt, 1)],
      );
      evCount++;
    }

    // 3. Subscription row (baru sukses → jadi aktif)
    const startedIso = minutesFrom(payAt, 1);
    await pool.query(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, amount, billing_cycle, started_date, ended_date, cancelled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        userId,
        plan.planId,
        canceled ? "canceled" : "active",
        usd(amount),
        yearly ? "yearly" : "monthly",
        startedIso,
        canceled ? churnAt : null,
        canceled ? churnAt : null,
      ],
    );
    subCount++;

    // 4. Churn event
    if (canceled && churnAt) {
      await pool.query(
        `INSERT INTO user_events (user_id, event_name, event_properties, session_id, device_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, "subscription_cancelled", JSON.stringify({ plan_id: plan.planId, amount, reason: "price" }), `seed-${uIdx}`, `device-${uIdx}`, churnAt],
      );
      evCount++;
    }

    // 5. Upgrade event
    if (upgrade) {
      const delta = 49 - 19; // starter → pro
      await pool.query(
        `INSERT INTO user_events (user_id, event_name, event_properties, session_id, device_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, "subscription_upgraded", JSON.stringify({ old_plan_id: "starter", new_plan_id: "pro", delta_amount: delta, amount: 49 }), `seed-${uIdx}`, `device-${uIdx}`, upgradeAt],
      );
      await pool.query(
        `INSERT INTO user_events (user_id, event_name, event_properties, session_id, device_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, "payment_succeeded", JSON.stringify({ plan_id: "pro", amount: 49, subscription_id: randomUUID() }), `seed-${uIdx}`, `device-${uIdx}`, minutesFrom(upgradeAt, 1)],
      );
      evCount += 2;
    }
  }

  // ── 5) Abandoned checkouts tambahan (checkout_started tanpa checkout_completed)
  for (let i = 0; i < 8; i++) {
    const u = userRows[Math.floor(rand() * userRows.length)];
    if (!u.lastActive) continue;
    const at = minutesFrom(u.lastActive, (1 + Math.floor(rand() * 20)) * 1440);
    if (at > now.toISOString()) continue;
    const plan = PLANS[Math.floor(rand() * PLANS.length)];
    await pool.query(
      `INSERT INTO user_events (user_id, event_name, event_properties, session_id, device_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [u.id, "checkout_started", JSON.stringify({ plan_id: plan.planId, billing_cycle: "monthly", amount: plan.monthly }), `seed-extra-${i}`, `device-${i}`, at],
    );
    evCount++;
  }

  // ── 6) Aktivitas bulanan per cohort (retensi: decay realistis) ───────────
  // Tiap user aktif di bulan join; bulan berikutnya aktif dengan probabilitas
  // mengikuti RETENTION_CURVE. page_view per bulan → DAU/WAU/MAU + retention.
  for (const u of userRows) {
    const join = new Date(u.joinIso);
    if (join.getTime() > now.getTime()) continue;
    let active = true;
    for (let m = 0; m < RETENTION_CURVE.length && active; m++) {
      if (m > 0 && rand() >= RETENTION_CURVE[m]) active = false; // dropout
      if (!active) break;
      const monthStart = new Date(Date.UTC(join.getUTCFullYear(), join.getUTCMonth() + m, 1));
      if (monthStart.getTime() > now.getTime()) break;
      const isCurrent = monthStart.getUTCFullYear() === now.getUTCFullYear() && monthStart.getUTCMonth() === now.getUTCMonth();
      const daysInMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getDate();
      const lastDay = isCurrent ? Math.min(now.getUTCDate(), daysInMonth) : daysInMonth;
      const visits = 1 + Math.floor(rand() * 2);
      for (let v = 0; v < visits; v++) {
        const day = 1 + Math.floor(rand() * lastDay);
        const at = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day));
        if (at.getTime() > now.getTime()) continue;
        await insertEvent(u.id, "page_view", { path: "/chat" }, at.toISOString(), `act-${u.id.slice(0, 6)}`);
        u.lastActive = at.toISOString();
      }
    }
  }

  // ── 7) Ringkasan ──────────────────────────────────────────────────────────
  let seededUsers = 0;
  for (const u of userRows) {
    if (u.joinIso > now.toISOString()) continue;
    seededUsers++;
    await pool.query(`UPDATE users SET last_active = $1 WHERE id = $2`, [u.lastActive, u.id]);
  }
  await pool.end();

  console.log("──────────────────────────────────────────────────");
  console.log("Seed monetisasi + analytics selesai (deterministik)");
  console.log(`  users             : ${seededUsers}`);
  console.log(`  subscriptions     : ${subCount}`);
  console.log(`  user_events       : ${evCount}`);
  console.log("  funnel aktivasi   :");
  console.log(`    signup → ${funnelDrop.signup} | onboarding → ${funnelDrop.onboarding} | message → ${funnelDrop.message} | finalized → ${funnelDrop.finalized}`);
  console.log("  ad spend / bulan  :");
  for (const [k, v] of adSpend) {
    console.log(`    ${k} → $${v.toFixed(2)}`);
  }
  console.log("──────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
