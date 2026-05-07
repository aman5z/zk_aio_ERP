// Service Worker — handles notifications when browser is closed
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// When notification is clicked — open the alert page
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // If alert tab already open, focus it
      for (const client of list) {
        if (client.url.includes('/alert') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new tab
      if (clients.openWindow) return clients.openWindow('/alert');
    })
  );
});

// Keep service worker alive — reconnect SSE in background
// Note: full SSE not possible in SW, but notification delivery works via showNotification
// called from the main page's navigator.serviceWorker.ready
