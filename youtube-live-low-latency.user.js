// ==UserScript==
// @name        YouTube Live Low Latency
// @description Adjusts YouTube live stream playback speed based on latency
// @namespace   Violentmonkey Scripts
// @match       https://www.youtube.com/*
// @grant       GM.getValue
// @grant       GM.setValue
// @version     1.0
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
  // Default configuration values
  const defaultConfig = {
    latencyThresholdFast: 1.0,
    latencyThresholdSlow: 0.25,
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
    // Store the defaults in script values so they're visible in userscript addon settings
    if (value === defaultValue) {
      await GM.setValue(key, defaultValue);
    }
    return value;
  }

  // Load configuration
  const config = {
    latencyThresholdFast: await getConfigValue('latencyThresholdFast', defaultConfig.latencyThresholdFast),
    latencyThresholdSlow: await getConfigValue('latencyThresholdSlow', defaultConfig.latencyThresholdSlow),
    playbackRateFast: await getConfigValue('playbackRateFast', defaultConfig.playbackRateFast),
    playbackRateNormal: await getConfigValue('playbackRateNormal', defaultConfig.playbackRateNormal),
    playbackRateSlow: await getConfigValue('playbackRateSlow', defaultConfig.playbackRateSlow),
    intervalMs: await getConfigValue('intervalMs', defaultConfig.intervalMs),
    debugLogging: await getConfigValue('debugLogging', defaultConfig.debugLogging),
    loggingIntervalMs: await getConfigValue('loggingIntervalMs', defaultConfig.loggingIntervalMs) // New: Load logging interval
  };

  let lastPositiveLiveLatency = null;

  // Start interval for playback adjustments
  const adjustmentIntervalId = setInterval(() => {
    const video = document.querySelector('video');
    if (!video) return;

    // Calculate Live Latency
    const currentLiveLatency = video.buffered.end(0) - video.currentTime;
    let latencyToUse = currentLiveLatency;

    if (currentLiveLatency <= 0 && lastPositiveLiveLatency !== null) {
      latencyToUse = lastPositiveLiveLatency;
    }

    // Adjust playback speed based on latency
    if (latencyToUse > config.latencyThresholdFast) {
      video.playbackRate = config.playbackRateFast; // Speed up
    } else if (latencyToUse <= config.latencyThresholdSlow) {
      video.playbackRate = config.playbackRateSlow; // Slow down
    } else {
      video.playbackRate = config.playbackRateNormal; // Normal speed
    }

    // Store the current latency if it's positive for the next iteration
    if (currentLiveLatency > 0) {
      lastPositiveLiveLatency = currentLiveLatency;
    }

    // Debug logging is now handled by a separate interval
  }, config.intervalMs);

  // Start separate interval for debug logging if enabled
  if (config.debugLogging) {
    const loggingIntervalId = setInterval(() => {
      const video = document.querySelector('video');
      if (!video) return;

      // Recalculate values at the time of logging
      const currentLiveLatency = video.buffered.end(0) - video.currentTime;
      const currentRate = video.playbackRate;

      console.debug(`[yt3l] Live Latency: ${currentLiveLatency.toFixed(2)}s, Playback Rate: ${currentRate}`);
    }, config.loggingIntervalMs);
  }

})();
