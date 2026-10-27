import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('client_form_assembly_mappings')
@Index(['clientId', 'formId'])
@Index(['clientId', 'userName'])
@Index(['clientId', 'username'])
export class ClientFormAssemblyMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uniqueidentifier' })
  clientId!: string;

  @Column({ type: 'nvarchar', length: 50 })
  formId!: string;

  @Column({ type: 'nvarchar', length: 250 })
  formName!: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  groupName?: string;

  @Index()
  @Column({ type: 'nvarchar', length: 250 })
  userName!: string;

  @Index()
  @Column({ name: 'loginUsername', type: 'nvarchar', length: 100, nullable: true })
  username?: string;

  @Index()
  @Column({ type: 'nvarchar', length: 250, nullable: true })
  normalizedUserName?: string;

  @Column({ type: 'bit', default: 0 })
  isDefault!: boolean;

  @Column({ type: 'nvarchar', length: 50, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'datetime2' })
  lastSyncedAt!: Date;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;
}
