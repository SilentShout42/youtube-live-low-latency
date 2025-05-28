// ==UserScript==
// @name        YouTube Live Low Latency
// @description Adjusts YouTube live stream playback speed based on latency
// @namespace   Violentmonkey Scripts
// @match       https://www.youtube.com/*
// @grant       GM.getValue
// @grant       GM.setValue
// @version     1.2
// @author      tojatomasz
// @website     https://github.com/tojatomasz/youtube-live-low-latency
// @author      SilentShout42 (userscript adaptation)
// @website     https://github.com/SilentShout42/youtube-live-low-latency
// @icon        https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @license     MIT
// @updateURL   https://raw.githubusercontent.com/SilentShout42/youtube-live-low-latency/main/youtube-live-low-latency.user.js
// @downloadURL https://raw.githubusercontent.com/SilentShout42/youtube-live-low-latency/main/youtube-live-low-latency.user.js
// @supportURL  https://github.com/SilentShout42/youtube-live-low-latency/issues
// ==/UserScript==

(async function () {
  'use strict';

  // performance.now() shim
  var performance = window.performance || {};
  performance.now = (function () {
    var _now = Date.now();
    return performance.now ||
      performance.webkitNow ||
      performance.msNow ||
      performance.oNow ||
      performance.mozNow ||
      function () { return Date.now() - _now; };
  })();

  // Default configuration values
  const defaultConfig = {
    BufferDurationThresholdFast: 1.0,
    BufferDurationThresholdSlow: 0.25,
    playbackRateFast: 1.1,
    playbackRateNormal: 1.0,
    playbackRateSlow: 0.75,
    intervalMs: 500,
    debugLogging: false,
    loggingIntervalMs: 10000
  };

  async function getConfigValue(key, defaultValue) {
    let value = await GM.getValue(key, defaultValue);
    if (typeof defaultValue === 'number') {
      value = parseFloat(value);
      if (isNaN(value)) {
        value = defaultValue;
      }
    }
    if (value === defaultValue) {
      await GM.setValue(key, defaultValue);
    }
    return value;
  }

  // Load configuration
  const config = {
    BufferDurationThresholdFast: await getConfigValue('BufferDurationThresholdFast', defaultConfig.BufferDurationThresholdFast),
    BufferDurationThresholdSlow: await getConfigValue('BufferDurationThresholdSlow', defaultConfig.BufferDurationThresholdSlow),
    playbackRateFast: await getConfigValue('playbackRateFast', defaultConfig.playbackRateFast),
    playbackRateNormal: await getConfigValue('playbackRateNormal', defaultConfig.playbackRateNormal),
    playbackRateSlow: await getConfigValue('playbackRateSlow', defaultConfig.playbackRateSlow),
    intervalMs: await getConfigValue('intervalMs', defaultConfig.intervalMs),
    debugLogging: await getConfigValue('debugLogging', defaultConfig.debugLogging),
    loggingIntervalMs: await getConfigValue('loggingIntervalMs', defaultConfig.loggingIntervalMs)
  };

  function logDebug(message) {
    if (config.debugLogging) {
      console.debug(`[yt3l] ${message}`);
    }
  }

  let video = null;
  let runCheckIntervalId = null;
  let adjustmentIntervalId = null;
  let loggingIntervalId = null;
  let seekingListenerFunction = null;

  let shouldRun = false;
  let currentBufferSize = 0;
  let lastSeekTime = 0;
  let lastLiveheadTime = 0;
  let isScriptActive = false;

  async function initializeScriptLogic() {
    if (isScriptActive) {
      logDebug("Script logic already initialized. Skipping.");
      return;
    }
    logDebug("Initializing script logic for video page...");

    // Try to find the video element with retries
    const videoSelector = 'video.html5-main-video';
    logDebug(`Attempting to find video element with selector: ${videoSelector}`);
    video = document.querySelector(videoSelector);
    if (!video) {
        const maxRetries = 10;
        const retryDelay = 500;
        for (let i = 0; i < maxRetries; i++) {
            logDebug(`Video element not found. Retry ${i + 1}/${maxRetries} in ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            video = document.querySelector(videoSelector);
            if (video) {
                logDebug("Video element found on retry.");
                break;
            }
        }
    }

    if (!video) {
      console.warn('[yt3l] No video element found after multiple retries. Aborting initialization for this page.');
      isScriptActive = false;
      return;
    }
    logDebug("Video element found.");

    // Reset state variables
    shouldRun = false;
    currentBufferSize = 0;
    lastSeekTime = 0;
    lastLiveheadTime = 0;

    runCheckIntervalId = setInterval(() => {
      if (!video || !video.isConnected) {
        if (shouldRun) logDebug("Video element became invalid/disconnected during run check. Stopping logic.");
        shouldRun = false;
        return;
      }

      let newShouldRun = false;
      if (!video.paused && (lastSeekTime === lastLiveheadTime) && lastLiveheadTime > 0) {
        if (video.duration > 0 && isFinite(video.currentTime)) {
            newShouldRun = true;
        } else {
            logDebug("Video not ready for processing (no duration/currentTime).");
        }
      }

      if (shouldRun !== newShouldRun) {
          logDebug(`shouldRun changed to: ${newShouldRun}`);
          shouldRun = newShouldRun;
      }
    }, 1000);

    seekingListenerFunction = () => {
      const now = performance.now();
      lastSeekTime = now;
      if (document.querySelector('.ytp-live-badge-is-livehead')) {
        lastLiveheadTime = now;
      }
      logDebug(`Seeking event. LastSeek: ${lastSeekTime.toFixed(2)}, LastLivehead: ${lastLiveheadTime.toFixed(2)}`);
    };
    video.addEventListener('seeking', seekingListenerFunction);

    adjustmentIntervalId = setInterval(() => {
      if (!video || !video.isConnected) {
        logDebug("Video element lost or disconnected in adjustmentInterval. Stopping adjustments.");
        shouldRun = false;
        return;
      }
      if (!shouldRun) return;

      if (video.buffered && video.buffered.length > 0) {
        let maxBufferedEnd = 0;
        for (let i = 0; i < video.buffered.length; i++) {
          maxBufferedEnd = Math.max(maxBufferedEnd, video.buffered.end(i));
        }
        currentBufferSize = maxBufferedEnd - video.currentTime;
        if (isNaN(currentBufferSize) || !isFinite(currentBufferSize)) {
            logDebug(`Invalid buffer size calculated: ${currentBufferSize}. Resetting to 0.`);
            currentBufferSize = 0;
        }
      } else {
        currentBufferSize = 0;
      }

      if (currentBufferSize > config.BufferDurationThresholdFast) {
        if (video.playbackRate !== config.playbackRateFast) {
          logDebug(`Buffer high (${currentBufferSize.toFixed(2)}s). Setting rate to ${config.playbackRateFast}.`);
          video.playbackRate = config.playbackRateFast;
        }
      } else if (currentBufferSize <= config.BufferDurationThresholdSlow) {
        if (video.playbackRate !== config.playbackRateSlow) {
          logDebug(`Buffer low (${currentBufferSize.toFixed(2)}s). Setting rate to ${config.playbackRateSlow}.`);
          video.playbackRate = config.playbackRateSlow;
        }
      } else {
        if (video.playbackRate !== config.playbackRateNormal) {
          logDebug(`Buffer normal (${currentBufferSize.toFixed(2)}s). Setting rate to ${config.playbackRateNormal}.`);
          video.playbackRate = config.playbackRateNormal;
        }
      }
    }, config.intervalMs);

    if (config.debugLogging) {
      loggingIntervalId = setInterval(() => {
        if (!video || !video.isConnected) {
            logDebug("Video element lost or disconnected in loggingInterval.");
            return;
        }
        console.debug(`[yt3l] Buffer: ${currentBufferSize.toFixed(2)}s, Rate: ${video && video.isConnected ? video.playbackRate.toFixed(2) : 'N/A'}, Run: ${shouldRun}, Paused: ${video && video.isConnected ? video.paused : 'N/A'}, Seek: ${lastSeekTime.toFixed(2)}, Live: ${lastLiveheadTime.toFixed(2)}, VidCon: ${video && video.isConnected}`);
      }, config.loggingIntervalMs);
    }
    isScriptActive = true;
    logDebug("Script logic initialization complete.");
  }

  function cleanupScriptLogic() {
    if (!isScriptActive) {
      return;
    }
    logDebug("Cleaning up script logic...");

    if (runCheckIntervalId) clearInterval(runCheckIntervalId);
    if (adjustmentIntervalId) clearInterval(adjustmentIntervalId);
    if (loggingIntervalId) clearInterval(loggingIntervalId);

    if (video && seekingListenerFunction) {
      video.removeEventListener('seeking', seekingListenerFunction);
    }

    if (video && video.isConnected &&
        (video.playbackRate === config.playbackRateFast || video.playbackRate === config.playbackRateSlow)) {
      logDebug(`Cleaning up: Resetting playback rate to normal (${config.playbackRateNormal}).`);
      video.playbackRate = config.playbackRateNormal;
    }

    video = null;
    runCheckIntervalId = null;
    adjustmentIntervalId = null;
    loggingIntervalId = null;
    seekingListenerFunction = null;
    shouldRun = false;
    isScriptActive = false;
    logDebug("Script logic cleanup complete.");
  }

  function handleNavigation() {
    const destinationUrl = new URL(navigation.currentEntry.url);
    const currentPath = destinationUrl.pathname;
    logDebug(`Navigation successful. Current path: ${currentPath}`);

    if (currentPath.startsWith('/watch')) {
      logDebug("Navigated to a watch page. Re-initializing script.");
      cleanupScriptLogic();
      initializeScriptLogic();
    } else {
      if (isScriptActive) {
        logDebug("Navigated away from a watch page. Cleaning up script.");
        cleanupScriptLogic();
      }
    }
  }

  // Initial check on script load
  const initialPath = window.location.pathname;
  logDebug(`Initial page load. Path: ${initialPath}`);
  if (initialPath.startsWith('/watch')) {
    logDebug("Initial load on a watch page. Initializing script.");
    initializeScriptLogic();
  } else {
    logDebug(`Initial load on non-watch page: ${initialPath}. Script inactive.`);
  }

  // Listen for SPA navigation events
  if (window.navigation) {
    logDebug("Setting up navigation API listener ('navigatesuccess').");
    window.navigation.addEventListener('navigatesuccess', handleNavigation);
  } else {
    console.warn('[yt3l] window.navigation API not found. Script may not work correctly with SPA navigations.');
  }

})();
