/**
Copyright 2022 Google LLC. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/


'use strict';

import { CastQueue } from './queuing.js';
import { MediaFetcher } from './media_fetcher.js';
import { AdsTracker, SenderTracker, ContentTracker } from './cast_analytics.js';

/**
 * @fileoverview This sample demonstrates how to build your own Web Receiver for
 * use with Google Cast. The main receiver implementation is provided in this
 * file which sets up access to the CastReceiverContext and PlayerManager. Some
 * added functionality can be enabled by uncommenting some of the code blocks
 * below.
 */


/*
 * Convenience variables to access the CastReceiverContext and PlayerManager.
 */
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

/*
 * Constant to be used for fetching media by entity from sample repository.
 */
const ID_REGEX = '\/?([^\/]+)\/?$';

/**
 * Debug Logger
 */
const castDebugLogger = cast.debug.CastDebugLogger.getInstance();
const LOG_RECEIVER_TAG = 'Receiver';

/*
 * WARNING: Make sure to turn off debug logger for production release as it
 * may expose details of your app.
 * Uncomment below line to enable debug logger, show a 'DEBUG MODE' tag at
 * top left corner and show debug overlay.
 */
//  context.addEventListener(cast.framework.system.EventType.READY, () => {
//   if (!castDebugLogger.debugOverlayElement_) {
//     /**
//      *  Enable debug logger and show a 'DEBUG MODE' tag at
//      *  top left corner.
//      */
//       castDebugLogger.setEnabled(true);

//     /**
//      * Show debug overlay.
//      */
//       castDebugLogger.showDebugLogs(true);
//   }
// });

/*
 * Set verbosity level for Core events.
 */
castDebugLogger.loggerLevelByEvents = {
  'cast.framework.events.category.CORE':
    cast.framework.LoggerLevel.INFO,
  'cast.framework.events.EventType.MEDIA_STATUS':
    cast.framework.LoggerLevel.DEBUG
};

if (!castDebugLogger.loggerLevelByTags) {
  castDebugLogger.loggerLevelByTags = {};
}

/*
 * Set verbosity level for custom tag.
 * Enables log messages for error, warn, info and debug.
 */
castDebugLogger.loggerLevelByTags[LOG_RECEIVER_TAG] =
  cast.framework.LoggerLevel.DEBUG;

/*
 * Example of how to listen for events on playerManager.
 */
playerManager.addEventListener(
  cast.framework.events.EventType.ERROR, (event) => {
    castDebugLogger.error(LOG_RECEIVER_TAG,
      `Error: code=${event.detailedErrorCode} ` +
      `reason=${event.reason || 'none'} ` +
      `type=${event.type || 'none'}`);
    if (event && event.detailedErrorCode == 905) {
      castDebugLogger.error(LOG_RECEIVER_TAG,
        'LOAD_FAILED: Verify the load request is set up ' +
        'properly and the media is able to play.');
    }
    if (event && event.error) {
      const shakaErr = event.error;
      castDebugLogger.error(LOG_RECEIVER_TAG,
        `Shaka error detail: category=${shakaErr.category} ` +
        `code=${shakaErr.code} severity=${shakaErr.severity} ` +
        `message=${shakaErr.message || ''}`);
    }
  });

playerManager.addEventListener(
  cast.framework.events.EventType.BUFFERING, (event) => {
    castDebugLogger.info(LOG_RECEIVER_TAG,
      `Buffering: isBuffering=${event.isBuffering}`);
  });

/*
 * Example analytics tracking implementation. To enable this functionality see
 * the implmentation and complete the TODO item in ./google_analytics.js. Once
 * complete uncomment the the calls to startTracking below to enable each
 * Tracker.
 */
const adTracker = new AdsTracker();
const senderTracker = new SenderTracker();
const contentTracker = new ContentTracker();
// adTracker.startTracking();
// senderTracker.startTracking();
// contentTracker.startTracking();

/**
 * Modifies the provided mediaInformation by adding a pre-roll break clip to it.
 * @param {cast.framework.messages.MediaInformation} mediaInformation The target
 * MediaInformation to be modified.
 * @return {Promise} An empty promise.
 */
function addBreaks(mediaInformation) {
  castDebugLogger.debug(LOG_RECEIVER_TAG, "addBreaks: " +
    JSON.stringify(mediaInformation));
  return MediaFetcher.fetchMediaById('fbb_ad')
    .then((clip1) => {
      mediaInformation.breakClips = [
        {
          id: 'fbb_ad',
          title: clip1.title,
          contentUrl: clip1.stream.dash,
          contentType: 'application/dash+xml',
          whenSkippable: 5
        }
      ];

      mediaInformation.breaks = [
        {
          id: 'pre-roll',
          breakClipIds: ['fbb_ad'],
          position: 0
        }
      ];
    });
}

import { WebSocketPlayer } from './websocket_player.js';
import { WebRTCPlayer } from './webrtc_player.js';

const webSocketPlayer = new WebSocketPlayer('websocket-canvas');
const webRTCPlayer = new WebRTCPlayer('webrtc-video', {
  onState: (state, payload = {}) => {
    castDebugLogger.info(LOG_RECEIVER_TAG, `[WebRTC] ${state} ${JSON.stringify(payload)}`);
  }
});
const CONNECTSDK_NAMESPACE = 'urn:x-cast:com.connectsdk';
const MIRROR_NAMESPACE = 'urn:x-cast:com.connectsdk.mirror';
const DUMMY_MEDIA_URL = new URL('../res/background-1.jpg', window.location.href).toString();
let websocketMirrorActive = false;
let webRTCMirrorActive = false;
let activeMediaNetworkConfig = {
  headers: {},
  withCredentials: false,
  originContentUrl: '',
  proxyOrigin: ''
};

const RECEIVER_FORWARD_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'origin',
  'referer',
  'user-agent'
]);

function showMirrorCanvas() {
  const canvas = document.getElementById('websocket-canvas');
  const video = document.getElementById('webrtc-video');
  const castPlayer = document.querySelector('cast-media-player');
  if (canvas) canvas.style.display = 'block';
  if (video) video.style.display = 'none';
  if (castPlayer) castPlayer.style.display = 'none';
}

function showWebRTCVideo() {
  const canvas = document.getElementById('websocket-canvas');
  const video = document.getElementById('webrtc-video');
  const castPlayer = document.querySelector('cast-media-player');
  if (canvas) canvas.style.display = 'none';
  if (video) video.style.display = 'block';
  if (castPlayer) castPlayer.style.display = 'none';
}

function showDefaultPlayer() {
  const canvas = document.getElementById('websocket-canvas');
  const video = document.getElementById('webrtc-video');
  const castPlayer = document.querySelector('cast-media-player');
  if (canvas) canvas.style.display = 'none';
  if (video) video.style.display = 'none';
  if (castPlayer) castPlayer.style.display = 'block';
}

function extractCustomData(loadRequestData) {
  return loadRequestData?.media?.customData || loadRequestData?.customData || null;
}

function resetActiveMediaNetworkConfig() {
  activeMediaNetworkConfig = {
    headers: {},
    withCredentials: false,
    originContentUrl: '',
    proxyOrigin: ''
  };
}

function maybeDecodeURIComponentOnce(value) {
  if (typeof value !== 'string') return value;
  if (!value.includes('%')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeWebSocketUrl(source) {
  if (!source || typeof source !== 'string') return null;
  const trimmed = maybeDecodeURIComponentOnce(source.trim());
  if (!trimmed) return null;
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed;
  }
  if (!(trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const forced = parsed.searchParams.get('ws') ||
      parsed.searchParams.get('wsUrl') ||
      parsed.searchParams.get('websocket') ||
      parsed.searchParams.get('websocketUrl');
    if (forced) {
      return normalizeWebSocketUrl(forced);
    }

    const normalizedPath = parsed.pathname.toLowerCase();
    const shouldUseMirrorSocket = normalizedPath === '/' ||
      normalizedPath.endsWith('/sourcecast.html') ||
      normalizedPath.endsWith('/sourcecast');
    if (!shouldUseMirrorSocket) {
      return null;
    }

    parsed.pathname = '/ws';
    parsed.search = '';
    parsed.hash = '';
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeWebRTCSignalingUrl(source) {
  if (!source || typeof source !== 'string') return null;
  const trimmed = maybeDecodeURIComponentOnce(source.trim());
  if (!trimmed) return null;

  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    try {
      const parsed = new URL(trimmed);
      if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname.toLowerCase() === '/webrtc') {
        parsed.pathname = '/webrtc_signal';
      }
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return null;
    }
  }

  if (!(trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const forced = parsed.searchParams.get('webrtcSignalUrl') ||
      parsed.searchParams.get('webrtc') ||
      parsed.searchParams.get('webrtcUrl') ||
      parsed.searchParams.get('signalUrl') ||
      parsed.searchParams.get('signal') ||
      parsed.searchParams.get('ws') ||
      parsed.searchParams.get('wsUrl');
    if (forced) {
      return normalizeWebRTCSignalingUrl(forced);
    }

    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    parsed.pathname = '/webrtc_signal';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveMirrorWebSocketUrl(loadRequestData) {
  const customData = extractCustomData(loadRequestData);
  const candidates = [
    customData?.wsUrl,
    customData?.websocketUrl,
    customData?.socketUrl,
    customData?.mirrorUrl,
    customData?.target,
    loadRequestData?.media?.contentUrl,
    loadRequestData?.media?.entity,
    loadRequestData?.media?.contentId
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWebSocketUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function resolveWebRTCSignalingUrl(loadRequestData) {
  const customData = extractCustomData(loadRequestData);
  const candidates = [
    customData?.webrtcSignalUrl,
    customData?.signalUrl,
    customData?.webrtcUrl,
    customData?.wsUrl,
    loadRequestData?.media?.contentUrl,
    loadRequestData?.media?.entity,
    loadRequestData?.media?.contentId
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWebRTCSignalingUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function normalizeForwardHeaders(rawHeaders) {
  if (!rawHeaders || typeof rawHeaders !== 'object') return {};

  const normalized = {};
  Object.entries(rawHeaders).forEach(([rawKey, rawValue]) => {
    if (typeof rawKey !== 'string') return;
    if (typeof rawValue !== 'string') return;

    const key = rawKey.trim();
    const value = rawValue.trim();
    if (!key || !value) return;

    if (!RECEIVER_FORWARD_HEADER_ALLOWLIST.has(key.toLowerCase())) return;
    normalized[key] = value;
  });

  return normalized;
}

function extractOrigin(urlString) {
  if (!urlString || typeof urlString !== 'string') return '';
  try {
    return new URL(urlString).origin;
  } catch {
    return '';
  }
}

function getHeaderValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const target = String(name || '').toLowerCase();
  const entry = Object.entries(headers).find(([key]) => String(key).toLowerCase() === target);
  return entry ? String(entry[1] || '') : '';
}

function resolveActiveMediaNetworkConfig(loadRequestData, customData) {
  const candidateHeaders =
    customData?.requestHeaders || customData?.networkHeaders || customData?.headers || {};
  const headers = normalizeForwardHeaders(candidateHeaders);
  const contentUrl = String(loadRequestData?.media?.contentUrl || '');
  const originContentUrl = String(
    customData?.originContentUrl || customData?.contentSourceUrl || customData?.upstreamUrl || ''
  ).trim();
  const proxyOrigin = String(
    customData?.proxyOrigin || extractOrigin(contentUrl)
  ).trim();
  const withCredentials = Boolean(customData?.withCredentials);

  activeMediaNetworkConfig = {
    headers,
    withCredentials,
    originContentUrl,
    proxyOrigin
  };

  castDebugLogger.info(
    LOG_RECEIVER_TAG,
    `Active network config: proxyOrigin=${proxyOrigin || 'unset'} ` +
    `originContentUrl=${originContentUrl || 'unset'} ` +
    `withCredentials=${withCredentials} ` +
    `headers=${Object.keys(headers).join(',') || 'none'}`
  );
}

function isSameOrigin(urlString, origin) {
  if (!urlString || !origin) return false;
  try {
    return new URL(urlString).origin === origin;
  } catch {
    return false;
  }
}

function requestUsesProxyMapping(urlString) {
  if (!urlString) return false;
  try {
    const parsed = new URL(urlString);
    return parsed.pathname.includes('/segment/') || parsed.searchParams.has('id');
  } catch {
    return false;
  }
}

function applyReceiverRequestHeaders(requestInfo, requestType) {
  if (!requestInfo) return;

  const targetUrl = String(requestInfo.url || '');
  const hasProxyOrigin = Boolean(activeMediaNetworkConfig.proxyOrigin);
  const isProxyRequest =
    hasProxyOrigin &&
    isSameOrigin(targetUrl, activeMediaNetworkConfig.proxyOrigin) &&
    requestUsesProxyMapping(targetUrl);

  requestInfo.headers = requestInfo.headers || {};

  if (!isProxyRequest) {
    Object.entries(activeMediaNetworkConfig.headers).forEach(([key, value]) => {
      requestInfo.headers[key] = value;
    });
    if (activeMediaNetworkConfig.withCredentials) {
      requestInfo.withCredentials = true;
    }
  } else {
    requestInfo.withCredentials = false;
  }

  if (!requestInfo.timeoutInterval || requestInfo.timeoutInterval < 30000) {
    requestInfo.timeoutInterval = 30000;
  }

  if (targetUrl && hasProxyOrigin && !isSameOrigin(targetUrl, activeMediaNetworkConfig.proxyOrigin)) {
    castDebugLogger.info(
      LOG_RECEIVER_TAG,
      `${requestType} request bypassed proxy, injecting upstream headers: ${targetUrl}`
    );
  } else {
    castDebugLogger.debug(
      LOG_RECEIVER_TAG,
      `${requestType} request: ${targetUrl || 'unset'} proxy=${isProxyRequest} ` +
      `headers=${Object.keys(requestInfo.headers || {}).join(',') || 'none'}`
    );
  }
}

function resolveURLPreservingTemplate(rawValue, baseURL) {
  if (!rawValue || typeof rawValue !== 'string') return rawValue;

  const trimmed = rawValue.trim();
  if (!trimmed) return trimmed;

  const lowered = trimmed.toLowerCase();
  if (
    lowered.startsWith('data:') ||
    lowered.startsWith('blob:') ||
    lowered.startsWith('urn:')
  ) {
    return trimmed;
  }

  try {
    return new URL(trimmed, baseURL).toString();
  } catch {
    return trimmed;
  }
}

function localNameOf(node) {
  return String(node?.localName || node?.nodeName || '').split(':').pop();
}

function rewriteDashManifest(manifestText, manifestURL) {
  if (!manifestText || !manifestURL || typeof DOMParser === 'undefined') {
    return manifestText;
  }

  let document;
  try {
    document = new DOMParser().parseFromString(manifestText, 'application/xml');
  } catch (error) {
    castDebugLogger.warn(LOG_RECEIVER_TAG, `Failed to parse DASH manifest: ${error?.message || error}`);
    return manifestText;
  }

  if (!document || document.getElementsByTagName('parsererror').length > 0) {
    castDebugLogger.warn(LOG_RECEIVER_TAG, 'DASH manifest parser returned parsererror; skipping rewrite.');
    return manifestText;
  }

  let rewriteCount = 0;
  const urlAttributeNames = ['media', 'initialization', 'sourceURL', 'index', 'href'];

  const rewriteAttribute = (element, attributeName, baseURL) => {
    if (!element.hasAttribute(attributeName)) return;

    const rawValue = element.getAttribute(attributeName);
    const rewrittenValue = resolveURLPreservingTemplate(rawValue, baseURL);
    if (rewrittenValue && rewrittenValue !== rawValue) {
      element.setAttribute(attributeName, rewrittenValue);
      rewriteCount += 1;
    }
  };

  const traverse = (element, inheritedBaseURL) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

    let currentBaseURL = inheritedBaseURL;
    const childElements = Array.from(element.children || []);

    childElements.forEach((child) => {
      if (localNameOf(child) !== 'BaseURL') return;

      const rawValue = String(child.textContent || '').trim();
      if (!rawValue) return;

      const rewrittenValue = resolveURLPreservingTemplate(rawValue, currentBaseURL);
      if (rewrittenValue !== rawValue) {
        child.textContent = rewrittenValue;
        rewriteCount += 1;
      }

      currentBaseURL = rewrittenValue || currentBaseURL;
    });

    urlAttributeNames.forEach((attributeName) => {
      rewriteAttribute(element, attributeName, currentBaseURL);
    });

    if (element.hasAttributeNS?.('http://www.w3.org/1999/xlink', 'href')) {
      const rawValue = element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      const rewrittenValue = resolveURLPreservingTemplate(rawValue, currentBaseURL);
      if (rewrittenValue && rewrittenValue !== rawValue) {
        element.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', rewrittenValue);
        rewriteCount += 1;
      }
    }

    childElements.forEach((child) => {
      if (localNameOf(child) === 'Location') {
        const rawValue = String(child.textContent || '').trim();
        const rewrittenValue = resolveURLPreservingTemplate(rawValue, currentBaseURL);
        if (rewrittenValue && rewrittenValue !== rawValue) {
          child.textContent = rewrittenValue;
          rewriteCount += 1;
        }
      }

      traverse(child, currentBaseURL);
    });
  };

  traverse(document.documentElement, manifestURL);

  if (rewriteCount > 0) {
    castDebugLogger.info(
      LOG_RECEIVER_TAG,
      `Rewrote DASH manifest URLs: count=${rewriteCount} base=${manifestURL}`
    );
  }

  try {
    return new XMLSerializer().serializeToString(document);
  } catch (error) {
    castDebugLogger.warn(LOG_RECEIVER_TAG, `Failed to serialize DASH manifest: ${error?.message || error}`);
    return manifestText;
  }
}

function isLikelyDashManifest(manifestText, responseHeaders, shakaRequest) {
  const contentType = getHeaderValue(responseHeaders, 'content-type').toLowerCase();
  if (contentType.includes('dash+xml')) return true;

  const shakaURL = String(
    shakaRequest?.uris?.[0] || shakaRequest?.originalUri || shakaRequest?.url || ''
  ).toLowerCase();
  if (shakaURL.includes('.mpd')) return true;

  return typeof manifestText === 'string' && manifestText.includes('<MPD');
}

function isLikelyHLSLoad(loadRequestData, source) {
  const contentType = String(loadRequestData?.media?.contentType || '').toLowerCase();
  const normalizedSource = String(source || '').toLowerCase();
  if (contentType.includes('mpegurl')) return true;
  return normalizedSource.includes('.m3u8');
}

function isLikelyDashLoad(loadRequestData, source) {
  const contentType = String(loadRequestData?.media?.contentType || '').toLowerCase();
  const normalizedSource = String(source || '').toLowerCase();
  if (contentType.includes('dash+xml')) return true;
  return normalizedSource.includes('.mpd');
}

function startWebSocketMirror(wsUrl, sourceTag) {
  if (!wsUrl) return false;
  castDebugLogger.info(LOG_RECEIVER_TAG,
    `Starting WebSocket mirror from ${sourceTag}: ${wsUrl}`);

  stopWebRTCMirror();
  showMirrorCanvas();
  webSocketPlayer.start(wsUrl);
  websocketMirrorActive = true;

  // Ask sender to prioritize low-latency settings for smoother mirror playback.
  setTimeout(() => {
    webSocketPlayer.sendControlMessage('quality:lowLatency');
  }, 250);

  return true;
}

function stopWebSocketMirror() {
  if (!websocketMirrorActive) return;
  webSocketPlayer.stop();
  websocketMirrorActive = false;
  if (!webRTCMirrorActive) {
    showDefaultPlayer();
  }
}

function startWebRTCMirror(signalUrl, sourceTag) {
  if (!signalUrl) return false;
  castDebugLogger.info(LOG_RECEIVER_TAG,
    `Starting WebRTC mirror from ${sourceTag}: ${signalUrl}`);

  stopWebSocketMirror();
  showWebRTCVideo();
  webRTCPlayer.start(signalUrl);
  webRTCMirrorActive = true;
  return true;
}

function stopWebRTCMirror() {
  if (!webRTCMirrorActive) return;
  webRTCPlayer.stop();
  webRTCMirrorActive = false;
  if (!websocketMirrorActive) {
    showDefaultPlayer();
  }
}

function stopAllCustomMirrors() {
  stopWebSocketMirror();
  stopWebRTCMirror();
  showDefaultPlayer();
}

function asObjectMessage(payload) {
  if (!payload) return null;
  if (typeof payload === 'object') return payload;
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return null;
}

function handleMirrorControlMessage(payload, sourceTag) {
  const message = asObjectMessage(payload);
  if (!message) return;

  const command = (message.type || message.action || message.command || '').toLowerCase();
  if (command === 'mirror.stop' || command === 'stop_mirror' || command === 'stopmirror' || command === 'stop') {
    castDebugLogger.info(LOG_RECEIVER_TAG, `Received mirror stop from ${sourceTag}`);
    stopAllCustomMirrors();
    return;
  }

  const mode = String(message.mode || '').toLowerCase();
  if (mode === 'webrtc_mirror' || mode === 'webrtc') {
    const signalUrl = normalizeWebRTCSignalingUrl(
      message.webrtcSignalUrl || message.signalUrl || message.webrtcUrl || message.url || message.target
    );
    if (signalUrl) {
      startWebRTCMirror(signalUrl, sourceTag);
    }
    return;
  }

  const wsUrl = normalizeWebSocketUrl(
    message.wsUrl || message.websocketUrl || message.socketUrl || message.url || message.target
  );
  if (wsUrl) {
    startWebSocketMirror(wsUrl, sourceTag);
  }
}

context.addCustomMessageListener(CONNECTSDK_NAMESPACE, (event) => {
  handleMirrorControlMessage(event?.data, CONNECTSDK_NAMESPACE);
});

context.addCustomMessageListener(MIRROR_NAMESPACE, (event) => {
  handleMirrorControlMessage(event?.data, MIRROR_NAMESPACE);
});

/*
 * Intercept the LOAD request to load and set the contentUrl.
 */
playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD, loadRequestData => {
    castDebugLogger.debug(LOG_RECEIVER_TAG,
      `loadRequestData: ${JSON.stringify(loadRequestData)}`);

    resetActiveMediaNetworkConfig();

    // If the loadRequestData is incomplete, return an error message.
    if (!loadRequestData || !loadRequestData.media) {
      const error = new cast.framework.messages.ErrorData(
        cast.framework.messages.ErrorType.LOAD_FAILED);
      error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
      return error;
    }

    const customData = extractCustomData(loadRequestData);
    resolveActiveMediaNetworkConfig(loadRequestData, customData);
    const requestedMode = String(customData?.mode || '').toLowerCase();
    castDebugLogger.info(LOG_RECEIVER_TAG, `Mirror LOAD mode=${requestedMode || 'auto'} customData=${JSON.stringify(customData || {})}`);

    if (requestedMode === 'webrtc_mirror') {
      const signalingUrl = resolveWebRTCSignalingUrl(loadRequestData);
      if (!signalingUrl) {
        const error = new cast.framework.messages.ErrorData(
          cast.framework.messages.ErrorType.LOAD_FAILED);
        error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
        return error;
      }
      castDebugLogger.info(LOG_RECEIVER_TAG, `Resolved WebRTC signaling URL (customData): ${signalingUrl}`);
      startWebRTCMirror(signalingUrl, 'LOAD:customData');
      loadRequestData.media.contentUrl = DUMMY_MEDIA_URL;
      loadRequestData.media.contentType = 'image/jpeg';
      return loadRequestData;
    }

    if (requestedMode === 'websocket_mirror') {
      const mirrorWsUrl = resolveMirrorWebSocketUrl(loadRequestData);
      if (!mirrorWsUrl) {
        const error = new cast.framework.messages.ErrorData(
          cast.framework.messages.ErrorType.LOAD_FAILED);
        error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
        return error;
      }
      startWebSocketMirror(mirrorWsUrl, 'LOAD:customData');
      loadRequestData.media.contentUrl = DUMMY_MEDIA_URL;
      loadRequestData.media.contentType = 'image/jpeg';
      return loadRequestData;
    }

    const mirrorWsUrl = resolveMirrorWebSocketUrl(loadRequestData);
    if (mirrorWsUrl) {
      startWebSocketMirror(mirrorWsUrl, 'LOAD');
      loadRequestData.media.contentUrl = DUMMY_MEDIA_URL;
      loadRequestData.media.contentType = 'image/jpeg';
      return loadRequestData;
    }

    // Normal flow
    stopAllCustomMirrors();

    // Check all content source fields for the asset URL or ID.
    let source = loadRequestData.media.contentUrl
      || loadRequestData.media.entity || loadRequestData.media.contentId;

    if (typeof source !== 'string') {
      const error = new cast.framework.messages.ErrorData(
        cast.framework.messages.ErrorType.LOAD_FAILED);
      error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
      return error;
    }

    // Check for WebRTC signaling URL first when source points to signaling endpoint.
    const sourceWebRTCSignal = normalizeWebRTCSignalingUrl(source);
    if (sourceWebRTCSignal && source.toLowerCase().includes('webrtc')) {
      castDebugLogger.info(LOG_RECEIVER_TAG, "Starting WebRTC Player with URL: " + sourceWebRTCSignal);
      castDebugLogger.info(LOG_RECEIVER_TAG, `Resolved WebRTC signaling URL (source): ${sourceWebRTCSignal}`);
      startWebRTCMirror(sourceWebRTCSignal, 'LOAD:source');
      return loadRequestData;
    }

    // Check for WebSocket URL (Standard)
    if (source.startsWith('ws://') || source.startsWith('wss://')) {
      castDebugLogger.info(LOG_RECEIVER_TAG, "Starting WebSocket Player with URL: " + source);
      startWebSocketMirror(source, 'LOAD:source');
      return loadRequestData;
    }

    // Normal Flow: Stop Custom Players
    stopAllCustomMirrors();

    source = maybeDecodeURIComponentOnce(source);
    if (isLikelyHLSLoad(loadRequestData, source)) {
      const hintedSegmentFormat =
        loadRequestData.media.hlsSegmentFormat || customData?.hlsSegmentFormat || null;
      const hintedVideoSegmentFormat =
        loadRequestData.media.hlsVideoSegmentFormat || customData?.hlsVideoSegmentFormat || null;
      if (!loadRequestData.media.hlsSegmentFormat && hintedSegmentFormat) {
        loadRequestData.media.hlsSegmentFormat = hintedSegmentFormat;
      }
      if (!loadRequestData.media.hlsVideoSegmentFormat && hintedVideoSegmentFormat) {
        loadRequestData.media.hlsVideoSegmentFormat = hintedVideoSegmentFormat;
      }
      const senderStreamType = loadRequestData.media.streamType;
      const isExplicitlyBuffered =
        senderStreamType === cast.framework.messages.StreamType.BUFFERED;
      const isExplicitlyLive =
        senderStreamType === cast.framework.messages.StreamType.LIVE;
      if (isExplicitlyLive) {
        loadRequestData.media.streamType =
          cast.framework.messages.StreamType.LIVE;
      } else if (isExplicitlyBuffered) {
        loadRequestData.media.streamType =
          cast.framework.messages.StreamType.BUFFERED;
      } else {
        loadRequestData.media.streamType =
          cast.framework.messages.StreamType.BUFFERED;
      }
      const currentType =
        String(loadRequestData.media.contentType || '').toLowerCase();
      if (!currentType || currentType.includes('x-mpegurl')) {
        loadRequestData.media.contentType =
          'application/vnd.apple.mpegurl';
      }
      castDebugLogger.info(
        LOG_RECEIVER_TAG,
        `HLS load: contentType=${loadRequestData.media.contentType} ` +
        `streamType=${loadRequestData.media.streamType} ` +
        `hlsSegmentFormat=${loadRequestData.media.hlsSegmentFormat || 'unset'} ` +
        `hlsVideoSegmentFormat=${loadRequestData.media.hlsVideoSegmentFormat || 'unset'} ` +
        `senderHint=${senderStreamType} source=${source}`
      );
    }

    if (isLikelyDashLoad(loadRequestData, source)) {
      const currentType =
        String(loadRequestData.media.contentType || '').toLowerCase();
      if (!currentType || currentType === 'video/mp4') {
        loadRequestData.media.contentType = 'application/dash+xml';
      }
      if (!loadRequestData.media.streamType) {
        loadRequestData.media.streamType =
          cast.framework.messages.StreamType.BUFFERED;
      }
      castDebugLogger.info(
        LOG_RECEIVER_TAG,
        `DASH load: contentType=${loadRequestData.media.contentType} ` +
        `streamType=${loadRequestData.media.streamType} source=${source}`
      );
    }


    const sourceMatch = source.match(ID_REGEX);
    if (!(source.startsWith('http://') || source.startsWith('https://') || sourceMatch)) {
      let error = new cast.framework.messages.ErrorData(
        cast.framework.messages.ErrorType.LOAD_FAILED);
      error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
      return error;
    }

    let sourceId = sourceMatch ? sourceMatch[1] : source;

    // Optionally add breaks to the media information and set the contentUrl.
    return Promise.resolve()
      // .then(() => addBreaks(loadRequestData.media)) // Uncomment to enable ads.
      .then(() => {
        // If the source is a url that points to an asset don't fetch from the
        // content repository.
        if (sourceId.includes('.')) {
          castDebugLogger.debug(LOG_RECEIVER_TAG,
            "Interceptor received full URL");
          loadRequestData.media.contentUrl = source;
          return loadRequestData;
        } else {
          // Fetch the contentUrl if provided an ID or entity URL.
          castDebugLogger.debug(LOG_RECEIVER_TAG, "Interceptor received ID");
          return MediaFetcher.fetchMediaInformationById(sourceId)
            .then((mediaInformation) => {
              loadRequestData.media = mediaInformation;
              return loadRequestData;
            })
        }
      })
      .catch((errorMessage) => {
        let error = new cast.framework.messages.ErrorData(
          cast.framework.messages.ErrorType.LOAD_FAILED);
        error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
        castDebugLogger.error(LOG_RECEIVER_TAG, errorMessage);
        return error;
      });
  }
);


/*
 * Set the control buttons in the UI controls.
 */
const controls = cast.framework.ui.Controls.getInstance();
controls.clearDefaultSlotAssignments();

// Assign buttons to control slots.
controls.assignButton(
  cast.framework.ui.ControlsSlot.SLOT_SECONDARY_1,
  cast.framework.ui.ControlsButton.QUEUE_PREV
);
controls.assignButton(
  cast.framework.ui.ControlsSlot.SLOT_PRIMARY_1,
  cast.framework.ui.ControlsButton.CAPTIONS
);
controls.assignButton(
  cast.framework.ui.ControlsSlot.SLOT_PRIMARY_2,
  cast.framework.ui.ControlsButton.SEEK_FORWARD_15
);
controls.assignButton(
  cast.framework.ui.ControlsSlot.SLOT_SECONDARY_2,
  cast.framework.ui.ControlsButton.QUEUE_NEXT
);

/*
 * Configure the CastReceiverOptions.
 */
const castReceiverOptions = new cast.framework.CastReceiverOptions();

/*
 * Set the player configuration.
 */
const playbackConfig = new cast.framework.PlaybackConfig();
playbackConfig.autoResumeDuration = 5;

playbackConfig.shakaConfig = {
  streaming: {
    bufferingGoal: 10,
    rebufferingGoal: 2,
    bufferBehind: 30,
    retryParameters: {
      maxAttempts: 4,
      baseDelay: 800,
      backoffFactor: 2,
      fuzzFactor: 0.5,
      timeout: 30000
    },
    failureCallback: (error) => {
      castDebugLogger.error(LOG_RECEIVER_TAG,
        `Shaka streaming failure: code=${error.code} ` +
        `category=${error.category} severity=${error.severity}`);
    }
  },
  manifest: {
    defaultPresentationDelay: 0,
    retryParameters: {
      maxAttempts: 4,
      baseDelay: 800,
      backoffFactor: 2,
      fuzzFactor: 0.5,
      timeout: 20000
    },
    hls: {
      liveSegmentsDelay: 1,
      ignoreManifestProgramDateTime: true,
      ignoreTextStreamFailures: true
    }
  },
  drm: {
    retryParameters: {
      maxAttempts: 3,
      baseDelay: 1000,
      backoffFactor: 2,
      fuzzFactor: 0.5,
      timeout: 10000
    }
  }
};

playbackConfig.manifestRequestHandler = (requestInfo) => {
  applyReceiverRequestHeaders(requestInfo, 'manifest');
};
playbackConfig.segmentRequestHandler = (requestInfo) => {
  applyReceiverRequestHeaders(requestInfo, 'segment');
};
playbackConfig.licenseRequestHandler = (requestInfo) => {
  applyReceiverRequestHeaders(requestInfo, 'license');
};
playbackConfig.manifestHandler = (manifest, responseInfo, shakaRequest) => {
  if (!isLikelyDashManifest(manifest, responseInfo?.headers, shakaRequest)) {
    return manifest;
  }

  const manifestURL =
    String(shakaRequest?.uris?.[0] || shakaRequest?.originalUri || shakaRequest?.url || '').trim()
    || activeMediaNetworkConfig.originContentUrl;

  if (!manifestURL) {
    castDebugLogger.warn(LOG_RECEIVER_TAG, 'Skipping DASH manifest rewrite because manifest URL is unavailable.');
    return manifest;
  }

  return rewriteDashManifest(manifest, manifestURL);
};

castReceiverOptions.playbackConfig = playbackConfig;
castDebugLogger.info(LOG_RECEIVER_TAG,
  `PlaybackConfig applied: bufferingGoal=10, retries=4, request customization enabled`);

/* 
 * Set the SupportedMediaCommands.
 */
castReceiverOptions.supportedCommands =
  cast.framework.messages.Command.ALL_BASIC_MEDIA |
  cast.framework.messages.Command.QUEUE_PREV |
  cast.framework.messages.Command.QUEUE_NEXT |
  cast.framework.messages.Command.STREAM_TRANSFER;

/*
 * Optionally enable a custom queue implementation. Custom queues allow the
 * receiver app to manage and add content to the playback queue. Uncomment the
 * line below to enable the queue.
 */
// castReceiverOptions.queue = new CastQueue();

context.start(castReceiverOptions);
