import { Capacitor, registerPlugin } from '@capacitor/core';

// true quando roda como APK no Android; false no navegador (PC ou celular pelo Wi-Fi)
export const isNative = Capacitor.isNativePlatform();
export const Sonora = registerPlugin('Sonora');
