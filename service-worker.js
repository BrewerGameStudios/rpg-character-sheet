// service-worker.js - RPG Character Sheet PWA
const CACHE_NAME = 'rpg-character-sheet-v2.2.0';  // **************************UPDATE VERSION NUMBER WHEN UPDATING ***************************************
const urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    './icon192.png',
    './icon512.png'
];

// 1. Install event - cache files and skip waiting
self.addEventListener('install', event => {
    console.log('Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache and adding assets');
                return cache.addAll(urlsToCache);
            })
    );
    // Forces the waiting service worker to become the active service worker immediately
    self.skipWaiting();
});

// 2. Activate event - clean up old caches and claim clients
self.addEventListener('activate', event => {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            // Take control of all open tabs immediately
            return self.clients.claim();
        })
    );
});

// 3. Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response
                if (response) {
                    return response;
                }

                const fetchRequest = event.request.clone();

                return fetch(fetchRequest).then(response => {
                    // Check if we received a valid response
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }

                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });

                    return response;
                }).catch(error => {
                    console.log('Fetch failed; user is likely offline.', error);
                });
            })
    );
});