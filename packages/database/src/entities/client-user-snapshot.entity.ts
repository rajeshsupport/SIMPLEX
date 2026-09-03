import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Client } from './client.entity.js';

@Entity('client_user_snapshots')
@Index(['clientId', 'username'], { unique: true })
export class ClientUserSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uniqueidentifier' })
  clientId!: string;

  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client?: Client;

  @Column({ type: 'nvarchar', length: 50 })
  clientCode!: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  remoteUserId?: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 100 })
  username!: string;

  @Column({ type: 'nvarchar', length: 100 })
  firstName!: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  middleName?: string | null;

  @Column({ type: 'nvarchar', length: 100 })
  lastName!: string;

  @Column({ type: 'nvarchar', length: 250 })
  fullName!: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  nickName?: string | null;

  @Column({ type: 'nvarchar', length: 255, nullable: true })
  email?: string | null;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  mobileNumber?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  nationality?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  role?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  profileRole?: string | null;

  @Column({ type: 'nvarchar', length: 50, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE';

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  barcodeNumber?: string | null;

  @Column({ type: 'bit', default: 0 })
  hasSignature!: boolean;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  signatureDataUrl?: string | null;

  @Column({ type: 'bit', default: 0 })
  hasStamp!: boolean;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  stampDataUrl?: string | null;

  @Column({ type: 'bit', default: 0 })
  hasProfileImage!: boolean;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  profileImageDataUrl?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  remoteCreatedAt?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  remoteUpdatedAt?: string | null;

  @Column({ type: 'bit', default: 1 })
  isPresentRemotely!: boolean;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  syncRunId?: string | null;

  @Column({ type: 'datetime2' })
  lastSyncedAt!: Date;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;
}
