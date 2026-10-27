import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('client_bill_counter_mappings')
@Index(['clientId', 'userName'])
export class ClientBillCounterMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uniqueidentifier' })
  clientId!: string;

  @Column({ type: 'nvarchar', length: 150 })
  billCounterName!: string;

  @Index()
  @Column({ type: 'nvarchar', length: 250 })
  userName!: string;

  @Index()
  @Column({ type: 'nvarchar', length: 250, nullable: true })
  normalizedUserName?: string;

  @Column({ type: 'nvarchar', length: 150, nullable: true })
  role?: string;

  @Column({ type: 'nvarchar', length: 50, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'datetime2' })
  lastSyncedAt!: Date;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;
}
