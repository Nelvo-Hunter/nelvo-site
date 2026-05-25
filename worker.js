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

  const { respondent, responses, profile, submittedAt } = payload || {};
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
// Profile section (P1-P8, not scored — for Growth Map prep)
// ─────────────────────────────────────────────────────────

function buildProfileSection(profile) {
  if (!profile || typeof profile !== 'object') return '';

  const blank = '<em style="color:#999;font-style:italic;">(blank)</em>';

  function fmtArray(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return blank;
    return arr.map(esc).join(', ');
  }
  function fmtSingle(v) {
    if (v === null || v === undefined || v === '') return blank;
    return esc(String(v));
  }

  let p1Display = fmtArray(profile.p1);
  if (profile.p1_other) p1Display += ` <span style="color:#888;">(other: ${esc(profile.p1_other)})</span>`;

  let p3Display = fmtArray(profile.p3);
  if (profile.p3_other) p3Display += ` <span style="color:#888;">(other: ${esc(profile.p3_other)})</span>`;

  let p4Display = fmtSingle(profile.p4);
  if (profile.p4_which) p4Display += ` <span style="color:#888;">(${esc(profile.p4_which)})</span>`;

  const p5Display = (Number.isInteger(profile.p5) && profile.p5 >= 1 && profile.p5 <= 5)
    ? `${profile.p5} / 5`
    : blank;

  const shortRows = [
    ['P1. Primary AI platforms (personal)', p1Display],
    ['P2. Frequency of personal AI use', fmtSingle(profile.p2)],
    ['P3. AI tools at work', p3Display],
    ['P4. Pays for AI subscription', p4Display],
    ['P5. Self-rated comfort with AI', p5Display],
  ];

  const shortRowsHtml = shortRows.map(([label, value]) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:13px;color:#444;vertical-align:top;width:42%;">${esc(label)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:sans-serif;font-size:13px;color:#1E3538;">${value}</td></tr>`
  ).join('');

  const freeText = [
    ['P6. A task AI worked well for', profile.p6],
    ['P7. A task they wish AI could help with', profile.p7],
    ['P8. Concerns or hesitations about AI at work', profile.p8],
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
