import { verifySingleUserPassword } from '../../../apps/api/dist/auth/single-user-password.js';

export default {
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/verify') {
      return new Response(null, { status: 404 });
    }

    try {
      const valid = await verifySingleUserPassword('trial', 'synthetic-probe');
      return Response.json({ valid }, { status: valid ? 200 : 500 });
    } catch (error) {
      return Response.json({ valid: false, code: error.code ?? error.name }, { status: 500 });
    }
  },
};
