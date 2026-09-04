import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  Client,
  ClientCredential,
  EnvelopeEncryption,
  UserClientAccess,
} from '@hmc/database';
import {
  CreateClientDto,
  UpdateClientDto,
  SaveClientCredentialsDto,
  ClientConfig,
  ClientWithCredentialInfo,
  JwtPayload,
} from '@hmc/shared';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @InjectRepository(Client)
    private clientRepo: Repository<Client>,
    @InjectRepository(ClientCredential)
    private credentialRepo: Repository<ClientCredential>,
    @InjectRepository(UserClientAccess)
    private clientAccessRepo: Repository<UserClientAccess>
  ) {}

  async getAllClients(user: JwtPayload): Promise<ClientWithCredentialInfo[]> {
    let whereClause = {};

    // Filter by allowed clients for non-superadmins
    if (!user.isSuperAdmin) {
      if (!user.allowedClientIds || user.allowedClientIds.length === 0) {
        return [];
      }
      whereClause = { id: In(user.allowedClientIds) };
    }

    const clients = await this.clientRepo.find({
      where: whereClause,
      relations: ['credential'],
      order: { createdAt: 'DESC' },
    });

    return clients.map((c) => this.mapToResponse(c));
  }

  async getClientById(id: string, user: JwtPayload): Promise<ClientWithCredentialInfo> {
    if (!user.isSuperAdmin && !user.allowedClientIds.includes(id)) {
      throw new NotFoundException('Client not found or not authorized');
    }

    const client = await this.clientRepo.findOne({
      where: { id },
      relations: ['credential'],
    });

    if (!client) throw new NotFoundException('Client not found');
    return this.mapToResponse(client);
  }

  async createClient(dto: CreateClientDto, creatorUsername: string): Promise<ClientWithCredentialInfo> {
    const existing = await this.clientRepo.findOne({
      where: { clientCode: dto.clientCode.toUpperCase() },
    });
    if (existing) {
      throw new BadRequestException(`Client code '${dto.clientCode}' already exists`);
    }

    const client = this.clientRepo.create({
      clientCode: dto.clientCode.toUpperCase(),
      clientName: dto.clientName,
      baseUrl: dto.baseUrl.replace(/\/$/, ''),
      applicationPath: dto.applicationPath || '/hmc',
      environment: dto.environment,
      applicationVersion: dto.applicationVersion || 'v1.0',
      loginRoute: dto.loginRoute || '/login',
      usersRoute: dto.usersRoute || '/hmc/users',
      servicesRoute: dto.servicesRoute || '/hmc/services',
      userRoleRoute: dto.userRoleRoute || '/addUserRole',
      status: dto.status || 'ACTIVE',
      connectionStatus: 'UNKNOWN',
      allowedDesktopAgentsJson: dto.allowedDesktopAgents ? JSON.stringify(dto.allowedDesktopAgents) : null,
      createdBy: creatorUsername,
      updatedBy: creatorUsername,
    });

    const saved = await this.clientRepo.save(client);
    return this.getClientById(saved.id, { isSuperAdmin: true } as any);
  }

  async updateClient(id: string, dto: UpdateClientDto, updaterUsername: string, user: JwtPayload): Promise<ClientWithCredentialInfo> {
    const client = await this.clientRepo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');

    if (dto.clientCode && dto.clientCode.toUpperCase() !== client.clientCode) {
      const existing = await this.clientRepo.findOne({
        where: { clientCode: dto.clientCode.toUpperCase() },
      });
      if (existing) throw new BadRequestException(`Client code '${dto.clientCode}' is already taken`);
      client.clientCode = dto.clientCode.toUpperCase();
    }

    if (dto.clientName) client.clientName = dto.clientName;
    if (dto.baseUrl) client.baseUrl = dto.baseUrl.replace(/\/$/, '');
    if (dto.applicationPath) client.applicationPath = dto.applicationPath;
    if (dto.environment) client.environment = dto.environment;
    if (dto.applicationVersion) client.applicationVersion = dto.applicationVersion;
    if (dto.loginRoute) client.loginRoute = dto.loginRoute;
    if (dto.usersRoute) client.usersRoute = dto.usersRoute;
    if (dto.servicesRoute) client.servicesRoute = dto.servicesRoute;
    if (dto.userRoleRoute !== undefined) client.userRoleRoute = dto.userRoleRoute;
    if (dto.status) client.status = dto.status;
    if (dto.allowedDesktopAgents) client.allowedDesktopAgentsJson = JSON.stringify(dto.allowedDesktopAgents);

    client.updatedBy = updaterUsername;
    await this.clientRepo.save(client);

    return this.getClientById(id, user);
  }

  async saveClientCredentials(dto: SaveClientCredentialsDto, username: string): Promise<ClientWithCredentialInfo> {
    const client = await this.clientRepo.findOne({
      where: { id: dto.clientId },
      relations: ['credential'],
    });
    if (!client) throw new NotFoundException('Client not found');

    // Envelope-encrypt credentials with AES-256-GCM
    const encUsername = EnvelopeEncryption.encrypt(dto.username);
    const encPassword = EnvelopeEncryption.encrypt(dto.password);
    const maskedUsername = EnvelopeEncryption.maskSecret(dto.username);

    let cred = client.credential;
    if (!cred) {
      cred = this.credentialRepo.create({
        clientId: client.id,
        credentialName: dto.credentialName,
        encryptedUsername: encUsername.cipherText,
        usernameIv: encUsername.iv,
        usernameTag: encUsername.tag,
        usernameMasked: maskedUsername,
        encryptedPassword: encPassword.cipherText,
        passwordIv: encPassword.iv,
        passwordTag: encPassword.tag,
        keyVersion: encPassword.keyVersion,
        isActive: true,
        createdBy: username,
        updatedBy: username,
      });
    } else {
      cred.credentialName = dto.credentialName;
      cred.encryptedUsername = encUsername.cipherText;
      cred.usernameIv = encUsername.iv;
      cred.usernameTag = encUsername.tag;
      cred.usernameMasked = maskedUsername;
      cred.encryptedPassword = encPassword.cipherText;
      cred.passwordIv = encPassword.iv;
      cred.passwordTag = encPassword.tag;
      cred.keyVersion = encPassword.keyVersion;
      cred.updatedBy = username;
    }

    await this.credentialRepo.save(cred);
    return this.getClientById(client.id, { isSuperAdmin: true } as any);
  }

  /**
   * Internal secure method to retrieve decrypted client credentials for automated Playwright execution
   */
  async getDecryptedCredentials(clientId: string): Promise<{ username: string; password: string }> {
    const cred = await this.credentialRepo.findOne({ where: { clientId } });
    if (!cred || !cred.isActive) {
      throw new BadRequestException('No active credentials configured for this client');
    }

    const username = EnvelopeEncryption.decrypt({
      cipherText: cred.encryptedUsername,
      iv: cred.usernameIv,
      tag: cred.usernameTag,
      keyVersion: cred.keyVersion,
    });

    const password = EnvelopeEncryption.decrypt({
      cipherText: cred.encryptedPassword,
      iv: cred.passwordIv,
      tag: cred.passwordTag,
      keyVersion: cred.keyVersion,
    });

    return { username, password };
  }

  async testConnection(clientId: string, user: JwtPayload): Promise<{ success: boolean; status: string; statusCode?: number; latencyMs?: number }> {
    const client = await this.getClientById(clientId, user);
    const start = Date.now();
    try {
      const response = await fetch(`${client.baseUrl}${client.loginRoute}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - start;
      const isConnected = response.ok || response.status === 401 || response.status === 403 || response.status === 302;

      await this.clientRepo.update(clientId, {
        connectionStatus: isConnected ? 'CONNECTED' : 'ERROR',
      });

      return {
        success: isConnected,
        status: isConnected ? 'CONNECTED' : 'ERROR',
        statusCode: response.status,
        latencyMs,
      };
    } catch (err: any) {
      await this.clientRepo.update(clientId, { connectionStatus: 'DISCONNECTED' });
      return {
        success: false,
        status: 'DISCONNECTED',
        latencyMs: Date.now() - start,
      };
    }
  }

  private mapToResponse(client: Client): ClientWithCredentialInfo {
    const hasCreds = Boolean(client.credential);
    return {
      id: client.id,
      clientCode: client.clientCode,
      clientName: client.clientName,
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      environment: client.environment,
      applicationVersion: client.applicationVersion,
      loginRoute: client.loginRoute,
      usersRoute: client.usersRoute,
      servicesRoute: client.servicesRoute,
      userRoleRoute: client.userRoleRoute || '/addUserRole',
      status: client.status,
      connectionStatus: client.connectionStatus,
      allowedDesktopAgents: client.allowedDesktopAgentsJson ? JSON.parse(client.allowedDesktopAgentsJson) : [],
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
      createdBy: client.createdBy,
      updatedBy: client.updatedBy,
      hasCredentials: hasCreds,
      credentialSummary: hasCreds && client.credential
        ? {
            id: client.credential.id,
            clientId: client.credential.clientId,
            credentialName: client.credential.credentialName,
            usernameMasked: client.credential.usernameMasked,
            hasPassword: true,
            isActive: client.credential.isActive,
            lastTestedAt: client.credential.lastTestedAt ? client.credential.lastTestedAt.toISOString() : null,
            createdAt: client.credential.createdAt.toISOString(),
            updatedAt: client.credential.updatedAt.toISOString(),
          }
        : undefined,
    };
  }
}
