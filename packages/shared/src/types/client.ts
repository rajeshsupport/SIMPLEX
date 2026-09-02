export type ClientEnvironment = 'Production' | 'UAT' | 'Test' | 'Development';
export type ClientStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ClientConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN' | 'ERROR';

export interface ClientConfig {
  id: string;
  clientCode: string;
  clientName: string;
  baseUrl: string;
  applicationPath: string;
  environment: ClientEnvironment;
  applicationVersion: string;
  loginRoute: string;
  usersRoute: string;
  servicesRoute: string;
  status: ClientStatus;
  connectionStatus: ClientConnectionStatus;
  allowedDesktopAgents?: string[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface ClientCredentialSummary {
  id: string;
  clientId: string;
  credentialName: string;
  usernameMasked: string;
  hasPassword: boolean;
  isActive: boolean;
  lastTestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientWithCredentialInfo extends ClientConfig {
  hasCredentials: boolean;
  credentialSummary?: ClientCredentialSummary;
}
