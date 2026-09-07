/* ============================================================================
   sw.js
   Cache-first app shell so the robot keeps running with no network at
   all after the first successful load. Bump CACHE_NAME when shipping a
   new version so old clients pick up the update instead of serving a
   stale cache forever.
   ========================================================================== */
"use strict";

var CACHE_NAME = "companion-robot-v1";
var SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./audio.js",
  "./sensors.js",
  "./robot.js",
  "./input.js",
  "./main.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(SHELL_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
             .map(function (n) { return caches.delete(n); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var network = fetch(event.request).then(function (response) {
        if (response && response.status === 200 && response.type === "basic") {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () { return cached; });

      // Cache-first: instant load offline, silently refresh the cache in
      // the background when a connection is available.
      return cached || network;
    })
  );
});
