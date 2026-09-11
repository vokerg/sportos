export function sportosCorsOptions(webOrigin: string) {
  return {
    origin: webOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-SportOS-CSRF'],
  };
}
