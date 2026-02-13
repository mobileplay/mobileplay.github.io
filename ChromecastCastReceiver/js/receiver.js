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
      'Detailed Error Code - ' + event.detailedErrorCode);
    if (event && event.detailedErrorCode == 905) {
      castDebugLogger.error(LOG_RECEIVER_TAG,
        'LOAD_FAILED: Verify the load request is set up ' +
        'properly and the media is able to play.');
    }
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

const webSocketPlayer = new WebSocketPlayer('websocket-canvas');
const CONNECTSDK_NAMESPACE = 'urn:x-cast:com.connectsdk';
const MIRROR_NAMESPACE = 'urn:x-cast:com.connectsdk.mirror';
const DUMMY_MEDIA_URL = new URL('../res/background-1.jpg', window.location.href).toString();
let websocketMirrorActive = false;

function showMirrorCanvas() {
  const canvas = document.getElementById('websocket-canvas');
  const castPlayer = document.querySelector('cast-media-player');
  if (canvas) canvas.style.display = 'block';
  if (castPlayer) castPlayer.style.display = 'none';
}

function showDefaultPlayer() {
  const canvas = document.getElementById('websocket-canvas');
  const castPlayer = document.querySelector('cast-media-player');
  if (canvas) canvas.style.display = 'none';
  if (castPlayer) castPlayer.style.display = 'block';
}

function extractCustomData(loadRequestData) {
  return loadRequestData?.media?.customData || loadRequestData?.customData || null;
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

function startWebSocketMirror(wsUrl, sourceTag) {
  if (!wsUrl) return false;
  castDebugLogger.info(LOG_RECEIVER_TAG,
    `Starting WebSocket mirror from ${sourceTag}: ${wsUrl}`);
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
  showDefaultPlayer();
  websocketMirrorActive = false;
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
    stopWebSocketMirror();
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

    // If the loadRequestData is incomplete, return an error message.
    if (!loadRequestData || !loadRequestData.media) {
      const error = new cast.framework.messages.ErrorData(
        cast.framework.messages.ErrorType.LOAD_FAILED);
      error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
      return error;
    }

    const mirrorWsUrl = resolveMirrorWebSocketUrl(loadRequestData);
    if (mirrorWsUrl) {
      startWebSocketMirror(mirrorWsUrl, 'LOAD');
      loadRequestData.media.contentUrl = DUMMY_MEDIA_URL;
      loadRequestData.media.contentType = 'image/jpeg';
      return loadRequestData;
    }

    // Normal flow
    stopWebSocketMirror();

    // Check all content source fields for the asset URL or ID.
    let source = loadRequestData.media.contentUrl
      || loadRequestData.media.entity
      || loadRequestData.media.contentId;
    source = maybeDecodeURIComponentOnce(source);

    if (!source || source === '') {
      let error = new cast.framework.messages.ErrorData(
        cast.framework.messages.ErrorType.LOAD_FAILED);
      error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
      return error;
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
castReceiverOptions.playbackConfig = playbackConfig;
castDebugLogger.info(LOG_RECEIVER_TAG,
  `autoResumeDuration set to: ${playbackConfig.autoResumeDuration}`);

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
