import { SAML } from '@node-saml/node-saml';
import type { SsoConnection, SsoUserInfo } from './oidc';

export interface SamlConnectionConfig {
  idp_sso_url: string;
  idp_entity_id: string;
  idp_certificate: string;
  idp_metadata_url?: string;
  allowed_domains?: string[];
}

function asSamlConfig(config: unknown): SamlConnectionConfig {
  return config as SamlConnectionConfig;
}

function buildSamlInstance(config: SamlConnectionConfig, callbackUrl: string): SAML {
  return new SAML({
    entryPoint: config.idp_sso_url,
    issuer: callbackUrl.replace('/callback', ''), // SP entity ID
    idpCert: config.idp_certificate,
    callbackUrl,
    wantAssertionsSigned: true,
    signatureAlgorithm: 'sha256',
  });
}

function checkAllowedDomain(email: string, allowedDomains?: string[]): void {
  if (!allowedDomains || allowedDomains.length === 0) return;
  const domain = email.split('@')[1];
  if (!allowedDomains.includes(domain)) {
    throw new Error('Email domain not allowed');
  }
}

export async function buildSamlAuthUrl(
  connection: SsoConnection,
  callbackUrl: string,
  relayState: string,
): Promise<string> {
  const config = asSamlConfig(connection.config);
  const saml = buildSamlInstance(config, callbackUrl);
  return saml.getAuthorizeUrlAsync(relayState, undefined, {});
}

export async function validateSamlResponse(
  connection: SsoConnection,
  callbackUrl: string,
  body: Record<string, unknown>,
): Promise<SsoUserInfo> {
  const config = asSamlConfig(connection.config);
  const saml = buildSamlInstance(config, callbackUrl);
  const { profile } = await saml.validatePostResponseAsync(body as Record<string, string>);

  if (!profile) throw new Error('SAML validation returned no profile');

  const email: string = (profile.email as string | undefined)
    ?? (profile['urn:oid:1.2.840.113549.1.9.1'] as string | undefined)
    ?? '';
  const givenName = profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'] as string | undefined;
  const name = givenName ?? email;

  checkAllowedDomain(email, config.allowed_domains);

  return {
    externalId: profile.nameID as string,
    email,
    name,
  };
}
