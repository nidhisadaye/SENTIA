export const USE_DIRECT = true;
export const PROXY_BASE_URL = "https://your-sentia-proxy.example.com";

export const SCAN_INTERVAL_MS = 3500;
export const WWM_SCAN_INTERVAL_MS = 1500;
export const WWM_INTERVAL_CLEAR = 2000;
export const WWM_INTERVAL_CAUTION = 900;
export const WWM_INTERVAL_STOP = 500;
export const WWM_INTERVAL_DANGER = 400;
export const WWM_IMG_WIDTH = 1024;
export const WWM_IMG_QUALITY = 0.85;
export const WWM_MAX_TOKENS = 120;
export const WWM_CONTEXT_WINDOW = 3;
export const WWM_SILENCE_AFTER_CLEAR = 3;
export const WWM_MIN_RESPONSE_LENGTH = 8;
export const WWM_MAX_CONSECUTIVE_ERRORS = 3;
export const MAX_FACES = 10;
export const MAX_CONV_HISTORY = 12;
export const LISTEN_DURATION_MS: Record<string, number> = { en: 7000, hi: 10000, mr: 10000 };
export const SILENCE_BUFFER_MS = 220;
export const LONG_PRESS_DELAY = 900;
export const SHAKE_THRESHOLD = 4.0;
export const SHAKE_COOLDOWN_MS = 4000;
export const DOUBLE_SHAKE_WINDOW_MS = 1800;
export const MIN_VALID_RESPONSE_LENGTH = 15;

export const GYRO_TILT_THRESHOLD = 1.4;
export const GYRO_TILT_COOLDOWN_MS = 180;

export const BARO_OUTDOOR_THRESHOLD_HPA = 0.30;
export const BARO_INDOOR_THRESHOLD_HPA = 0.15;
export const BARO_SAMPLE_WINDOW_MS = 1200;
export const BARO_WARN_COOLDOWN_MS = 4000;

