/**
 * cloudflare_worker.js
 * Ce fichier est à déployer sur Cloudflare Workers.
 * Il sert de proxy et de cache pour Google Apps Script.
 */

// REMPLACEZ CECI PAR L'URL DE VOTRE DÉPLOIEMENT WEB APP GOOGLE SCRIPT
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzUcADa5RmJRqTk4rWO1Hw6dXLanAly1iWM-iA2CyTNJRETDVecAp32hEXi-pl-isWJew/exec";

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // 1. Gérer les requêtes OPTIONS (CORS) pour autoriser les appels depuis votre site
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*', // Ou mettez 'https://mahu.cards' pour plus de sécurité
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // 2. Intercepter les requêtes POST pour le cache
  if (request.method === 'POST') {
    try {
      // On clone la requête pour lire le corps sans le consommer pour le fetch suivant
      const clone = request.clone();
      const formData = await clone.formData();
      const action = formData.get('action');

      // 1. ACTIONS DE LECTURE (À METTRE EN CACHE)
      // Ce sont les actions qui doivent être ultra-rapides (<50ms)
      const READ_ACTIONS = [
        'getPublicProfile', // Nom supposé pour le profil public
        'getProfileData',   // Autre nom possible
        'getBlogPosts',
        'getProducts'
      ];

      // 2. ACTIONS D'ÉCRITURE (QUI VIDE LE CACHE)
      // Quand ces actions réussissent, on efface le cache du profil pour que la mise à jour soit visible
      const WRITE_ACTIONS = [
        'saveProfile',
        'updateProfile',
        'editCard',
        'updateSettings',
        'saveProfileImage'
      ];

      // --- CAS 1 : C'est une modification (WRITE) ---
      if (WRITE_ACTIONS.includes(action)) {
        // On envoie d'abord la donnée à Google
        const response = await fetch(GOOGLE_SCRIPT_URL, request);

        // Si la sauvegarde a réussi (Status 200), on vide le cache du profil public
        if (response.status === 200) {
          const userParam = formData.get('user') || formData.get('id') || formData.get('email') || formData.get('Email');
          
          if (userParam) {
            // On reconstruit la clé de cache du profil public pour la supprimer
            // Note : On cible ici l'action 'getProfileData' car c'est elle qui est utilisée par ProfilePublic.html
            const cacheUrl = new URL(request.url);
            cacheUrl.pathname = `/cache/getProfileData`; 
            cacheUrl.searchParams.set('u', userParam.toString());
            
            const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
            await caches.default.delete(cacheKey);
            // On peut aussi supprimer 'getProfileData' si nécessaire
          }
        }
        
        return response;
      }

      // --- CAS 2 : C'est une lecture (READ) ---
      if (READ_ACTIONS.includes(action)) {
        // --- LOGIQUE DE CACHE ---
        
        // On construit une clé de cache unique basée sur les paramètres de la requête
        const userParam = formData.get('user') || formData.get('id') || formData.get('email');
        const payload = formData.get('payload');
        
        // On crée une URL fictive pour le système de cache (le cache utilise des clés URL GET)
        const cacheUrl = new URL(request.url);
        cacheUrl.pathname = `/cache/${action}`;
        
        if (userParam) cacheUrl.searchParams.set('u', userParam.toString());
        if (payload) cacheUrl.searchParams.set('p', payload.toString()); // Attention si le payload est gros

        const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
        const cache = caches.default;

        // Vérifier si la réponse est déjà en cache
        let response = await cache.match(cacheKey);

        if (response) {
          // HIT : On renvoie la réponse du cache (< 50ms)
          const newHeaders = new Headers(response.headers);
          newHeaders.set('X-Worker-Cache', 'HIT');
          newHeaders.set('Access-Control-Allow-Origin', '*');
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
          });
        }

        // MISS : On appelle Google Apps Script
        response = await fetch(GOOGLE_SCRIPT_URL, request);

        // Si la réponse est valide, on la met en cache
        if (response.status === 200) {
          const responseToCache = response.clone();
          const headers = new Headers(responseToCache.headers);
          
          // Configuration du cache : 
          // s-maxage=86400 : Le cache reste 24h sur les serveurs Cloudflare.
          // stale-while-revalidate=604800 : Si le cache est périmé (après 24h), on le sert QUAND MÊME immédiatement, 
          // et on met à jour en arrière-plan. (Valable 1 semaine).
          headers.set('Cache-Control', 'public, s-maxage=86400, max-age=3600, stale-while-revalidate=604800');
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('X-Worker-Cache', 'MISS');

          const cachedResponse = new Response(responseToCache.body, {
            status: responseToCache.status,
            statusText: responseToCache.statusText,
            headers: headers
          });

          // Sauvegarder dans le cache Cloudflare
          event.waitUntil(cache.put(cacheKey, cachedResponse));
          
          return cachedResponse;
        }
        
        return response;
      }
    } catch (e) {
      // En cas d'erreur de lecture (ex: pas de FormData), on ignore le cache et on passe à la suite
      console.error("Erreur Worker Cache:", e);
    }
  }

  // 3. Fallback : Pour tout le reste (Login, Connexion, etc.), on passe directement à Google sans cache
  const response = await fetch(GOOGLE_SCRIPT_URL, request);
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  return newResponse;
}
