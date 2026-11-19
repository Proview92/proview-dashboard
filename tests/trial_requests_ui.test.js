// Proview dashboard, signed in: "Active apps" (Open, as before) and "Inactive apps" (Request trial instead of Open), the
// request form and Send, the "Requested" state, a second click, the master's view, and the layout at 390px.
// Headless Chrome with a mocked Supabase Auth, sso-assert and lic_trial_requests.
// Usage: node tests/trial_requests_ui.test.js (screenshots go to the temp folder).
const puppeteer = require('/opt/npm-tools/node_modules/puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..'), PORT = 8773, BASE = `http://127.0.0.1:${PORT}/`;
const results = []; const ok = (n, c) => results.push((c ? 'PASS ' : 'FAIL ') + n);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(new URL(q.url, BASE).pathname)); fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'text/plain' }); s.end(b); }); }).listen(PORT);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SHOTS = { desktop: path.join(os.tmpdir(), 'dash-trial-desktop.png'), mobile: path.join(os.tmpdir(), 'dash-trial-390.png'), master: path.join(os.tmpdir(), 'dash-trial-master.png'), form: path.join(os.tmpdir(), 'dash-trial-form-390.png') };
const A = (app, name, okk, reason = '') => ({ app, name, url: 'https://x/', ok: okk, reason });
const CUSTOMER_APPS = [A('signage', 'Proview Signage', true), A('team', 'Proview Team', true), A('bookings', 'Proview Bookings', true),
  A('employee', 'Proview Employee', false, 'No account for this email'), A('label', 'Proview Label', false, 'No account for this email'),
  A('qrmenu', 'Proview QR Menu', false, 'No account for this email'), A('wifi', 'Proview WiFi', false, 'No account for this email'),
  A('reservations', 'Proview Reservations', false, 'No account for this email')];
const NONE_APPS = CUSTOMER_APPS.map((a) => ({ ...a, ok: false, reason: 'No account for this email' }));

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const errs = [];
  // one "server": requests stored per email, like the table (one open per person per app)
  const TABLE = [], posts = [], notifies = [], gets = [];
  const open = async ({ email, apps, master = false, width = 1280, height = 900, insertError = null }) => {
    const UID = master ? '11111111-1111-1111-1111-111111111111' : '22222222-2222-2222-2222-222222222222';
    const user = { id: UID, email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {} };
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const tok = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: UID, email, role: 'authenticated', exp }) + '.x';
    const page = await browser.newPage(); await page.setViewport({ width, height });
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('dialog', (d) => { errs.push('native dialog: ' + d.message()); d.dismiss(); });
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (u.startsWith(BASE) || u.includes('cdn.jsdelivr.net')) return r.continue();
      if (u.includes('esm.sh/@supabase/supabase-js')) return r.respond({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: "export * from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';" });
      const j = (b, s = 200) => r.respond({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(b) });
      if (r.method() === 'OPTIONS') return j({});
      if (u.includes('/auth/v1/user')) return j(user);
      if (u.includes('/auth/v1/logout')) return j({});
      if (u.includes('/rpc/is_lic_admin')) return j(master);
      if (u.includes('/functions/v1/sso-assert')) return j({ email, apps });
      if (u.includes('/functions/v1/trial-request-notify')) { notifies.push(JSON.parse(r.postData() || '{}')); return j({ ok: true, sent: false }); }
      if (u.includes('/rest/v1/lic_trial_requests')) {
        const me = email.toLowerCase();
        if (r.method() === 'GET') {
          gets.push(u);
          const q = new URL(u).searchParams; const fe = (q.get('email') || '').replace(/^eq\./, ''), fs_ = (q.get('status') || '').replace(/^eq\./, '');
          // RLS: own rows, or every row for the master
          return j(TABLE.filter((x) => (master || x.email === me) && (!fe || x.email === fe) && (!fs_ || x.status === fs_)));
        }
        if (r.method() === 'POST') {
          const b = JSON.parse(r.postData() || '{}'); posts.push(b);
          if (insertError) return j(insertError, 400);
          if (TABLE.some((x) => x.email === me && x.app === b.app && x.status === 'new')) return j({ code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "lic_trial_requests_one_open"' }, 409);
          const row = { id: 'aaaaaaaa-0000-4000-8000-' + String(TABLE.length).padStart(12, '0'), email: me, app: b.app, business: b.business, note: b.note, status: 'new', created_at: new Date().toISOString() };
          TABLE.push(row); return j(row, 201);
        }
      }
      return j({});
    });
    await page.goto(BASE + 'README.md');
    await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('pv-account', JSON.stringify(s)); }, { access_token: tok, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user });
    await page.goto(BASE + 'index.html', { waitUntil: 'networkidle0' }); await wait(900);
    return page;
  };
  const txt = (p, s) => p.evaluate((s) => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || '', s);
  const names = (p, sec) => p.evaluate((sec) => { const h = document.getElementById(sec); const ul = h && h.nextElementSibling?.matches('ul') ? h.nextElementSibling : h?.nextElementSibling?.nextElementSibling; return ul ? [...ul.querySelectorAll('li.app b')].map((b) => b.textContent) : null; }, sec);
  const C = 'bab@example.test';

  // ---------- customer: both sections ----------
  let p = await open({ email: C, apps: CUSTOMER_APPS });
  ok('signed in: "Your Proview apps"', (await txt(p, 'h1')) === 'Your Proview apps');
  ok('"Active apps" heading with count ' + await txt(p, '#secActive'), (await txt(p, '#secActive')) === 'Active apps 2');
  ok('"Inactive apps" heading with count ' + await txt(p, '#secInactive'), (await txt(p, '#secInactive')) === 'Inactive apps 4');
  const act = await names(p, 'secActive'), ina = await names(p, 'secInactive');
  ok('active = the apps with ok ' + JSON.stringify(act), JSON.stringify(act) === JSON.stringify(['Proview Signage', 'Proview Team']));
  ok('inactive = the rest ' + JSON.stringify(ina), JSON.stringify(ina) === JSON.stringify(['Proview Label', 'Proview QR Menu', 'Proview WiFi', 'Proview Reservations']));
  ok('HIDDEN kept: no Bookings / Employee anywhere', !(await p.evaluate(() => /Bookings|Employee/.test(document.querySelector('#view').textContent))));
  const btns = await p.evaluate(() => [...document.querySelectorAll('li.app')].map((li) => [li.querySelector('b').textContent, li.classList.contains('off'), li.querySelector('button')?.textContent.replace(/\s+/g, ' ').trim()]));
  ok('active apps keep Open ' + JSON.stringify(btns.filter((b) => !b[1])), btns.filter((b) => !b[1]).every((b) => /^Open /.test(b[2])));
  ok('inactive apps: Request trial instead of Open ' + JSON.stringify(btns.filter((b) => b[1])), btns.filter((b) => b[1]).every((b) => /^Request trial /.test(b[2])) && !(await p.evaluate(() => !!document.querySelector('li.app.off [data-app]'))));
  const look = await p.evaluate(() => { const li = document.querySelector('li.app.off'), ic = li.querySelector('img.ic'); return { src: ic.getAttribute('src'), filter: getComputedStyle(ic).filter, op: getComputedStyle(ic).opacity, bg: getComputedStyle(li).backgroundColor }; });
  ok('inactive rows keep icon and name, shown muted ' + JSON.stringify(look), look.src === 'icons/label.svg' && /grayscale/.test(look.filter) && Number(look.op) < 1);
  ok('own requests read for this email only ' + gets[0], gets.length >= 1 && /email=eq\.bab%40example\.test|email=eq\.bab@example\.test/.test(gets[0]) && /status=eq\.new/.test(gets[0]));
  await p.screenshot({ path: SHOTS.desktop, fullPage: true });

  // ---------- Request trial: form, Send ----------
  await p.click('[data-trial="label"]'); await wait(300);
  ok('Request trial opens a small inline form ' + await txt(p, 'li.trialf b'), (await txt(p, 'li.trialf b')) === 'Request a trial of Proview Label' && await p.evaluate(() => !!document.getElementById('trBiz') && !!document.getElementById('trNote') && document.getElementById('trSend').textContent === 'Send'));
  ok('form sits right under the Label row', await p.evaluate(() => document.querySelector('li.trialf').previousElementSibling.dataset.off === 'label'));
  await p.click('#trX'); await wait(150);
  ok('Cancel closes it, nothing sent', !(await p.$('li.trialf')) && posts.length === 0);
  await p.click('[data-trial="label"]'); await wait(200);
  await p.type('#trBiz', 'Brags Cafe'); await p.type('#trNote', 'Two handhelds please');
  await p.click('#trSend'); await wait(700);
  ok('request sent: app, business, note, and NO email from the client ' + JSON.stringify(posts), posts.length === 1 && posts[0].app === 'label' && posts[0].business === 'Brags Cafe' && posts[0].note === 'Two handhelds please' && !('email' in posts[0]) && !('status' in posts[0]));
  ok('stored for the signed-in email ' + JSON.stringify(TABLE[0]), TABLE[0]?.email === C && TABLE[0]?.status === 'new');
  ok('confirmation shown ' + await txt(p, 'li.trialmsg'), /Trial request sent for Proview Label\. We’ll be in touch\./.test(await txt(p, 'li.trialmsg')));
  ok('button becomes "Requested"', (await txt(p, '[data-trial="label"]')).startsWith('Requested') && await p.evaluate(() => document.querySelector('[data-trial="label"]').classList.contains('done')));
  ok('row says when ' + await txt(p, '[data-off="label"] small'), /^Trial requested \d{1,2} \w{3} \d{4}$/.test(await txt(p, '[data-off="label"] small')));
  ok('optional email asked for with the request id ' + JSON.stringify(notifies), notifies.length === 1 && notifies[0].id === TABLE[0].id);
  // second click
  await p.click('[data-trial="label"]'); await wait(200);
  const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  ok('second click: "Requested on <date>, we’ll be in touch" ' + await txt(p, 'li.trialmsg'), (await txt(p, 'li.trialmsg')) === `Requested on ${day}, we’ll be in touch.` && !(await p.$('li.trialf')) && posts.length === 1);
  ok('other inactive apps still offer Request trial', (await txt(p, '[data-trial="wifi"]')).startsWith('Request trial'));
  await p.close();

  // ---------- reload: "Requested" stays; asking again from a stale tab ----------
  p = await open({ email: C, apps: CUSTOMER_APPS });
  ok('after reload Label still shows "Requested"', (await txt(p, '[data-trial="label"]')).startsWith('Requested') && (await txt(p, '[data-trial="qrmenu"]')).startsWith('Request trial'));
  await p.click('[data-trial="label"]'); await wait(200);
  ok('after reload a click shows the date, no form', /^Requested on .+, we’ll be in touch\.$/.test(await txt(p, 'li.trialmsg')) && !(await p.$('li.trialf')));
  // another tab already asked for QR Menu: this page still shows "Request trial"
  TABLE.push({ id: 'bbbbbbbb-0000-4000-8000-000000000001', email: C, app: 'qrmenu', status: 'new', created_at: new Date(Date.now() - 2 * 86400000).toISOString() });
  await p.click('[data-trial="qrmenu"]'); await wait(200); await p.click('#trSend'); await wait(800);
  const d2 = new Date(Date.now() - 2 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  ok('one open request per app: the duplicate shows "Requested on <first date>" ' + await txt(p, 'li.trialmsg'), (await txt(p, 'li.trialmsg')) === `Requested on ${d2}, we’ll be in touch.` && (await txt(p, '[data-trial="qrmenu"]')).startsWith('Requested'));
  await p.close();

  // ---------- 390px ----------
  p = await open({ email: C, apps: CUSTOMER_APPS, width: 390, height: 844 });
  const lay = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth, over = document.documentElement.scrollWidth > vw;
    const rows = [...document.querySelectorAll('li.app')].map((li) => { const r = li.getBoundingClientRect(), b = li.querySelector('button')?.getBoundingClientRect(), t = li.querySelector('.t b').getBoundingClientRect(); return { right: r.right, bR: b ? b.right : 0, bH: b ? b.height : 0, tW: t.width, tR: t.right, tB: t.bottom, bL: b ? b.left : 0, bT: b ? b.top : 0 }; });
    return { vw, over, rows };
  });
  ok('390px: no sideways scrolling ' + JSON.stringify({ vw: lay.vw, over: lay.over }), !lay.over && lay.vw === 390);
  ok('390px: every button inside its row and at least 40px tall', lay.rows.every((r) => r.bR <= r.right && r.bH >= 40));
  // App grid layout (20 Nov 2026): the button sits under the name (tiles, and inactive rows at this width), or beside it.
  ok('390px: names not covered by the buttons', lay.rows.every((r) => (r.tB <= r.bT + 1 || r.tR <= r.bL + 1) && r.tW > 60));
  await p.screenshot({ path: SHOTS.mobile, fullPage: true });
  await p.click('[data-trial="wifi"]'); await wait(250);
  const fl = await p.evaluate(() => { const f = document.querySelector('li.trialf').getBoundingClientRect(); return { r: f.right, vw: document.documentElement.clientWidth, over: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
  ok('390px: the form fits', fl.r <= fl.vw && !fl.over);
  await p.screenshot({ path: SHOTS.form, fullPage: true });
  // an error from the database is shown in the form
  await p.close();
  p = await open({ email: 'new@example.test', apps: CUSTOMER_APPS, width: 390, height: 844, insertError: { code: 'P0001', message: 'Confirm your email address first (check your inbox).' } });
  await p.click('[data-trial="wifi"]'); await wait(200); await p.click('#trSend'); await wait(700);
  ok('a refused request says why and keeps the form ' + await txt(p, 'li.trialf .notice'), /Confirm your email address first/.test(await txt(p, 'li.trialf .notice')) && (await txt(p, '#trSend')) === 'Send' && (await txt(p, '[data-trial="wifi"]')).startsWith('Request trial'));
  await p.close();

  // ---------- no apps at all: only Inactive ----------
  p = await open({ email: 'nobody@example.test', apps: NONE_APPS });
  ok('no apps: only "Inactive apps" ' + await txt(p, '#secInactive'), !(await p.$('#secActive')) && (await txt(p, '#secInactive')) === 'Inactive apps 6');
  await p.close();

  // ---------- the master ----------
  p = await open({ email: 'altun@proviewtech.co.uk', apps: CUSTOMER_APPS, master: true });
  ok('master: note kept ' + await txt(p, '.master-note'), /Customers are opened from the licence portal\./.test(await txt(p, '.master-note')) && !!(await p.$('.master-note a[href="https://license.proviewcrm.co.uk"]')));
  ok('master: both sections too', (await txt(p, '#secActive')) === 'Active apps 2' && (await txt(p, '#secInactive')) === 'Inactive apps 4');
  ok('master: Open on active apps', (await p.$$('li.app [data-app]')).length === 2);
  ok('master: no Request trial (he grants them), says where', !(await p.$('[data-trial]')) && /Grant trials in the licence portal/.test(await txt(p, 'li.app.off .grant')));
  ok('master: his own requests only (the master can read everyone’s) ' + gets[gets.length - 1], /email=eq\.altun/.test(gets[gets.length - 1]));
  await p.screenshot({ path: SHOTS.master, fullPage: true });
  await p.close();

  ok('no page errors ' + JSON.stringify(errs), !errs.length);
  console.log(results.join('\n'));
  const f = results.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${results.length - f} PASS, ${f} FAIL`);
  console.log('Screenshots: ' + Object.values(SHOTS).join(' '));
  await browser.close(); srv.close(); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
