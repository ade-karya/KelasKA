/**
 * Capacitor Push Notification Helper
 * Initializes FCM permissions, gets token, and submits registration to backend.
 */

export async function initializePushNotifications() {
  if (typeof window === 'undefined') return;

  try {
    const { Capacitor } = await import('@capacitor/core');
    
    // Only execute when running inside native Android/iOS wrapper
    if (!Capacitor.isNativePlatform()) {
      console.log('FCM Push Notifications: skipped (not running on native platform)');
      return;
    }
  } catch (err) {
    console.log('FCM Push Notifications: skipped (Capacitor not available)');
    return;
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let permStatus = await PushNotifications.checkPermissions();

    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      console.warn('Push notification permission denied');
      return;
    }

    // Register with Apple / Google for notifications
    await PushNotifications.register();

    // Listeners for token registration
    await PushNotifications.addListener('registration', async (token) => {
      console.log('Push registration success, token: ' + token.value);
      
      // Submit token to backend
      try {
        await fetch('/api/notifications/register-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token.value }),
        });
      } catch (err) {
        console.error('Failed to submit push token to backend:', err);
      }
    });

    // Handle token registration errors
    await PushNotifications.addListener('registrationError', (error) => {
      console.error('Error on push registration: ' + JSON.stringify(error));
    });

    // Show alert when notification is received in foreground
    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('Push received in foreground: ' + JSON.stringify(notification));
      // In foreground, we can trigger custom toasts or sound alerts
    });

  } catch (err) {
    console.error('Failed to initialize push notifications:', err);
  }
}
