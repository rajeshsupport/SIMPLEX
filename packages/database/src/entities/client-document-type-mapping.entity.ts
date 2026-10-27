import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('client_document_type_mappings')
@Index(['clientId', 'documentTypeId'])
@Index(['clientId', 'userName'])
@Index(['clientId', 'username'])
export class ClientDocumentTypeMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uniqueidentifier' })
  clientId!: string;

  @Column({ type: 'nvarchar', length: 50 })
  documentTypeId!: string;

  @Column({ type: 'nvarchar', length: 250 })
  documentTypeName!: string;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  userDocGroup?: string;

  @Index()
  @Column({ type: 'nvarchar', length: 250 })
  userName!: string;

  @Index()
  @Column({ name: 'loginUsername', type: 'nvarchar', length: 100, nullable: true })
  username?: string;

  @Index()
  @Column({ type: 'nvarchar', length: 250, nullable: true })
  normalizedUserName?: string;

  @Column({ type: 'nvarchar', length: 50, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'datetime2' })
  lastSyncedAt!: Date;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;
}
