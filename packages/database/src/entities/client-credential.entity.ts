import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Client } from './client.entity.js';

@Entity('client_credentials')
export class ClientCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uniqueidentifier' })
  clientId!: string;

  @Column({ type: 'nvarchar', length: 100, default: 'Default HMC Operator' })
  credentialName!: string;

  // AES-256-GCM Encrypted Username
  @Column({ type: 'nvarchar', length: 500 })
  encryptedUsername!: string;

  @Column({ type: 'nvarchar', length: 100 })
  usernameIv!: string;

  @Column({ type: 'nvarchar', length: 100 })
  usernameTag!: string;

  // Masked username for safe UI display (e.g. ad***@client.com)
  @Column({ type: 'nvarchar', length: 150 })
  usernameMasked!: string;

  // AES-256-GCM Encrypted Password
  @Column({ type: 'nvarchar', length: 500 })
  encryptedPassword!: string;

  @Column({ type: 'nvarchar', length: 100 })
  passwordIv!: string;

  @Column({ type: 'nvarchar', length: 100 })
  passwordTag!: string;

  @Column({ type: 'int', default: 1 })
  keyVersion!: number;

  @Column({ type: 'bit', default: true })
  isActive!: boolean;

  @Column({ type: 'datetime2', nullable: true })
  lastTestedAt?: Date | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  createdBy?: string;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  updatedBy?: string;

  @OneToOne(() => Client, (client) => client.credential, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client!: Client;
}
