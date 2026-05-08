let permissionState: NotificationPermission | null = null;

export function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    permissionState = 'granted';
    return;
  }
  if (Notification.permission === 'denied') {
    permissionState = 'denied';
    return;
  }
  Notification.requestPermission().then(p => {
    permissionState = p;
  });
}

export function notify(title: string, body?: string) {
  if (!('Notification' in window)) return;
  if (permissionState !== 'granted' && Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    new Notification(title, { body, icon: '/favicon.ico' });
  } catch {
    // Safari/iOS may throw
  }
}
