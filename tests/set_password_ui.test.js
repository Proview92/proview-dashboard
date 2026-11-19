// Proview dashboard: a dashboard invite (type=invite) or "choose a password" link (type=recovery) from the licence portal
// lands on a clear "Set your password" form, saves the password, and opens the person's apps signed in. Headless Chrome
// with a mocked Supabase Auth and sso-assert. Usage: node tests/set_password_ui.test.js (screenshots go to the temp folder).
const puppeteer = require('/opt/npm-tools/node_modules/puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..'), PORT = 8772, BASE = `http://127.0.0.1:${PORT}/`;
const results = []; const ok = (n, c) => results.push((c ? 'PASS ' : 'FAIL ') + n);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(new URL(q.url, BASE).pathname)); fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : 'text/plain' }); s.end(b); }); }).listen(PORT);
const EMAIL = 'babnewington@gmail.com', UID = '22222222-2222-2222-2222-222222222222';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: UID, email: EMAIL, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
const user = { id: UID, email: EMAIL, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} };
const linkHash = (type) => `#access_token=${jwt()}&expires_at=${Math.floor(Date.now() / 1000) + 3600}&expires_in=3600&refresh_token=rt&token_type=bearer&type=${type}`;
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const errs = [], puts = [], signins = [];
  const open = async (url, { clear = true } = {}) => {
    const page = await browser.newPage(); await page.setViewport({ width: 420, height: 860 });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (u.startsWith(BASE) || u.includes('cdn.jsdelivr.net')) return r.continue();
      if (u.includes('esm.sh/@supabase/supabase-js')) return r.respond({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: "export * from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';" });
      const j = (b, s = 200) => r.respond({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(b) });
      if (r.method() === 'OPTIONS') return j({});
      if (u.includes('/auth/v1/user') && r.method() === 'PUT') { puts.push(JSON.parse(r.postData() || '{}')); return j(user); }
      if (u.includes('/auth/v1/user')) return j(user);
      if (u.includes('/auth/v1/token')) { signins.push(JSON.parse(r.postData() || '{}')); return j({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400); }
      if (u.includes('/auth/v1/logout')) return j({});
      if (u.includes('/rpc/is_lic_admin')) return j(false);
      if (u.includes('/functions/v1/sso-assert')) return j({ apps: [{ app: 'signage', name: 'Proview Signage', ok: true }, { app: 'team', name: 'Proview Team', ok: true }, { app: 'bookings', name: 'Proview Bookings', ok: true }, { app: 'employee', name: 'Proview Employee', ok: true }] });
      return j({});
    });
    if (clear) { await page.goto(BASE + 'README.md'); await page.evaluate(() => localStorage.clear()); }
    await page.goto(url, { waitUntil: 'networkidle0' }); await wait(700);
    return page;
  };
  const txt = (p, s) => p.evaluate((s) => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || '', s);
  const setPw = async (p, a, b) => { await p.evaluate((a, b) => { document.getElementById('n1').value = a; document.getElementById('n2').value = b; document.getElementById('go').click(); }, a, b); await wait(800); };

  // ---------- invite link ----------
  let p = await open(BASE + 'index.html' + linkHash('invite'));
  ok('invite link: "Set your password" ' + await txt(p, 'h1'), (await txt(p, 'h1')) === 'Set your password');
  const sub = await txt(p, '.sub');
  ok('invite link: welcome text names the email ' + sub, /Welcome to Proview/.test(sub) && sub.includes(EMAIL));
  ok('invite link: two password boxes and "Set password and continue"', await p.evaluate(() => !!document.getElementById('n1') && !!document.getElementById('n2') && document.getElementById('go').textContent === 'Set password and continue'));
  ok('invite link: tokens cleared from the address bar', !(await p.evaluate(() => location.hash)).includes('access_token'));
  await p.screenshot({ path: path.join(os.tmpdir(), 'dash-set-password.png') });
  await setPw(p, 'short', 'short');
  ok('too short refused', /at least 8/i.test(await txt(p, '.notice')) && !puts.length);
  await setPw(p, 'GoodPass123', 'Different123');
  ok('mismatch refused', /don’t match/.test(await txt(p, '.notice')) && !puts.length);
  await setPw(p, 'GoodPass123', 'GoodPass123'); await wait(500);
  ok('password saved with updateUser ' + JSON.stringify(puts), puts.length === 1 && puts[0].password === 'GoodPass123');
  ok('then signed in: "Your Proview apps" ' + await txt(p, 'h1'), (await txt(p, 'h1')) === 'Your Proview apps' && (await txt(p, '.who')).includes(EMAIL));
  ok('welcome note after setting the password ' + await txt(p, '.notice'), /Password set\. Welcome to Proview\./.test(await txt(p, '.notice')));
  const apps = await p.evaluate(() => [...document.querySelectorAll('.apps .app b')].map((b) => b.textContent));
  ok('HIDDEN kept: Bookings and Employee not listed ' + JSON.stringify(apps), apps.includes('Proview Signage') && apps.includes('Proview Team') && !apps.some((a) => /Bookings|Employee/.test(a)));
  // reload: still signed in, no password form again
  await p.goto(BASE + 'index.html', { waitUntil: 'networkidle0' }); await wait(700);
  ok('reload: stays signed in on the apps list', (await txt(p, 'h1')) === 'Your Proview apps');
  await p.close();

  // ---------- recovery link ("choose a password", e.g. New business or an account made before) ----------
  p = await open(BASE + 'index.html' + linkHash('recovery'));
  const rs = await txt(p, '.sub');
  ok('recovery link: "Set your password" too ' + await txt(p, 'h1') + ' / ' + rs, (await txt(p, 'h1')) === 'Set your password' && rs.includes(EMAIL) && !/Welcome/.test(rs));
  await setPw(p, 'Another123', 'Another123'); await wait(500);
  ok('recovery: saved and signed in', puts.length === 2 && (await txt(p, 'h1')) === 'Your Proview apps' && /Password saved/.test(await txt(p, '.notice')));
  // Change password while signed in keeps its own wording
  await p.evaluate(() => document.getElementById('chg').click()); await wait(400);
  ok('Change password (signed in): "Choose a new password"', (await txt(p, 'h1')) === 'Choose a new password');
  await p.close();

  // ---------- expired / used link ----------
  p = await open(BASE + 'index.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  ok('expired link: sign-in form says why ' + await txt(p, '.notice'), (await txt(p, 'h1')) === 'Sign in' && /Email link is invalid or has expired/.test(await txt(p, '.notice')));
  // wrong password: a hint about the invite
  await p.evaluate(() => { document.getElementById('em').value = 'nobody@x.test'; document.getElementById('pw').value = 'whatever1'; document.getElementById('go').click(); }); await wait(800);
  ok('wrong email/password mentions the invite email ' + await txt(p, '.notice'), /isn’t right/.test(await txt(p, '.notice')) && /invite email/.test(await txt(p, '.notice')));
  await p.close();

  ok('no page errors ' + JSON.stringify(errs), !errs.length);
  console.log(results.join('\n'));
  const f = results.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${results.length - f} PASS, ${f} FAIL`);
  await browser.close(); srv.close(); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
