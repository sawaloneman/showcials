# Showcials — Private Cinema

An original watch-party interface for a browser companion, native Roku channel and authenticated Node.js relay. This repository is being populated from the validated v7 development bundle.

## Implementation

The browser companion provides a shared room, synchronized authorized direct-media playback, chat, voice transport, saved moments, connected-player capability reports and an in-app Roku remote. Its separate standalone HTML preview includes an original local MP4 and clearly labels local-only interactions.

Subscription services stay in their official players. Browser-extension control is experimental and provider-specific. The manual shared-clock mode does not embed subscriptions or bypass DRM. Each viewer needs their own authorized access.

The native Roku source implements foreground push-to-talk using a supported remote, system permission and an in-app control activated with OK. Physical Roku microphone capture and speaker playback remain unverified. The website does not remap a physical shortcut button.

## Release gates

Passing local HTTP/WebSocket and generic Chromium tests does not establish Netflix/Hulu compatibility or Roku hardware support. Release requires successful BrightScript compilation of both the source and extracted channel ZIP, a physical Roku test, real browser voice sessions, provider validation and a healthy hosted deployment.

The completed source bundle and detailed test evidence are being delivered in the associated ChatGPT conversation. This README alone is not a running application.

## Privacy

Do not commit relay keys, account cookies, recordings or private configuration. A relay access key grants access to that private relay; invitation links must omit it. Preserve microphone permissions and recording indicators.
