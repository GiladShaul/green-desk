import { Issuer, generators } from 'openid-client';

export interface OidcConfig {
  issuer_url: string;
  client_id: string;
  client_secret: string;
  allowed_domains?: string[];
}

export interface SsoConnection {
  id: string;
  provider_type: 'oidc' | 'saml';
  config: OidcConfig | Record<string, unknown>;
}

export interface OidcAuthResult {
  authUrl: string;
  state: string;
  codeVerifier: string;
}

export interface SsoUserInfo {
  externalId: string;
  email: string;
  name: string;
}

function asOidcConfig(config: unknown): OidcConfig {
  return config as OidcConfig;
}

async function buildClient(config: OidcConfig, redirectUri: string) {
  const issuer = await Issuer.discover(config.issuer_url);
  return new issuer.Client({
    client_id: config.client_id,
    client_secret: config.client_secret,
    redirect_uris: [redirectUri],
    response_types: ['code'],
  });
}

function checkAllowedDomain(email: string, allowedDomains?: string[]): void {
  if (!allowedDomains || allowedDomains.length === 0) return;
  const domain = email.split('@')[1];
  if (!allowedDomains.includes(domain)) {
    throw new Error('Email domain not allowed');
  }
}

export async function buildOidcAuthUrl(
  connection: SsoConnection,
  redirectUri: string,
): Promise<OidcAuthResult> {
  const config = asOidcConfig(connection.config);
  const client = await buildClient(config, redirectUri);
  const state = generators.state();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  const authUrl = client.authorizationUrl({
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return { authUrl, state, codeVerifier };
}

export async function exchangeOidcCode(
  connection: SsoConnection,
  redirectUri: string,
  params: { code: string; state: string },
  codeVerifier: string,
): Promise<SsoUserInfo> {
  const config = asOidcConfig(connection.config);
  const client = await buildClient(config, redirectUri);
  const tokenSet = await client.callback(redirectUri, params, {
    code_verifier: codeVerifier,
    state: params.state,
  });
  const claims = tokenSet.claims();

  const email = (claims.email as string | undefined) ?? '';
  checkAllowedDomain(email, config.allowed_domains);

  return {
    externalId: claims.sub as string,
    email,
    name: (claims.name as string | undefined) ?? email,
  };
}
