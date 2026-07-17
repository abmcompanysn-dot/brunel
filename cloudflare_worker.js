/**
 * cloudflare_worker.js — Mahu Profile Worker
 * Proxy + Cache pour Google Apps Script.
 * Objectif : profils publics servis en < 500ms.
 *
 * Architecture du cache :
 *  GET /profile/{slug}  → Edge cache Cloudflare + stale-while-revalidate (ULTRA RAPIDE)
 *  POST (autres)        → Proxy direct + cache synthétique pour les lectures
 */

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzUcADa5RmJRqTk4rWO1Hw6dXLanAly1iWM-iA2CyTNJRETDVecAp32hEXi-pl-isWJew/exec";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Actions POST qui modifient des données → purge le cache après
const WRITE_ACTIONS = new Set([
  'saveProfile', 'updateProfile', 'editCard', 'updateSettings',
  'saveProfileImage', 'quickRegisterAndActivate', 'activateCard',
  'activatePhysicalCard', 'registerUser'
]);

// Actions POST de lecture → cache synthétique (compatibilité)
const READ_ACTIONS = new Set([
  'getPublicProfile', 'getProfileData', 'getBlogPosts',
  'getProducts', 'checkCardStatus'
]);

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

// ─────────────────────────────────────────────────────────────────
// ROUTEUR PRINCIPAL
// ─────────────────────────────────────────────────────────────────
async function handleRequest(request, event) {
  // Préflight CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);

  // ══════════════════════════════════════════════════════════════
  // GET /profile/{slug}
  // C'est le chemin le plus rapide pour afficher un profil public.
  // ProfilePublic.html appelle directement cet endpoint (GET, pas POST).
  // Cloudflare cache nativement les réponses GET à l'edge.
  // ══════════════════════════════════════════════════════════════
  const profileMatch = url.pathname.match(/^\/profile\/([a-z0-9][a-z0-9-]{0,60})$/i);
  if (request.method === 'GET' && profileMatch) {
    return serveProfile(profileMatch[1], request, event);
  }

  // ══════════════════════════════════════════════════════════════
  // GET /share/{slug}
  // Endpoint pour le partage social (Facebook, WhatsApp, LinkedIn, Twitter).
  // Retourne une page HTML avec les meta OG remplies dynamiquement.
  // Les bots sociaux lisent les OG tags → aperçu avec photo + nom + titre.
  // Les navigateurs humains sont redirigés vers le profil public.
  // ══════════════════════════════════════════════════════════════
  const shareMatch = url.pathname.match(/^\/share\/([a-z0-9][a-z0-9-]{0,60})$/i);
  if (request.method === 'GET' && shareMatch) {
    return serveSharePage(shareMatch[1], request, event);
  }

  // ══════════════════════════════════════════════════════════════
  // GET /widget.js?user={slug}
  // Widget flottant embarquable (façon Tawk.to) que n'importe quel
  // utilisateur Mahu peut coller sur son PROPRE site web externe :
  //   <script src="https://.../widget.js?user=SLUG" async></script>
  // Les visiteurs du site laissent un message + une note ; le tout
  // remonte au propriétaire par email et dans son Dashboard (Prospects).
  // ══════════════════════════════════════════════════════════════
  if (request.method === 'GET' && url.pathname === '/widget.js') {
    return serveWidgetScript(url.searchParams.get('user') || '', url, event);
  }

  // POST → proxy + logique de cache
  if (request.method === 'POST') {
    return handlePost(request, event);
  }

  // Health check
  return new Response(JSON.stringify({ status: 'Mahu Worker en ligne' }), {
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

// ─────────────────────────────────────────────────────────────────
// GET /profile/{slug} — Endpoint ultra-rapide (< 50ms en cache)
// ─────────────────────────────────────────────────────────────────
async function serveProfile(slug, request, event) {
  const cache = caches.default;

  // Clé de cache normalisée (minuscules)
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = '/profile/' + slug.toLowerCase();
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  // ── Tentative de lecture depuis le cache Edge ──
  let cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  // ── MISS : appel à Google Apps Script ──
  const fd = new FormData();
  fd.append('action', 'getProfileData');
  fd.append('user', slug);

  let gasRes;
  try {
    gasRes = await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: fd });
  } catch (e) {
    return jsonError('Erreur réseau serveur.', 502);
  }

  const body = await gasRes.text();

  // Ne pas mettre en cache les erreurs applicatives
  try {
    const parsed = JSON.parse(body);
    if (parsed.error) {
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS, 'X-Cache': 'MISS-ERROR' }
      });
    }
  } catch (_) {}

  // ── Réponse à mettre en cache ──
  // s-maxage=86400 : Cloudflare garde 24h (profil servi < 50ms)
  // stale-while-revalidate=604800 : après 24h, sert le cache ET revalide en arrière-plan
  // Le résultat : l'utilisateur ne voit JAMAIS une page lente après la 1ère visite.
  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS,
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      'X-Cache': 'MISS'
    }
  });

  event.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}

// ─────────────────────────────────────────────────────────────────
// GET /share/{slug} — Page HTML avec meta OG pour partage social
// ─────────────────────────────────────────────────────────────────
async function serveSharePage(slug, request, event) {
  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = '/share/' + slug.toLowerCase();
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  // Vérifier le cache (1h pour les pages de partage)
  let cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  // Récupérer les données du profil
  const fd = new FormData();
  fd.append('action', 'getProfileData');
  fd.append('user', slug);

  let profileData = {};
  try {
    const gasRes = await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: fd });
    profileData = await gasRes.json();
  } catch (_) {}

  const profileUrl = `https://mahu.cards/ProfilePublic.html?user=${encodeURIComponent(slug)}&source=Share`;
  const name = esc(profileData.Nom_Complet || slug);
  const profession = esc(profileData.Profession || '');
  const company = esc(profileData.Compagnie || '');
  const subtitle = [profession, company].filter(Boolean).join(' · ');
  const description = subtitle
    ? `${name} — ${subtitle}. Découvrez son profil digital sur Mahu.`
    : `Découvrez le profil digital de ${name} sur Mahu Cards.`;
  const image = profileData.URL_Photo || 'https://mahu.cards/r/og-image.png';
  const pageTitle = subtitle ? `${name} — ${subtitle}` : name;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${description}">

<!-- Open Graph (Facebook, WhatsApp, LinkedIn) -->
<meta property="og:type" content="profile">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="400">
<meta property="og:image:height" content="400">
<meta property="og:url" content="${profileUrl}">
<meta property="og:site_name" content="Mahu Cards">
<meta property="og:locale" content="fr_FR">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">

<!-- Schema.org Person -->
<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":"Person",
  "name":"${esc(profileData.Nom_Complet || slug)}",
  "jobTitle":"${esc(profileData.Profession || '')}",
  "worksFor":{"@type":"Organization","name":"${esc(profileData.Compagnie || '')}"},
  "email":"${esc(profileData.Email || '')}",
  "telephone":"${esc(profileData.Telephone || '')}",
  "image":"${image}",
  "url":"${profileUrl}",
  "sameAs":[]
}
</script>

<link rel="canonical" href="${profileUrl}">
<meta http-equiv="refresh" content="0;url=${profileUrl}">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0a0a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{text-align:center;max-width:360px}
  .avatar{width:88px;height:88px;border-radius:50%;object-fit:cover;border:3px solid #4da6ff;margin-bottom:16px}
  .avatar-placeholder{width:88px;height:88px;border-radius:50%;background:#1a1a1a;border:3px solid #4da6ff;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:2em}
  h1{font-size:1.35em;font-weight:700;margin-bottom:6px}
  .sub{color:#888;font-size:0.88em;margin-bottom:24px}
  .cta{display:inline-block;background:#4da6ff;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:0.92em}
  .brand{margin-top:24px;font-size:0.72em;color:#444}
</style>
</head>
<body>
<div class="card">
  ${profileData.URL_Photo
    ? `<img class="avatar" src="${profileData.URL_Photo}" alt="${name}" onerror="this.style.display='none'">`
    : `<div class="avatar-placeholder">👤</div>`}
  <h1>${name}</h1>
  <p class="sub">${subtitle || 'Mahu — Profil digital'}</p>
  <a class="cta" href="${profileUrl}">Voir le profil complet</a>
  <p class="brand">Propulsé par Mahu Cards</p>
</div>
<script>setTimeout(()=>window.location.replace("${profileUrl}"),800);</script>
</body>
</html>`;

  const response = new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*',
      'X-Cache': 'MISS'
    }
  });

  event.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// Échappe les caractères HTML pour éviter les injections dans les meta tags
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────────────
// GET /widget.js — Widget flottant embarquable sur un site externe
// ─────────────────────────────────────────────────────────────────
async function serveWidgetScript(rawSlug, url, event) {
  const slug = String(rawSlug).trim().toLowerCase();

  if (!/^[a-z0-9-]{1,60}$/.test(slug)) {
    return new Response(
      'console.error("Mahu Widget: identifiant de profil manquant ou invalide (utilisez ?user=votre-slug).");',
      { status: 200, headers: { 'Content-Type': 'application/javascript; charset=utf-8', ...CORS } }
    );
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const scriptBody = '(' + mahuWidgetClient.toString() + ')(' +
    JSON.stringify(slug) + ',' + JSON.stringify(url.origin + '/') + ');';

  const response = new Response(scriptBody, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      ...CORS,
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800'
    }
  });

  event.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// Code client du widget. Écrit comme une vraie fonction (et non une string à la main)
// puis converti via .toString() dans serveWidgetScript — ça évite l'enfer de l'échappement
// de guillemets/backticks et garde ce code lisible et éditable normalement.
function mahuWidgetClient(SLUG, API) {
  if (window.__mahuWidgetLoaded) return;
  window.__mahuWidgetLoaded = true;

  var LOGO_URL = 'https://mahu.cards/r/logo.png';

  var css = '.mahu-w-btn{position:fixed;bottom:22px;right:22px;width:58px;height:58px;border-radius:50%;background:#4da6ff;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483000;transition:transform .2s ease;overflow:hidden}' +
    '.mahu-w-btn:hover{transform:scale(1.08)}' +
    '.mahu-w-btn img{width:34px;height:34px;border-radius:50%;object-fit:cover}' +
    '.mahu-w-panel{position:fixed;bottom:90px;right:22px;width:320px;max-width:90vw;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.25);z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;display:none}' +
    '.mahu-w-panel.mahu-open{display:block}' +
    '.mahu-w-head{background:#000;color:#fff;padding:16px 18px;position:relative}' +
    '.mahu-w-close{position:absolute;top:12px;right:14px;cursor:pointer;color:#fff;font-size:18px;line-height:1}' +
    '.mahu-w-owner{display:flex;align-items:center;gap:10px}' +
    '.mahu-w-avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;background:#222;flex-shrink:0}' +
    '.mahu-w-owner-name{font-size:14px;font-weight:600}' +
    '.mahu-w-owner-email{font-size:11px;color:#aaa;margin-top:2px;word-break:break-all}' +
    '.mahu-w-body{padding:16px 18px}' +
    '.mahu-w-stars{display:flex;gap:4px;justify-content:center;margin-bottom:12px}' +
    '.mahu-w-star{font-size:24px;cursor:pointer;color:#ddd;user-select:none}' +
    '.mahu-w-star.mahu-active{color:#ffb400}' +
    '.mahu-w-input{width:100%;padding:9px 10px;margin-bottom:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;font-family:inherit}' +
    'textarea.mahu-w-input{resize:vertical;min-height:60px}' +
    '.mahu-w-send{width:100%;padding:10px;background:#000;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}' +
    '.mahu-w-send:disabled{opacity:.5;cursor:default}' +
    '.mahu-w-foot{text-align:center;padding:8px;font-size:10px;color:#999}' +
    '.mahu-w-foot a{color:#4da6ff;text-decoration:none}' +
    '.mahu-w-msg{font-size:12px;text-align:center;margin-top:8px;min-height:14px}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var btn = document.createElement('div');
  btn.className = 'mahu-w-btn';
  btn.innerHTML = '<img src="' + LOGO_URL + '" alt="Mahu">';

  var panel = document.createElement('div');
  panel.className = 'mahu-w-panel';
  panel.innerHTML =
    '<div class="mahu-w-head">' +
      '<span class="mahu-w-close">&times;</span>' +
      '<div class="mahu-w-owner">' +
        '<img class="mahu-w-avatar" src="' + LOGO_URL + '" alt="">' +
        '<div>' +
          '<div class="mahu-w-owner-name">Laissez un message</div>' +
          '<div class="mahu-w-owner-email"></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="mahu-w-body">' +
      '<div class="mahu-w-stars"></div>' +
      '<input class="mahu-w-input" type="text" placeholder="Votre nom">' +
      '<input class="mahu-w-input" type="text" placeholder="Email ou téléphone (optionnel)">' +
      '<textarea class="mahu-w-input" placeholder="Votre message (optionnel)"></textarea>' +
      '<button class="mahu-w-send">Envoyer</button>' +
      '<div class="mahu-w-msg"></div>' +
    '</div>' +
    '<div class="mahu-w-foot">Propulsé par <a href="https://mahu.cards" target="_blank" rel="noopener">Mahu</a></div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  // Personnalise l'en-tête avec la photo, le nom et l'email du propriétaire du profil
  var avatarEl = panel.querySelector('.mahu-w-avatar');
  var ownerNameEl = panel.querySelector('.mahu-w-owner-name');
  var ownerEmailEl = panel.querySelector('.mahu-w-owner-email');
  avatarEl.onerror = function () { avatarEl.src = LOGO_URL; };
  fetch(API + 'profile/' + encodeURIComponent(SLUG))
    .then(function (r) { return r.json(); })
    .then(function (p) {
      if (!p || p.error) return;
      if (p.Nom_Complet) ownerNameEl.textContent = p.Nom_Complet;
      if (p.Email) ownerEmailEl.textContent = p.Email;
      if (p.URL_Photo) avatarEl.src = p.URL_Photo;
    })
    .catch(function () {});

  var starsWrap = panel.querySelector('.mahu-w-stars');
  var rating = 0;
  for (var i = 1; i <= 5; i++) {
    (function (n) {
      var s = document.createElement('span');
      s.className = 'mahu-w-star';
      s.textContent = '★';
      s.addEventListener('click', function () {
        rating = n;
        var all = starsWrap.querySelectorAll('.mahu-w-star');
        all.forEach(function (el, idx) { el.classList.toggle('mahu-active', idx < n); });
      });
      starsWrap.appendChild(s);
    })(i);
  }

  var nameInput = panel.querySelectorAll('input')[0];
  var contactInput = panel.querySelectorAll('input')[1];
  var messageInput = panel.querySelector('textarea');
  var sendBtn = panel.querySelector('.mahu-w-send');
  var statusEl = panel.querySelector('.mahu-w-msg');

  btn.addEventListener('click', function () { panel.classList.toggle('mahu-open'); });
  panel.querySelector('.mahu-w-close').addEventListener('click', function () { panel.classList.remove('mahu-open'); });

  sendBtn.addEventListener('click', function () {
    var name = nameInput.value.trim();
    var contact = contactInput.value.trim();
    if (!name) {
      statusEl.style.color = '#c0392b';
      statusEl.textContent = 'Merci de renseigner votre nom.';
      return;
    }
    sendBtn.disabled = true;
    statusEl.style.color = '#666';
    statusEl.textContent = 'Envoi...';

    var fd = new FormData();
    fd.append('action', 'submitWidgetMessage');
    fd.append('profileUrl', SLUG);
    fd.append('name', name);
    fd.append('contact', contact);
    fd.append('message', messageInput.value.trim());
    fd.append('rating', String(rating));

    fetch(API, { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.success) {
          statusEl.style.color = '#2e7d32';
          statusEl.textContent = 'Message envoyé, merci !';
          nameInput.value = '';
          contactInput.value = '';
          messageInput.value = '';
          rating = 0;
          starsWrap.querySelectorAll('.mahu-w-star').forEach(function (el) { el.classList.remove('mahu-active'); });
          setTimeout(function () { panel.classList.remove('mahu-open'); statusEl.textContent = ''; }, 2500);
        } else {
          statusEl.style.color = '#c0392b';
          statusEl.textContent = (res && res.error) || 'Une erreur est survenue.';
        }
      })
      .catch(function () {
        statusEl.style.color = '#c0392b';
        statusEl.textContent = 'Erreur réseau, réessayez.';
      })
      .then(function () { sendBtn.disabled = false; });
  });
}

// ─────────────────────────────────────────────────────────────────
// POST — Toutes les autres actions
// ─────────────────────────────────────────────────────────────────
async function handlePost(request, event) {
  let action = '';
  let formData = null;

  try {
    const clone = request.clone();
    formData = await clone.formData();
    action = formData.get('action') || '';
  } catch (_) {}

  // ── Actions d'écriture → proxy direct + purge cache ──
  if (WRITE_ACTIONS.has(action)) {
    const response = await fetch(GOOGLE_SCRIPT_URL, request);

    if (response.status === 200 && formData) {
      // Lire la réponse GAS pour récupérer urlsToPurge (les 3 slugs possibles du profil)
      // On clone car le body ne peut être lu qu'une fois
      const responseClone = response.clone();

      event.waitUntil((async () => {
        try {
          const data = await responseClone.json();

          // GAS retourne urlsToPurge = [URL_Profil, URL_Profil_2, URL_Profil_3]
          const urlsToPurge = new Set(
            [
              ...(Array.isArray(data.urlsToPurge) ? data.urlsToPurge : []),
              formData.get('slug') || '',
              formData.get('user') || '',
            ]
            .map(u => String(u).trim().toLowerCase())
            .filter(u => u.length > 0)
          );

          await Promise.all([...urlsToPurge].map(u => purgeProfileCache(u, request.url)));
        } catch (_) {
          // Fallback : purge par le slug du formulaire uniquement
          const slug = (
            formData.get('slug') || formData.get('user') || formData.get('id') ||
            formData.get('email') || formData.get('Email') || ''
          ).toLowerCase().trim();
          if (slug) await purgeProfileCache(slug, request.url);
        }
      })());
    }

    const out = new Response(response.body, response);
    out.headers.set('Access-Control-Allow-Origin', '*');
    return out;
  }

  // ── getProfileData via POST (compatibilité avec l'ancien code) ──
  // On le redirige vers la logique GET pour bénéficier du même cache.
  if (action === 'getProfileData' && formData) {
    const slug = (formData.get('user') || formData.get('id') || '').trim();
    if (slug) {
      const getUrl = new URL(request.url);
      getUrl.pathname = '/profile/' + slug.toLowerCase();
      const fakeGet = new Request(getUrl.toString(), { method: 'GET' });
      return serveProfile(slug, fakeGet, event);
    }
  }

  // ── Autres actions de lecture → cache synthétique (POST → clé GET fictive) ──
  if (READ_ACTIONS.has(action) && formData) {
    const userParam = formData.get('user') || formData.get('id') || formData.get('email') || '';
    const cacheUrl = new URL(request.url);
    cacheUrl.pathname = '/cache/' + action;
    if (userParam) cacheUrl.searchParams.set('u', userParam);

    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    const cache = caches.default;

    let cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Cache', 'HIT');
      return new Response(cached.body, { status: cached.status, headers });
    }

    const response = await fetch(GOOGLE_SCRIPT_URL, request);
    if (response.status === 200) {
      const toCache = response.clone();
      const headers = new Headers(toCache.headers);
      headers.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('X-Cache', 'MISS');
      const cacheResp = new Response(toCache.body, { status: toCache.status, headers });
      event.waitUntil(cache.put(cacheKey, cacheResp));
      return cacheResp;
    }
    return response;
  }

  // ── Fallback : tout le reste (login, leads, etc.) → proxy direct ──
  const response = await fetch(GOOGLE_SCRIPT_URL, request);
  const out = new Response(response.body, response);
  out.headers.set('Access-Control-Allow-Origin', '*');
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Purge du cache pour un profil (GET + POST synthétique)
// ─────────────────────────────────────────────────────────────────
async function purgeProfileCache(slug, workerUrl) {
  const base = new URL(workerUrl);
  const cache = caches.default;

  // 1. Clé GET principale (nouveau format)
  base.pathname = '/profile/' + slug;
  await cache.delete(new Request(base.toString(), { method: 'GET' }));

  // 2. Clés POST synthétiques (compatibilité)
  for (const act of ['getProfileData', 'getPublicProfile']) {
    base.pathname = '/cache/' + act;
    base.search = '?u=' + slug;
    await cache.delete(new Request(base.toString(), { method: 'GET' }));
  }
}

// ─────────────────────────────────────────────────────────────────
// Utilitaire
// ─────────────────────────────────────────────────────────────────
function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}
