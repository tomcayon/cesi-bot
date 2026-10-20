const https = require('https');
const http = require('http');
const { URL } = require('url');

// ── Cookie jar ────────────────────────────────────────────────────────────────

class CookieJar {
    constructor() { this._jar = {}; }

    ingest(rawHeaders) {
        if (!rawHeaders) return;
        const list = Array.isArray(rawHeaders) ? rawHeaders : [rawHeaders];
        for (const hdr of list) {
            const semIdx = hdr.indexOf(';');
            const kv = semIdx === -1 ? hdr : hdr.slice(0, semIdx);
            const eqIdx = kv.indexOf('=');
            if (eqIdx === -1) continue;
            this._jar[kv.slice(0, eqIdx).trim()] = kv.slice(eqIdx + 1).trim();
        }
    }

    toString() {
        return Object.entries(this._jar).map(([k, v]) => `${k}=${v}`).join('; ');
    }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

function rawRequest(method, urlStr, body, jar) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const mod = url.protocol === 'https:' ? https : http;
        const bodyBuf = body ? Buffer.from(body) : null;

        const headers = {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,*/*',
            'Accept-Language': 'fr-FR,fr;q=0.9',
            'Cookie': jar.toString(),
        };
        if (bodyBuf) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            headers['Content-Length'] = bodyBuf.length;
        }

        const req = mod.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers,
            // sts.viacesi.fr uses an internal corporate CA not trusted by Node.js
            rejectUnauthorized: !url.hostname.endsWith('viacesi.fr'),
        }, (res) => {
            jar.ingest(res.headers['set-cookie']);
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({
                status: res.statusCode,
                location: res.headers.location,
                body: data,
                url: urlStr,
            }));
        });
        req.on('error', reject);
        if (bodyBuf) req.write(bodyBuf);
        req.end();
    });
}

// GET, follows all 3xx redirects
async function navigate(start, jar, maxRedirects = 15) {
    let current = start;
    for (let i = 0; i < maxRedirects; i++) {
        const res = await rawRequest('GET', current, null, jar);
        console.log(`[auth] GET ${current} → ${res.status}`);
        if (res.status >= 300 && res.status < 400 && res.location) {
            current = new URL(res.location, current).href;
            continue;
        }
        return { ...res, url: current };
    }
    throw new Error('Trop de redirections');
}

// POST then follow 3xx
async function postForm(urlStr, fields, jar, maxRedirects = 15) {
    const body = new URLSearchParams(fields).toString();
    let res = await rawRequest('POST', urlStr, body, jar);
    console.log(`[auth] POST ${urlStr} → ${res.status}`);
    let current = urlStr;
    for (let i = 0; i < maxRedirects && res.status >= 300 && res.status < 400 && res.location; i++) {
        current = new URL(res.location, current).href;
        res = await rawRequest('GET', current, null, jar);
        console.log(`[auth] GET ${current} → ${res.status}`);
    }
    return { ...res, url: current };
}

// ── HTML parsing ──────────────────────────────────────────────────────────────

// Decode both decimal (&#42;) and hex (&#x2f;) HTML entities + named ones
function dehtml(s) {
    return s
        .replace(/&amp;/g,  '&')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g,   '<')
        .replace(/&gt;/g,   '>')
        .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&#(\d+);/g,            (_, n) => String.fromCharCode(Number(n)));
}

function extractInput(html, name) {
    const patterns = [
        new RegExp(`<input[^>]+name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i'),
        new RegExp(`<input[^>]+value=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'),
    ];
    for (const re of patterns) {
        const m = html.match(re);
        if (m) return dehtml(m[1]);
    }
    return null;
}

function extractFormAction(html, baseUrl) {
    const m = html.match(/<form[^>]+action=["']([^"']+)["']/i);
    if (!m) return baseUrl;
    return new URL(dehtml(m[1]), baseUrl).href;
}

// Find the ADFS entry point in the page body.
// Returns { method: 'POST'|'GET', url, fields } or null.
// Prefers a form (preserves hidden fields like SAMLRequest) over a bare href.
function findAdfsEntry(html, baseUrl) {
    // 1. Form with action → ADFS (most reliable — carries SAMLRequest as hidden field)
    const formRe = /<form([^>]*)>([\s\S]*?)<\/form>/gi;
    let fm;
    while ((fm = formRe.exec(html)) !== null) {
        const actionM = fm[1].match(/action=["']([^"']+)["']/i);
        if (!actionM) continue;
        const action = dehtml(actionM[1]);
        if (!action.includes('adfs') && !action.includes('sts.viacesi')) continue;

        const fields = {};
        const ir = /<input([^>]*)>/gi;
        let im;
        while ((im = ir.exec(fm[2])) !== null) {
            const nameM  = im[1].match(/name=["']([^"']+)["']/i);
            const valueM = im[1].match(/value=["']([^"']*)["']/i);
            if (nameM) fields[nameM[1]] = dehtml(valueM?.[1] || '');
        }
        return { method: 'POST', url: new URL(action, baseUrl).href, fields };
    }

    // 2. Href link → ADFS (may or may not carry SAMLRequest in query string)
    const linkM = html.match(/href=["']([^"']*(?:adfs|sts\.viacesi)[^"']*)["']/i);
    if (linkM) return { method: 'GET', url: new URL(dehtml(linkM[1]), baseUrl).href, fields: {} };

    // 3. Raw / HTML-encoded URL in the body (JS redirects, etc.)
    const rawM = html.match(/https(?:&#x3a;|:)(?:&#x2f;&#x2f;|\/\/)sts\.viacesi[^"'\s<>]*/i);
    if (rawM) return { method: 'GET', url: dehtml(rawM[0]), fields: {} };

    return null;
}

// Returns all input names in the form (for debug)
function extractAllInputNames(html) {
    const names = [];
    const re = /<input[^>]+name=["']([^"']+)["'][^>]*(type=["']([^"']+)["'])?/gi;
    let m;
    while ((m = re.exec(html)) !== null) names.push(`${m[1]}(${m[3] || 'text'})`);
    return names.join(', ') || '(aucun)';
}

// Try to extract ADFS error message from response body
function extractAdfsError(html) {
    if (!html) return null;
    // Common ADFS error element
    const m = html.match(/<[^>]+id=["']errorText["'][^>]*>([^<]+)</i) ||
              html.match(/class=["'][^"']*error[^"']*["'][^>]*>([^<]{10,200})</i);
    return m ? m[1].trim() : null;
}

function detectEmailField(html) {
    for (const name of ['email', 'Email', 'username', 'Username', 'EmailField', 'login']) {
        if (new RegExp(`name=["']${name}["']`, 'i').test(html)) return name;
    }
    return 'email';
}

// ── Login flow ────────────────────────────────────────────────────────────────

async function login(email, password) {
    const jar = new CookieJar();
    console.log('[auth] Démarrage connexion CESI...');

    // 1. Navigate to protected page — follows chain to wayf or ADFS
    let page = await navigate('https://ent.cesi.fr/mon-emploi-du-temps', jar);

    // 2. Wayf (email discovery) — POST email, then extract ADFS URL from response
    if (page.url.includes('wayf')) {
        console.log('[auth] Page wayf, envoi email...');
        const action = extractFormAction(page.body, page.url);
        const field  = detectEmailField(page.body);
        page = await postForm(action, { [field]: email }, jar);

        // Wayf returns 200 with a page that routes to ADFS
        if (!page.url.includes('adfs') && !page.url.includes('sts.viacesi.fr')) {
            const entry = findAdfsEntry(page.body, page.url);
            if (entry) {
                console.log('[auth] Entrée ADFS trouvée:', entry.method, entry.url);
                console.log('[auth] Champs cachés wayf→ADFS:', Object.keys(entry.fields).join(', ') || '(aucun)');
                page = entry.method === 'POST'
                    ? await postForm(entry.url, entry.fields, jar)
                    : await navigate(entry.url, jar);
            } else {
                console.warn('[auth] Entrée ADFS introuvable. Body wayf (800c):', page.body.slice(0, 800));
            }
        }
    }

    // 3. ADFS login — POST credentials
    if (page.url.includes('adfs') || page.url.includes('sts.viacesi.fr')) {
        console.log('[auth] Page ADFS, envoi des identifiants...');
        const action = extractFormAction(page.body, page.url);
        console.log('[auth] ADFS form action:', action);
        console.log('[auth] Champs détectés:', extractAllInputNames(page.body));

        const fields = { UserName: email, Password: password, AuthMethod: 'FormsAuthentication' };
        for (const name of ['AuthState', '__RequestVerificationToken', 'client-request-id']) {
            const val = extractInput(page.body, name);
            if (val) { fields[name] = val; console.log(`[auth] Champ caché trouvé: ${name}`); }
        }

        page = await postForm(action, fields, jar);
        console.log('[auth] Après ADFS login:', page.url, page.status);

        if (!page.body?.includes('SAMLResponse')) {
            // Likely wrong credentials — log what ADFS returned for diagnosis
            const errorMsg = extractAdfsError(page.body);
            console.error('[auth] SAMLResponse absent après login ADFS.');
            if (errorMsg) console.error('[auth] Message ADFS:', errorMsg);
            console.error('[auth] Body ADFS (800c):', page.body?.slice(0, 800));
            throw new Error(errorMsg || 'ADFS n\'a pas retourné de SAMLResponse — identifiants incorrects ?');
        }
    }

    // 4. SAMLResponse auto-submit form → POST to ENT ACS
    if (page.body?.includes('SAMLResponse')) {
        console.log('[auth] SAMLResponse trouvé, envoi au SP...');
        const samlResponse = extractInput(page.body, 'SAMLResponse');
        const relayState   = extractInput(page.body, 'RelayState');
        const acsUrl       = extractFormAction(page.body, page.url);
        if (!samlResponse) throw new Error('Impossible d\'extraire SAMLResponse');
        const fields = { SAMLResponse: samlResponse };
        if (relayState) fields.RelayState = relayState;
        page = await postForm(acsUrl, fields, jar);
        console.log('[auth] Après ACS:', page.url, page.status);
    }

    const cookieStr = jar.toString();
    // Require cookies from the authenticated ENT session (set after SAML ACS)
    if (!cookieStr.includes('BIGipServer')) {
        console.error('[auth] Cookies obtenus:', cookieStr || '(vide)');
        console.error('[auth] URL finale:', page.url, '| Status:', page.status);
        console.error('[auth] Body (500c):', page.body?.slice(0, 500));
        throw new Error('Session ENT non obtenue après SAML');
    }

    console.log('[auth] Connexion réussie ✓');
    return cookieStr;
}

// ── Session cache ─────────────────────────────────────────────────────────────

// One session per account (email)
const _cache = new Map();

async function getCachedOrLogin(email, password, forceRefresh = false) {
    const entry = _cache.get(email);
    if (!forceRefresh && entry && Date.now() < entry.expiry) return entry.cookie;
    const cookie = await login(email, password);
    _cache.set(email, { cookie, expiry: Date.now() + 25 * 60 * 1000 }); // 25 min
    return cookie;
}

module.exports = { getCachedOrLogin };
