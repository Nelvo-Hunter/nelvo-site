/**
 * Cloudflare Worker — Nelvo site.
 *
 * Handles dynamic routes and falls through to static assets for everything else.
 * Goes at the repo root, alongside index.html.
 *
 * Dynamic routes:
 *   POST /api/growth-map-submit   — introduction survey (scored, named)
 *   POST /api/feedback-submit     — post-session feedback (ANONYMOUS, no PII)
 *   POST /api/testimonial-submit  — post-session testimonial (named, opt-in)
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

    // ─── /api/feedback-submit (anonymous) ───────────────
    if (url.pathname === '/api/feedback-submit') {
      if (request.method === 'POST') {
        return handleFeedbackSubmit(request, env);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // ─── /api/testimonial-submit (named) ────────────────
    if (url.pathname === '/api/testimonial-submit') {
      if (request.method === 'POST') {
        return handleTestimonialSubmit(request, env);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // ─── Fall through to static assets ──────────────────
    return env.ASSETS.fetch(request);
  },
};

// ─────────────────────────────────────────────────────────
// Growth Map submission handler (v2)
// ─────────────────────────────────────────────────────────

async function handleGrowthMapSubmit(request, env) {
  // Parse body
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return jsonError('Invalid JSON payload', 400);
  }

  const { respondent, responses, breadth, profile, submittedAt } = payload || {};
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

  // Validate breadth (B-A4): array of category strings
  if (!Array.isArray(breadth) || breadth.length === 0 || breadth.length > 9) {
    return jsonError('Invalid breadth selection', 400);
  }
  const breadthClean = breadth.map((s) => String(s).slice(0, 120));
  const breadthCount = breadthClean.includes('None') ? 0 : breadthClean.length;
  const breadthScore =
    breadthCount <= 1 ? (breadthCount === 0 ? 1 : 1) :
    breadthCount === 2 ? 2 :
    breadthCount <= 4 ? 3 :
    breadthCount <= 6 ? 4 : 5;

  // ── Score (v2): axis = 0.3 * Change Readiness + 0.7 * AI Engagement
  const q = (i) => responses[`q${i}`];
  const round1 = (x) => Math.round(x * 10) / 10;
  const normReadiness = (raw) => ((raw - 2) / 8) * 8 + 1;          // raw 2-10 → 1-9
  const normAI3 = (raw) => ((raw - 3) / 12) * 8 + 1;               // raw 3-15 → 1-9
  const normAI4 = (raw) => ((raw - 4) / 16) * 8 + 1;               // raw 4-20 → 1-9

  const tdReadinessRaw = q(1) + q(2);
  const tdAIRaw = q(3) + q(4) + q(5);
  const buReadinessRaw = q(6) + q(7);
  const buAIRaw = q(8) + q(9) + q(10) + breadthScore;

  const tdReadiness = round1(normReadiness(tdReadinessRaw));
  const tdAI = round1(normAI3(tdAIRaw));
  const buReadiness = round1(normReadiness(buReadinessRaw));
  const buAI = round1(normAI4(buAIRaw));

  const topDown = round1(0.3 * normReadiness(tdReadinessRaw) + 0.7 * normAI3(tdAIRaw));
  const bottomUp = round1(0.3 * normReadiness(buReadinessRaw) + 0.7 * normAI4(buAIRaw));

  const quadrant =
    topDown < 5.0 && bottomUp < 5.0 ? 'Unbroken Ground' :
    topDown >= 5.0 && bottomUp < 5.0 ? 'Strategy Trap' :
    topDown < 5.0 && bottomUp >= 5.0 ? 'Wild Garden' :
    'Thriving Garden';

  // Compose email body
  const questionLabels = [
    'Q1. Communication of change (readiness)',
    'Q2. Skill-building support (readiness)',
    'Q3. AI direction (AI)',
    'Q4. Commitment about AI and roles (AI)',
    'Q5. Guardrail fit (AI)',
    'Q6. Knowledge and context capture (readiness)',
    'Q7. Discovery sharing (readiness)',
    'Q8. Hands-on AI use (AI)',
    'Q9. AI output review (AI)',
    'Q10. Building with AI (AI)',
  ];

  const rows = questionLabels
    .map((label, idx) => {
      const v = responses[`q${idx + 1}`];
      return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:14px;color:#444;">${esc(label)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:14px;color:#1E3538;text-align:center;font-weight:600;">${v}</td></tr>`;
    })
    .join('');

  const breadthRow = `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:14px;color:#444;">Q11. Breadth of AI use (AI)<br><span style="font-size:12px;color:#888;">${breadthClean.map(esc).join(' · ')}</span></td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:14px;color:#1E3538;text-align:center;font-weight:600;">${breadthScore}<br><span style="font-size:11px;color:#888;">(${breadthCount} cat.)</span></td></tr>`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1E3538;">
  <div style="border-bottom:3px solid #B4602C;padding-bottom:12px;margin-bottom:20px;">
    <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;">New Growth Map response (survey v2)</div>
    <h1 style="font-family:Georgia,serif;font-size:24px;margin:6px 0 0;color:#1E3538;">${esc(respondent.organization)}</h1>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr><td style="padding:4px 0;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;">Name</td><td style="padding:4px 0;font-family:sans-serif;font-size:15px;color:#1E3538;">${esc(respondent.name)}</td></tr>
    <tr><td style="padding:4px 0;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;">Email</td><td style="padding:4px 0;font-family:sans-serif;font-size:15px;color:#1E3538;"><a href="mailto:${esc(respondent.email)}" style="color:#B4602C;">${esc(respondent.email)}</a></td></tr>
    <tr><td style="padding:4px 0;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;">Role</td><td style="padding:4px 0;font-family:sans-serif;font-size:15px;color:#1E3538;">${esc(respondent.role)}</td></tr>
    <tr><td style="padding:4px 0;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;">Submitted</td><td style="padding:4px 0;font-family:sans-serif;font-size:15px;color:#1E3538;">${esc(submittedAt || new Date().toISOString())}</td></tr>
  </table>

  <div style="background:#F0EBE1;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
    <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;margin-bottom:8px;">Scoring (v2: 0.3 readiness + 0.7 AI)</div>
    <table style="width:100%;font-family:sans-serif;font-size:14px;">
      <tr><td style="padding:3px 0;color:#4a5a5d;">Top-Down (leadership enablement)</td><td style="padding:3px 0;font-family:monospace;font-weight:600;color:#1E3538;text-align:right;">${topDown} / 9.0</td></tr>
      <tr><td style="padding:2px 0 2px 14px;color:#7a8a8d;font-size:13px;">Change Readiness (Q1-Q2)</td><td style="padding:2px 0;font-family:monospace;color:#4a5a5d;text-align:right;font-size:13px;">${tdReadiness} / 9.0 (raw ${tdReadinessRaw})</td></tr>
      <tr><td style="padding:2px 0 6px 14px;color:#7a8a8d;font-size:13px;">AI Engagement (Q3-Q5)</td><td style="padding:2px 0 6px;font-family:monospace;color:#4a5a5d;text-align:right;font-size:13px;">${tdAI} / 9.0 (raw ${tdAIRaw})</td></tr>
      <tr><td style="padding:3px 0;color:#4a5a5d;">Bottom-Up (frontline capability)</td><td style="padding:3px 0;font-family:monospace;font-weight:600;color:#1E3538;text-align:right;">${bottomUp} / 9.0</td></tr>
      <tr><td style="padding:2px 0 2px 14px;color:#7a8a8d;font-size:13px;">Change Readiness (Q6-Q7)</td><td style="padding:2px 0;font-family:monospace;color:#4a5a5d;text-align:right;font-size:13px;">${buReadiness} / 9.0 (raw ${buReadinessRaw})</td></tr>
      <tr><td style="padding:2px 0 6px 14px;color:#7a8a8d;font-size:13px;">AI Engagement (Q8-Q10 + breadth)</td><td style="padding:2px 0 6px;font-family:monospace;color:#4a5a5d;text-align:right;font-size:13px;">${buAI} / 9.0 (raw ${buAIRaw})</td></tr>
      <tr><td style="padding:8px 0 3px;color:#4a5a5d;border-top:1px solid rgba(30,53,56,0.15);">Quadrant</td><td style="padding:8px 0 3px;font-family:Georgia,serif;font-weight:700;font-size:16px;color:#B4602C;text-align:right;border-top:1px solid rgba(30,53,56,0.15);">${quadrant}</td></tr>
    </table>
  </div>

  <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;margin-bottom:8px;">Answers</div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #eee;">
    ${rows}
    ${breadthRow}
  </table>
  ${buildProfileSection(profile)}
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
// Feedback submission handler (ANONYMOUS)
//
// Receives NO identifying information. This is a deliberately
// separate request from the testimonial so the two cannot be
// correlated. Do not add name/email handling here.
// ─────────────────────────────────────────────────────────

async function handleFeedbackSubmit(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return jsonError('Invalid JSON payload', 400);
  }

  const { session, ratings, responses, submittedDate } = payload || {};
  if (!ratings || !responses) {
    return jsonError('Missing required fields', 400);
  }

  // Date only, no time. Anonymous feedback is never timestamped to the minute,
  // so a response cannot be ordered against a named testimonial.
  const dateOnly = (typeof submittedDate === 'string' && submittedDate.trim())
    ? submittedDate.trim().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Validate the six ratings (integers 1-5)
  const ratingKeys = ['value', 'recommend', 'understandingBefore', 'understandingAfter', 'clarityNextStep', 'mindsetShift'];
  for (const k of ratingKeys) {
    const v = ratings[k];
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      return jsonError(`Invalid rating: ${k}`, 400);
    }
  }

  // Takeaway is required free text
  if (!responses.takeaway || typeof responses.takeaway !== 'string') {
    return jsonError('Missing takeaway', 400);
  }

  const delta = ratings.understandingAfter - ratings.understandingBefore;
  const deltaStr = (delta > 0 ? '+' : '') + delta;
  const sessionLabel = (typeof session === 'string' && session.trim()) ? session.trim() : 'Nelvo session';

  const ratingRows = [
    ['Overall value', `${ratings.value} / 5`],
    ['Likelihood to recommend', `${ratings.recommend} / 5`],
    ['Understanding before', `${ratings.understandingBefore} / 5`],
    ['Understanding after', `${ratings.understandingAfter} / 5`],
    ['Understanding shift', `${deltaStr}`],
    ['Clarity on next step', `${ratings.clarityNextStep} / 5`],
    ['Changed how they think about AI', `${ratings.mindsetShift} / 5`],
  ].map(([label, value]) =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:14px;color:#444;">${esc(label)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:14px;color:#1E3538;text-align:center;font-weight:600;">${esc(value)}</td></tr>`
  ).join('');

  const blank = '<em style="color:#999;font-style:italic;">(left blank)</em>';
  const textBlocks = [
    ['Most valuable takeaway', responses.takeaway],
    ['Less useful / could be better', responses.improve],
    ['What would make it more valuable / what next', responses.next],
    ['Anything else', responses.anythingElse],
  ].map(([label, value]) => `
    <div style="margin-bottom:14px;">
      <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#888;margin-bottom:6px;">${esc(label)}</div>
      <div style="font-family:Georgia,serif;font-size:14px;color:#1E3538;line-height:1.55;background:#FAF8F5;padding:10px 14px;border-left:3px solid #B4602C;border-radius:4px;white-space:pre-wrap;">${value ? esc(value) : blank}</div>
    </div>
  `).join('');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1E3538;">
  <div style="border-bottom:3px solid #B4602C;padding-bottom:12px;margin-bottom:20px;">
    <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;">Anonymous session feedback</div>
    <h1 style="font-family:Georgia,serif;font-size:24px;margin:6px 0 0;color:#1E3538;">${esc(sessionLabel)}</h1>
  </div>

  <div style="background:#F0EBE1;border-radius:8px;padding:10px 16px;margin-bottom:20px;font-family:sans-serif;font-size:13px;color:#4a5a5d;">
    This response is anonymous. No name, email, or submission time was collected. Received ${esc(dateOnly)}.
  </div>

  <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;margin-bottom:8px;">Ratings</div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #eee;margin-bottom:24px;">
    ${ratingRows}
  </table>

  <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;margin-bottom:10px;">Written feedback</div>
  ${textBlocks}
</div>
  `.trim();

  const to = env.NOTIFY_EMAIL || 'hunter@nelvo.ca';
  const from = env.FROM_EMAIL || 'Nelvo Forms <forms@nelvo.ca>';

  if (!env.RESEND_API_KEY) {
    return jsonError('Server not configured: missing RESEND_API_KEY', 500);
  }

  try {
    // NOTE: no reply_to here, on purpose. The submission is anonymous.
    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: `Session feedback: ${sessionLabel} (anonymous)`,
        html,
      }),
    });

    if (!resendResp.ok) {
      const detail = await resendResp.text();
      console.error('Resend error (feedback):', detail);
      return jsonError('Email send failed', 502);
    }
  } catch (err) {
    console.error('Network error calling Resend (feedback):', err);
    return jsonError('Network error', 502);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────
// Testimonial submission handler (NAMED, opt-in)
// ─────────────────────────────────────────────────────────

async function handleTestimonialSubmit(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return jsonError('Invalid JSON payload', 400);
  }

  const { session, testimonial, attribution, consent, openToReference, submittedAt } = payload || {};
  if (!testimonial || !attribution) {
    return jsonError('Missing required fields', 400);
  }

  // Attribution: name, position, company required
  for (const f of ['name', 'position', 'company']) {
    if (!attribution[f] || typeof attribution[f] !== 'string') {
      return jsonError(`Missing attribution field: ${f}`, 400);
    }
  }

  // At least one testimonial field
  const hasContent = ['summary', 'beforeAfter', 'recommendation']
    .some((k) => testimonial[k] && typeof testimonial[k] === 'string' && testimonial[k].trim());
  if (!hasContent) {
    return jsonError('Testimonial is empty', 400);
  }

  // Consent must be explicitly true
  if (consent !== true) {
    return jsonError('Consent not given', 400);
  }

  const sessionLabel = (typeof session === 'string' && session.trim()) ? session.trim() : 'Nelvo session';
  const email = (attribution.email && typeof attribution.email === 'string') ? attribution.email.trim() : '';
  const blank = '<em style="color:#999;font-style:italic;">(left blank)</em>';

  const attrRows = [
    ['Name', esc(attribution.name)],
    ['Position', esc(attribution.position)],
    ['Company', esc(attribution.company)],
    ['Email', email ? `<a href="mailto:${esc(email)}" style="color:#B4602C;">${esc(email)}</a>` : blank],
    ['Open to being a reference', openToReference ? 'Yes' : 'No'],
    ['Consent to publish', 'Yes, with name, title, and company'],
    ['Submitted', esc(submittedAt || new Date().toISOString())],
  ].map(([label, value]) =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;vertical-align:top;width:42%;">${esc(label)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:14px;color:#1E3538;">${value}</td></tr>`
  ).join('');

  const textBlocks = [
    ['Summary (website quote)', testimonial.summary],
    ['Before and after', testimonial.beforeAfter],
    ['Would say to others', testimonial.recommendation],
  ].map(([label, value]) => `
    <div style="margin-bottom:14px;">
      <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#888;margin-bottom:6px;">${esc(label)}</div>
      <div style="font-family:Georgia,serif;font-size:15px;color:#1E3538;line-height:1.6;background:#FAF8F5;padding:12px 16px;border-left:3px solid #B4602C;border-radius:4px;white-space:pre-wrap;">${value && value.trim() ? esc(value) : blank}</div>
    </div>
  `).join('');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1E3538;">
  <div style="border-bottom:3px solid #B4602C;padding-bottom:12px;margin-bottom:20px;">
    <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;">New testimonial</div>
    <h1 style="font-family:Georgia,serif;font-size:24px;margin:6px 0 0;color:#1E3538;">${esc(attribution.name)}, ${esc(attribution.company)}</h1>
    <div style="font-family:sans-serif;font-size:13px;color:#7a8a8d;margin-top:4px;">${esc(sessionLabel)}</div>
  </div>

  <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;margin-bottom:10px;">In their words</div>
  ${textBlocks}

  <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;margin:24px 0 8px;">Attribution and permission</div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #eee;">
    ${attrRows}
  </table>
</div>
  `.trim();

  const to = env.NOTIFY_EMAIL || 'hunter@nelvo.ca';
  const from = env.FROM_EMAIL || 'Nelvo Forms <forms@nelvo.ca>';

  if (!env.RESEND_API_KEY) {
    return jsonError('Server not configured: missing RESEND_API_KEY', 500);
  }

  const body = {
    from,
    to,
    subject: `New testimonial: ${attribution.name}, ${attribution.company}`,
    html,
  };
  // Only set reply_to if they shared an email and are open to contact.
  if (email) {
    body.reply_to = email;
  }

  try {
    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resendResp.ok) {
      const detail = await resendResp.text();
      console.error('Resend error (testimonial):', detail);
      return jsonError('Email send failed', 502);
    }
  } catch (err) {
    console.error('Network error calling Resend (testimonial):', err);
    return jsonError('Network error', 502);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────
// Profile section (P1-P7, not scored — for Growth Map prep)
// ─────────────────────────────────────────────────────────

function buildProfileSection(profile) {
  if (!profile || typeof profile !== 'object') return '';

  const blank = '<em style="color:#999;font-style:italic;">(blank)</em>';

  function fmtSingle(v) {
    if (v === null || v === undefined || v === '') return blank;
    return esc(String(v));
  }

  // P1: tools grid → "ChatGPT (personal + work), Claude (work), ..."
  let toolsDisplay = blank;
  const t = profile.tools;
  if (t && typeof t === 'object') {
    if (t.none) {
      toolsDisplay = "Doesn't use AI tools yet";
    } else {
      const names = {
        chatgpt: 'ChatGPT',
        claude: 'Claude',
        gemini: 'Gemini',
        copilot: 'Microsoft Copilot',
        perplexity: 'Perplexity',
        other: t.otherName ? `Other: ${t.otherName}` : 'Other',
      };
      const parts = [];
      for (const key of Object.keys(names)) {
        const uses = Array.isArray(t[key]) ? t[key] : [];
        if (uses.length > 0) {
          parts.push(`${names[key]} (${uses.join(' + ').toLowerCase()})`);
        }
      }
      if (parts.length > 0) toolsDisplay = esc(parts.join(', '));
    }
  }

  let paidDisplay = fmtSingle(profile.paid);
  if (profile.paidWhich) paidDisplay += ` <span style="color:#888;">(${esc(profile.paidWhich)})</span>`;

  const comfortDisplay = (Number.isInteger(profile.comfort) && profile.comfort >= 1 && profile.comfort <= 5)
    ? `${profile.comfort} / 5`
    : blank;

  const shortRows = [
    ['P1. AI tools used, and where', toolsDisplay],
    ['P2. Frequency of AI use (work + personal)', fmtSingle(profile.frequency)],
    ['P3. Self-rated comfort with AI', comfortDisplay],
    ['P4. Pays for AI subscription', paidDisplay],
  ];

  const shortRowsHtml = shortRows.map(([label, value]) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:13px;color:#444;vertical-align:top;width:42%;">${esc(label)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:13px;color:#1E3538;">${value}</td></tr>`
  ).join('');

  const freeText = [
    ['P5. A task AI worked well for', profile.taskWorked],
    ['P6. A task they wish AI could help with', profile.taskWish],
    ['P7. Concerns or hesitations about AI at work', profile.concern],
  ];

  const longBlocksHtml = freeText.map(([label, value]) => `
    <div style="margin-bottom:14px;">
      <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#888;margin-bottom:6px;">${esc(label)}</div>
      <div style="font-family:Georgia,serif;font-size:14px;color:#1E3538;line-height:1.55;background:#FAF8F5;padding:10px 14px;border-left:3px solid #B4602C;border-radius:4px;white-space:pre-wrap;">${value ? esc(value) : blank}</div>
    </div>
  `).join('');

  return `
    <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#B4602C;margin:28px 0 10px;">Profile responses</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;margin-bottom:20px;">
      ${shortRowsHtml}
    </table>
    ${longBlocksHtml}
  `;
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
