const DEFAULT_LIMITS = {
  upload: {
    limit: 60,
    windowSeconds: 60 * 60,
  },
  compress: {
    limit: 20,
    windowSeconds: 60 * 60,
  },
};

function getClientIP(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return ip?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function getIntegerEnv(name, fallback) {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getLimitConfig(scope) {
  const defaults = DEFAULT_LIMITS[scope] || DEFAULT_LIMITS.compress;
  const envPrefix = scope.toUpperCase();
  return {
    limit: getIntegerEnv(`${envPrefix}_RATE_LIMIT`, defaults.limit),
    windowSeconds: getIntegerEnv(`${envPrefix}_RATE_LIMIT_WINDOW_SECONDS`, defaults.windowSeconds),
  };
}

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return {
    url: url.replace(/\/+$/, ''),
    token,
  };
}

async function callRedisPipeline(commands) {
  const redis = getRedisConfig();
  if (!redis) return null;

  const response = await fetch(`${redis.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redis.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(`Redis 限流请求失败: ${response.status}`);
  }

  return response.json();
}

function getRetryAfterSeconds(windowSeconds) {
  return Math.max(1, windowSeconds);
}

async function checkRateLimit(req, scope) {
  const config = getLimitConfig(scope);
  const redis = getRedisConfig();
  const ip = getClientIP(req);

  if (!redis) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('未配置 Upstash Redis，已跳过 IP 限流');
    }
    return {
      limited: false,
      skipped: true,
      ip,
      limit: config.limit,
      remaining: config.limit,
      retryAfterSeconds: 0,
    };
  }

  const windowId = Math.floor(Date.now() / (config.windowSeconds * 1000));
  const key = `rate-limit:${scope}:${ip}:${windowId}`;

  try {
    const results = await callRedisPipeline([
      ['INCR', key],
      ['EXPIRE', key, config.windowSeconds],
    ]);
    const count = Number(results?.[0]?.result || 0);
    const remaining = Math.max(0, config.limit - count);

    return {
      limited: count > config.limit,
      skipped: false,
      ip,
      limit: config.limit,
      remaining,
      retryAfterSeconds: getRetryAfterSeconds(config.windowSeconds),
    };
  } catch (error) {
    console.error('Redis 限流失败，已放行请求:', error);
    return {
      limited: false,
      skipped: true,
      ip,
      limit: config.limit,
      remaining: config.limit,
      retryAfterSeconds: 0,
    };
  }
}

function applyRateLimitHeaders(res, rateLimit) {
  res.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
  res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
  if (rateLimit.limited) {
    res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
  }
}

module.exports = {
  applyRateLimitHeaders,
  checkRateLimit,
  getClientIP,
};
