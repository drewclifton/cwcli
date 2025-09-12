import ky from 'ky';
import 'dotenv/config';
import Conf from 'conf';
let keytarModule = null;
async function getKeytar() {
  if (keytarModule !== null) return keytarModule;
  try {
    // Lazy-load keytar; if it fails (native module mismatch), fall back
    keytarModule = await import('keytar');
  } catch (e) {
    keytarModule = undefined;
  }
  return keytarModule;
}

const conf = new Conf({ projectName: 'cwl-local-cli' });
const SERVICE = 'cwl-local-cli';
const ACCOUNT = 'cloudways-api';


export async function saveCredentials({ email, apiKey }) {
  conf.set('email', email);
  const keytar = await getKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(SERVICE, ACCOUNT, apiKey);
      conf.set('secureStorage', 'keytar');
      return;
    } catch {}
  }
  // Fallback to config storage (less secure)
  conf.set('apiKey', apiKey);
  conf.set('secureStorage', 'conf');
}


export async function getApiKey() {
  // Prefer .env if present
  if (process.env.CW_API_KEY) return process.env.CW_API_KEY;
  const method = conf.get('secureStorage');
  if (method === 'keytar') {
    const keytar = await getKeytar();
    if (keytar) {
      try {
        const apiKey = await keytar.getPassword(SERVICE, ACCOUNT);
        if (apiKey) return apiKey;
      } catch {}
    }
  }
  return conf.get('apiKey');
}


export function getEmail() {
  // Prefer .env if present
  return process.env.CW_EMAIL || conf.get('email');
}

export async function clearCredentials() {
  const keytar = await getKeytar();
  if (keytar) {
    try { await keytar.deletePassword(SERVICE, ACCOUNT); } catch {}
  }
  conf.delete('email');
  conf.delete('apiKey');
  conf.delete('token');
  conf.delete('secureStorage');
}

export function getCredentialsStatus() {
  const email = getEmail();
  const source = process.env.CW_API_KEY ? 'env' : (conf.get('secureStorage') || (conf.has('apiKey') ? 'conf' : undefined));
  const token = conf.get('token');
  const tokenValid = !!(token && token.expires_at && Date.now() < token.expires_at - 60_000);
  return { email, source, token: token ? { valid: tokenValid, expires_at: token.expires_at } : null };
}

async function getToken() {
  let token = conf.get('token');
  if (token && token.expires_at && Date.now() < token.expires_at - 60_000) {
    return token.access_token;
  }
  const email = getEmail();
  const apiKey = await getApiKey();
  if (!email || !apiKey) throw new Error('Not authenticated. Run `cwl auth`.');

  const res = await ky.post('https://api.cloudways.com/api/v1/oauth/access_token', {
    json: { email, api_key: apiKey },
    retry: 0,
  }).json();

  // Cloudways returns { access_token, expires_in }
  const expires_at = Date.now() + (res.expires_in || 3600) * 1000;
  token = { access_token: res.access_token, expires_at };
  conf.set('token', token);
  return token.access_token;
}

export async function api(path, options = {}) {
  const baseUrl = 'https://api.cloudways.com/api/v1';
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken();
    try {
      const res = await ky(baseUrl + path, {
        headers: { Authorization: `Bearer ${token}` },
        retry: 0,
        ...options,
      });
      return await res.json();
    } catch (e) {
      const status = e?.response?.status;
      if ((status === 401 || status === 403) && attempt === 0) {
        // Invalidate token and retry once
        try { conf.delete('token'); } catch {}
        continue;
      }
      throw e;
    }
  }
}

export const Cloudways = {
  async getServers() {
    const data = await api('/server');
    // Accept a few possible shapes
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.servers)) return data.servers;
    if (data && typeof data === 'object') return Object.values(data.servers || {});
    return [];
  },
  async getApplications() {
    const data = await api('/server');
    const servers = Array.isArray(data?.servers)
      ? data.servers
      : Array.isArray(data)
        ? data
        : Object.values(data?.servers || {});
    const all = [];
    for (const s of servers) {
      // Prefer embedded apps on the server object, if present
      let embedded = [];
      if (Array.isArray(s.apps)) embedded = s.apps;
      else if (Array.isArray(s.applications)) embedded = s.applications;

      let apps = embedded;
      // If no embedded apps, query per-server endpoints
      if (!apps || apps.length === 0) {
        try {
          apps = await api(`/apps?server_id=${s.id}`);
        } catch (e) {
          // Fallback (legacy): /app?server_id
          apps = await api(`/app?server_id=${s.id}`);
        }
      }
      // Normalize various possible shapes into an array of app objects
      const candidates = [];
      const maybeArrays = [apps?.apps, apps?.applications, apps?.data, apps?.result, apps];
      for (const m of maybeArrays) {
        if (Array.isArray(m)) {
          candidates.push(...m);
        } else if (m && typeof m === 'object') {
          // Common paginated shape: { data: [...] }
          if (Array.isArray(m.data)) {
            candidates.push(...m.data);
            continue;
          }
          // Alternate collection key
          if (Array.isArray(m.items)) {
            candidates.push(...m.items);
            continue;
          }
          const vals = Object.values(m);
          // If it looks like a map of objects, accept values
          const objectVals = vals.filter(v => v && typeof v === 'object');
          if (objectVals.length) {
            // Expand nested arrays/objects conservatively
            for (const v of objectVals) {
              if (Array.isArray(v)) candidates.push(...v);
              else candidates.push(v);
            }
          }
        }
      }
      for (const app of candidates) {
        if (app && (app.id || app.application_id || app.app_id)) {
          all.push({ server: s, app });
        }
      }
    }
    return all;
  },
  async getAppCredentials(appId) {
    // Try multiple endpoints to fetch credentials/details
    const tryPaths = [
      `/apps/${appId}/credentials`,
      `/apps/${appId}`,
      `/app/${appId}`,
      `/app/credentials?app_id=${appId}`,
    ];
    for (const p of tryPaths) {
      try {
        const data = await api(p);
        if (data) return data;
      } catch {}
    }
    return {};
  },
  async cloneApplication({ appId, targetServerId, label }) {
    try {
      const res = await api('/app/clone', {
        method: 'post',
        json: { app_id: appId, server_id: targetServerId, label },
      });
      return res;
    } catch (e) {
      const res = await api('/apps/clone', {
        method: 'post',
        json: { app_id: appId, server_id: targetServerId, label },
      });
      return res;
    }
  },
};
