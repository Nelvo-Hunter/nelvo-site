/**
 * Cloudflare Worker — Nelvo site.
 *
 * Handles dynamic routes (currently /api/growth-map-submit) and
 * falls through to static assets for everything else.
 *
 * Goes at the repo root, alongside index.html.
 *
 * Required environment variable (Cloudflare → Workers & Pages → Settings → Variables and Secrets):
 *   RESEND_API_KEY  — the Resend API key (re_...)
 *
 * Optional environment variables:
 *   NOTIFY_EMAIL    — destination address (defaults to hunter@nelvo.ca)
 *   FROM_EMAIL      — sender address (defaults to "Nelvo Forms <forms@nelvo.ca>")
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ─── /api/growth-map-submit ─────────────────────────
    if (url.pathname === '/api/growth-map-submit') {
      if (request.method === 'POST') {
        return handleGrowthMapSubmit(request, env);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // ─── Fall through to static assets ──────────────────
    return env.ASSETS.fetch(request);
  },
};

// ─────────────────────────────────────────────────────────
// Growth Map submission handler
// ─────────────────────────────────────────────────────────

async function handleGrowthMapSubmit(request, env) {
  // Parse body
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return jsonError('Invalid JSON payload', 400);
  }

  const { respondent, responses, submittedAt } = payload || {};
  if (!respondent || !responses) {
    return jsonError('Missing required fields', 400);
  }

  // Validate respondent fields
  const required = ['name', 'email', 'organization', 'role'];
  for (const f of required) {
    if (!respondent[f] || typeof respondent[f] !== 'string') {
      return jsonError(`Missing respondent field: ${f}`, 400);
    }
  }

  // Validate answers (Q1-Q10, integers 1-5)
  for (let i = 1; i <= 10; i++) {
    const v = responses[`q${i}`];
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      return jsonError(`Invalid answer for q${i}`, 400);
    }
  }

  // Score
  // Top-Down = Q1..Q5, Bottom-Up = Q6..Q10
  // Raw 5-25 → normalized 1.0-9.0 via ((raw - 5) / 20) * 8 + 1
  // Quadrant thresholds at 5.0
  const topDownRaw = [1, 2, 3, 4, 5].reduce((s, i) => s + responses[`q${i}`], 0);
  const bottomUpRaw = [6, 7, 8, 9, 10].reduce((s, i) => s + responses[`q${i}`], 0);
  const normalize = (raw) => Math.round((((raw - 5) / 20) * 8 + 1) * 10) / 10;
  const topDown = normalize(topDownRaw);
  const bottomUp = normalize(bottomUpRaw);

  const quadrant =
    topDown < 5.0 && bottomUp < 5.0 ? 'Unbroken Ground' :
    topDown >= 5.0 && bottomUp < 5.0 ? 'Strategy Trap' :
    topDown < 5.0 && bottomUp >= 5.0 ? 'Wild Garden' :
    'Thriving Garden';

  // Compose email body
  const questionLabels = [
    'Q1. Communication of workplace change',
    'Q2. How investment decisions start',
    'Q3. How results are measured',
    'Q4. Investment in skill development',
    'Q5. Risk and boundary management',
    'Q6. Engagement with new technology',
    'Q7. Knowledge documentation',
    'Q8. Discovery sharing across the team',
    'Q9. Quality review of important work',
    'Q10. Response when tools do not fit',
  ];

  const rows = questionLabels
    .map((label, idx) => {
      const v = responses[`q${idx + 1}`];
      return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:14px;color:#444;">${esc(label)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:14px;color:#1E3538;text-align:center;font-weight:600;">${v}</td></tr>`;
    })
    .join('');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1E3538;">
  <div style="border-bottom:3px solid #B4602C;padding-bottom:12px;margin-bottom:20px;">
    <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;">New Growth Map response</div>
    <h1 style="font-family:Georgia,serif;font-size:24px;margin:6px 0 0;color:#1E3538;">${esc(respondent.organization)}</h1>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr><td style="padding:4px 0;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;">Name</td><td style="padding:4px 0;font-family:sans-serif;font-size:15px;color:#1E3538;">${esc(respondent.name)}</td></tr>
    <tr><td style="padding:4px 0;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;">Email</td><td style="padding:4px 0;font-family:sans-serif;font-size:15px;color:#1E3538;"><a href="mailto:${esc(respondent.email)}" style="color:#B4602C;">${esc(respondent.email)}</a></td></tr>
    <tr><td style="padding:4px 0;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;">Role</td><td style="padding:4px 0;font-family:sans-serif;font-size:15px;color:#1E3538;">${esc(respondent.role)}</td></tr>
    <tr><td style="padding:4px 0;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;">Submitted</td><td style="padding:4px 0;font-family:sans-serif;font-size:15px;color:#1E3538;">${esc(submittedAt || new Date().toISOString())}</td></tr>
  </table>

  <div style="background:#F0EBE1;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
    <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;margin-bottom:8px;">Scoring</div>
    <table style="width:100%;font-family:sans-serif;font-size:14px;">
      <tr><td style="padding:3px 0;color:#4a5a5d;">Top-Down (leadership engagement, Q1-Q5)</td><td style="padding:3px 0;font-family:monospace;font-weight:600;color:#1E3538;text-align:right;">${topDown} / 9.0 (raw ${topDownRaw})</td></tr>
      <tr><td style="padding:3px 0;color:#4a5a5d;">Bottom-Up (frontline capability, Q6-Q10)</td><td style="padding:3px 0;font-family:monospace;font-weight:600;color:#1E3538;text-align:right;">${bottomUp} / 9.0 (raw ${bottomUpRaw})</td></tr>
      <tr><td style="padding:8px 0 3px;color:#4a5a5d;border-top:1px solid rgba(30,53,56,0.15);">Quadrant</td><td style="padding:8px 0 3px;font-family:Georgia,serif;font-weight:700;font-size:16px;color:#B4602C;text-align:right;border-top:1px solid rgba(30,53,56,0.15);">${quadrant}</td></tr>
    </table>
  </div>

  <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;margin-bottom:8px;">Answers</div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #eee;">
    ${rows}
  </table>
</div>
  `.trim();

  // Send via Resend
  const to = env.NOTIFY_EMAIL || 'hunter@nelvo.ca';
  const from = env.FROM_EMAIL || 'Nelvo Forms <forms@nelvo.ca>';

  if (!env.RESEND_API_KEY) {
    return jsonError('Server not configured: missing RESEND_API_KEY', 500);
  }

  try {
    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        reply_to: respondent.email,
        subject: `Growth Map response: ${respondent.organization} (${respondent.name})`,
        html,
      }),
    });

    if (!resendResp.ok) {
      const detail = await resendResp.text();
      console.error('Resend error:', detail);
      return jsonError('Email send failed', 502);
    }
  } catch (err) {
    console.error('Network error calling Resend:', err);
    return jsonError('Network error', 502);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
