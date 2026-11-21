const target = new URL(process.env.SPORTOS_TRIAL_API_ORIGIN ?? '');
if (target.protocol !== 'https:' || target.href !== target.origin + '/') {
  throw new Error('SPORTOS_TRIAL_API_ORIGIN must be a bare HTTPS origin.');
}

module.exports = {
  '/api/**': {
    target: target.origin,
    changeOrigin: true,
    pathRewrite: { '^/api(?=/)': '' },
  },
};
