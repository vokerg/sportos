const target = new URL(process.env.SPORTOS_TRIAL_API_ORIGIN ?? '');
const localWorker = target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname);
if ((target.protocol !== 'https:' && !localWorker) || target.href !== target.origin + '/') {
  throw new Error('SPORTOS_TRIAL_API_ORIGIN must be a bare HTTPS origin or loopback HTTP origin.');
}

module.exports = {
  '/api/**': {
    target: target.origin,
    changeOrigin: true,
    pathRewrite: { '^/api(?=/)': '' },
  },
};
